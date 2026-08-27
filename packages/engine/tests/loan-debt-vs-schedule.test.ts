import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  getLoanCurrentDebt,
  generateAmortizationSchedule,
} from '../src/loan/engine.js';

/**
 * Остаток долга сверяется с графиком амортизации.
 *
 * Это тест-оракул: график считается независимо, от тела, ставки и срока, и
 * ничего не знает ни про `paidOffCents`, ни про транзакции. Поэтому он ловит
 * класс ошибок, который обычный тест пропускает — когда ожидание закреплено
 * по той же формуле, что и реализация.
 *
 * Именно так и вышло с двойным вычитанием платежа: тест утверждал
 * «долг = тело − платежи», код делал ровно это, CI был зелёным, а расхождение
 * с графиком в один платёж заметил живой человек.
 */

const CAT = 'cat-loan';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);
  const now = '2026-08-27T00:00:00.000Z';

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Кредиты', 0, 1, 0, ?)`,
  ).run(now);
  s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'grp', 'Halyk Кредит', 0, 0, 0, ?)`,
  ).run(CAT, now);
  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Halyk', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(now, now);
  return db;
}

/**
 * Платежи лежат в привязанной категории — как в жизни. Без них тест не
 * воспроизводит ту самую ошибку: прежняя формула вычитала именно активность
 * категории, и на пустой категории вела бы себя правильно.
 */
function payments(db: DB, count: number) {
  const now = '2026-08-27T00:00:00.000Z';
  // Перевыставляем набор целиком — тест прогоняет несколько значений подряд.
  db.$client.prepare('DELETE FROM transactions').run();
  const stmt = db.$client.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES (?, 'acc', ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    const month = String(6 + i).padStart(2, '0');
    stmt.run(`pay-${i}`, CAT, `2026-${month}-21`, -13664865, now, now);
  }
}

/** Кредит под процент: платёж делится на тело и проценты. */
function loan(db: DB, opts: { paidOff: number }) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO loans
         (id, name, type, category_id, principal_cents, apr_bps, term_months, start_date,
          monthly_payment_cents, payment_day, penalty_rate_bps,
          early_repayment_fee_cents, paid_off_cents, is_active, created_at, updated_at)
       VALUES ('loan', 'Halyk', 'loan', ?, 434658600, 2850, 36, '2026-05-01',
          13664865, 21, 0, 0, ?, 1, ?, ?)`,
    )
    .run(CAT, opts.paidOff, now, now);
  return 'loan';
}

/** Сколько тела погашено за первые N платежей по графику. */
function principalPaidAfter(db: DB, id: string, payments: number): number {
  return generateAmortizationSchedule(db, id)
    .slice(0, payments)
    .reduce((acc, e) => acc + e.principalCents, 0);
}

describe('остаток против графика амортизации', () => {
  it('после N платежей совпадает с остатком по графику', () => {
    const db = seed();
    const id = loan(db, { paidOff: 0 });
    const schedule = generateAmortizationSchedule(db, id);

    for (const n of [1, 4, 12]) {
      // Столько же реальных списаний лежит в категории — прежняя формула
      // вычла бы их вторично и занизила остаток.
      payments(db, n);
      const paidOff = principalPaidAfter(db, id, n);
      db.$client
        .prepare('UPDATE loans SET paid_off_cents = ? WHERE id = ?')
        .run(paidOff, id);

      expect(getLoanCurrentDebt(db, id)).toBe(schedule[n - 1].endBalanceCents);
    }
  });

  it('платёж гасит тело меньше, чем уходит со счёта', () => {
    // Ровно та величина, из-за которой вычитать сумму списания из долга нельзя.
    const db = seed();
    const id = loan(db, { paidOff: 0 });
    const first = generateAmortizationSchedule(db, id)[0];

    expect(first.principalCents).toBeLessThan(first.paymentCents);
    expect(first.interestCents).toBeGreaterThan(0);
    expect(first.principalCents + first.interestCents).toBe(first.paymentCents);
  });

  it('у беспроцентной рассрочки платёж целиком идёт в тело', () => {
    // Здесь прежняя формула совпадала с верной — потому ошибку и не замечали.
    const db = seed();
    const now = '2026-08-27T00:00:00.000Z';
    db.$client
      .prepare(
        `INSERT INTO loans
           (id, name, type, principal_cents, apr_bps, term_months, start_date,
            monthly_payment_cents, payment_day, penalty_rate_bps,
            early_repayment_fee_cents, paid_off_cents, is_active, created_at, updated_at)
         VALUES ('rass', 'Рассрочка', 'installment', 10196000, 0, 12, '2026-04-01',
            849667, 3, 0, 0, 0, 1, ?, ?)`,
      )
      .run(now, now);

    const first = generateAmortizationSchedule(db, 'rass')[0];
    expect(first.interestCents).toBe(0);
    expect(first.principalCents).toBe(first.paymentCents);
  });
});
