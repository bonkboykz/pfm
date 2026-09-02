import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  getBudgetMonth,
  assignToCategory,
  getRtaReconciliation,
} from '../src/budget/engine.js';

/**
 * Граница бюджета.
 *
 * Перевод на внебюджетный счёт уносит деньги со счетов, но активность
 * считалась с фильтром `transfer_account_id IS NULL`, а RTA — только по
 * `ready-to-assign`. Ни то, ни другое перевод не задевал, и инвариант
 * «RTA + доступное = деньги на бюджетных счетах» разъезжался ровно на сумму
 * перевода: бюджет обещал деньги, которых уже нет.
 *
 * В YNAB такой перевод требует категорию и является тратой — деньги покидают
 * периметр. Переводы между двумя бюджетными счетами по-прежнему бюджету
 * невидимы: там ничего не ушло, только переложилось.
 */

const GROUP = 'grp';
const MONTH = '2026-08';
const NOW = '2026-08-01T00:00:00.000Z';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'Тест', 0, 1, 0, ?)`,
  ).run(GROUP, NOW);

  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('bank-a', 'Kaspi Gold', 'checking', 1, NOW, NOW);
  acct.run('bank-b', 'Forte Visa', 'checking', 1, NOW, NOW);
  acct.run('outside', 'Брокерский счёт', 'tracking', 0, NOW, NOW);

  s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('invest', ?, 'Инвестиции', 0, 0, 0, ?)`,
  ).run(GROUP, NOW);

  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'bank-a', 'ready-to-assign', '2026-08-01', 10000000, 'cleared', 1, 0, ?, ?)`,
  ).run(NOW, NOW);

  return db;
}

/** Пара операций перевода. `categoryId` ставится на бюджетную сторону. */
function transfer(
  db: DB,
  from: string,
  to: string,
  cents: number,
  categoryId: string | null = null,
) {
  const s = db.$client;
  const ins = s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents,
       transfer_account_id, transfer_transaction_id, cleared, approved, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, '2026-08-10', ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
  );
  ins.run('t-out', from, categoryId, -cents, to, 't-in', NOW, NOW);
  ins.run('t-in', to, null, cents, from, 't-out', NOW, NOW);
}

function availableOf(db: DB, categoryId: string): number {
  return getBudgetMonth(db, MONTH).categoryBudgets
    .find((c) => c.categoryId === categoryId)!.availableCents;
}

describe('граница бюджета', () => {
  it('перевод между бюджетными счетами бюджету невидим', () => {
    const db = seed();
    assignToCategory(db, 'invest', MONTH, 3000000);
    transfer(db, 'bank-a', 'bank-b', 2000000);

    const budget = getBudgetMonth(db, MONTH);
    expect(availableOf(db, 'invest')).toBe(3000000);
    expect(budget.readyToAssignCents).toBe(7000000);
  });

  it('перевод за периметр списывает указанную категорию', () => {
    const db = seed();
    assignToCategory(db, 'invest', MONTH, 3000000);
    transfer(db, 'bank-a', 'outside', 2000000, 'invest');

    expect(availableOf(db, 'invest')).toBe(1000000);
  });

  it('после перевода за периметр сверка по-прежнему сходится', () => {
    // Главное утверждение: деньги ушли со счёта, и бюджет обязан это признать.
    // Иначе он обещает 20 000 ₸, которых на счетах уже нет.
    const db = seed();
    assignToCategory(db, 'invest', MONTH, 3000000);
    transfer(db, 'bank-a', 'outside', 2000000, 'invest');

    const rec = getRtaReconciliation(db, MONTH);
    expect(rec.reconciliation.unexplainedCents).toBe(0);
    expect(rec.readyToAssignCents + rec.totalAvailableCents)
      .toBe(rec.onBudgetBalanceCents);
  });

  it('перевод внутрь бюджета пополняет Ready to Assign', () => {
    // Наличные из-за периметра — настоящий приход в бюджет.
    const db = seed();
    transfer(db, 'outside', 'bank-a', 5000000, null);
    db.$client
      .prepare(`UPDATE transactions SET category_id = 'ready-to-assign' WHERE id = 't-in'`)
      .run();

    expect(getBudgetMonth(db, MONTH).readyToAssignCents).toBe(15000000);
  });
});
