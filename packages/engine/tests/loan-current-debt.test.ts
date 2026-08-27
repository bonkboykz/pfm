import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { getLoanCurrentDebt, getLoanPaymentsObserved } from '../src/loan/engine.js';

/**
 * Остаток долга считается от тела и погашенного, и только от них.
 *
 * Раньше из остатка вычиталась ещё и активность привязанной категории, то есть
 * платёж уходил в минус дважды: один раз через paidOffCents, второй — через
 * транзакцию. На беспроцентных рассрочках это не всплывало, потому что
 * транзакций в их категориях нет.
 *
 * Но ошибка глубже двойного счёта. Платёж по кредиту под процент — это тело
 * плюс проценты, а долг уменьшается только на тело: 136 648,65 ₸ платежа
 * против 35 855,21 ₸ тела. Вычитать из долга всю сумму списания нельзя ни при
 * каких условиях, даже если paidOffCents никто не трогает.
 *
 * Разложить платёж на тело и проценты без графика невозможно, поэтому долг
 * теперь опирается на paidOffCents, а фактические списания по категории
 * отдаются отдельным числом — чтобы расхождение было видно, а не спрятано.
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

function loan(db: DB, opts: { paidOff?: number; categoryId?: string | null } = {}) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO loans
         (id, name, type, category_id, principal_cents, apr_bps, term_months, start_date,
          monthly_payment_cents, payment_day, penalty_rate_bps, early_repayment_fee_cents,
          paid_off_cents, is_active, created_at, updated_at)
       VALUES ('loan', 'Halyk', 'loan', ?, 434658600, 2850, 36, '2026-05-01',
          13664865, 21, 0, 0, ?, 1, ?, ?)`,
    )
    .run(opts.categoryId === undefined ? CAT : opts.categoryId, opts.paidOff ?? 0, now, now);
  return 'loan';
}

function payment(db: DB, id: string, date: string, cents: number) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, 'acc', ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(id, CAT, date, -cents, now, now);
}

describe('остаток по кредиту', () => {
  it('равен телу минус погашенное, даже когда платежи есть в категории', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    payment(db, 'p1', '2026-08-21', 13664865);

    // 4 346 586,00 − 138 506,73 = 4 208 079,27 — цифра из графика амортизации.
    expect(getLoanCurrentDebt(db, id)).toBe(420807927);
  });

  it('платёж не вычитается дважды', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    const withoutPayments = getLoanCurrentDebt(db, id);
    payment(db, 'p1', '2026-08-21', 13664865);

    expect(getLoanCurrentDebt(db, id)).toBe(withoutPayments);
  });

  it('фактические списания по категории видны отдельным числом', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    payment(db, 'p1', '2026-08-21', 13664865);
    payment(db, 'p2', '2026-07-21', 13664865);

    expect(getLoanPaymentsObserved(db, id)).toBe(27329730);
  });

  it('списания до даты старта не считаются — категория переиспользуется', () => {
    const db = seed();
    const id = loan(db);
    payment(db, 'old', '2026-01-15', 5000000);

    expect(getLoanPaymentsObserved(db, id)).toBe(0);
  });

  it('погашенное больше тела не уводит долг в минус', () => {
    const db = seed();
    const id = loan(db, { paidOff: 999999999 });

    expect(getLoanCurrentDebt(db, id)).toBe(0);
  });
});
