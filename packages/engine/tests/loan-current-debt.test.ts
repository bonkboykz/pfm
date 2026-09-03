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
 * Разносить платёж научились позже (splitLoanPayment), и с тех пор долг
 * уменьшают проведённые платежи. Но трата, просто попавшая в категорию
 * кредита, платежом по нему не является и на долг не влияет: категория
 * ничего не доказывает — три рассрочки на проде делили одну, две карты
 * другую, а у кредита наличными её нет вовсе.
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

/** Трата в категории кредита — но не платёж по нему. */
function spendInCategory(db: DB, id: string, date: string, cents: number) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, 'acc', ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(id, CAT, date, -cents, now, now);
}

/** Проведённый платёж: привязан к кредиту и несёт своё разнесение. */
function postedPayment(
  db: DB, id: string, date: string, cents: number, principal: number,
) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents,
         loan_id, loan_principal_cents, loan_interest_cents,
         cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, 'acc', ?, ?, ?, 'loan', ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(id, CAT, date, -cents, principal, cents - principal, now, now);
}

describe('остаток по кредиту', () => {
  it('равен телу минус погашенное, когда в категории просто трата', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    spendInCategory(db, 'p1', '2026-08-21', 13664865);

    // 4 346 586,00 − 138 506,73 = 4 208 079,27 — цифра из графика амортизации.
    expect(getLoanCurrentDebt(db, id)).toBe(420807927);
  });

  it('трата в категории не вычитается из долга', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    const before = getLoanCurrentDebt(db, id);
    spendInCategory(db, 'p1', '2026-08-21', 13664865);

    expect(getLoanCurrentDebt(db, id)).toBe(before);
  });

  it('проведённый платёж уменьшает долг на своё тело, а не на всю сумму', () => {
    // 136 648,65 ₸ ушло со счёта, тело уменьшилось на 35 855,21 — остальное
    // проценты. Вычитать всю сумму нельзя ни при каких условиях.
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    postedPayment(db, 'p1', '2026-08-21', 13664865, 3585521);

    expect(getLoanCurrentDebt(db, id)).toBe(420807927 - 3585521);
  });

  it('проведённые платежи видны отдельным числом', () => {
    const db = seed();
    const id = loan(db, { paidOff: 13850673 });
    postedPayment(db, 'p1', '2026-08-21', 13664865, 3585521);
    postedPayment(db, 'p2', '2026-07-21', 13664865, 3500000);

    expect(getLoanPaymentsObserved(db, id)).toBe(27329730);
  });

  it('чужая трата в общей категории не приписывается кредиту', () => {
    // На проде именно так и было: платёж трёх рассрочек засчитался соседнему
    // займу, потому что категория у них одна.
    const db = seed();
    const id = loan(db);
    spendInCategory(db, 'foreign', '2026-06-15', 5000000);

    expect(getLoanPaymentsObserved(db, id)).toBe(0);
  });

  it('погашенное больше тела не уводит долг в минус', () => {
    const db = seed();
    const id = loan(db, { paidOff: 999999999 });

    expect(getLoanCurrentDebt(db, id)).toBe(0);
  });
});
