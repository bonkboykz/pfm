import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { getBudgetMonth, getAccountBalances, getRtaReconciliation } from '../src/budget/engine.js';

/**
 * Одна покупка на несколько категорий.
 *
 * Каспи списывает пять рассрочек одной строкой на 107 940 ₸. Раньше её
 * приходилось руками разбивать на пять операций — и тогда выписка перестаёт
 * сходиться со строкой в приложении, а импорт такую строку не может сматчить
 * ни с чем.
 *
 * Сплит устроен как родитель и части: со счёта уходит родитель, а по
 * категориям расходятся части. Двойного счёта не возникает именно потому, что
 * стороны не пересекаются — баланс смотрит только на родителя, бюджет только
 * на части.
 */

const NOW = '2026-09-01T00:00:00.000Z';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Кредиты', 0, 1, 0, ?)`,
  ).run(NOW);
  for (const [id, name] of [['c-a', 'Рассрочка А'], ['c-b', 'Рассрочка Б']]) {
    s.prepare(
      `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
       VALUES (?, 'grp', ?, 0, 0, 0, ?)`,
    ).run(id, name, NOW);
  }
  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Kaspi Gold', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(NOW, NOW);
  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'acc', 'ready-to-assign', '2026-09-01', 20000000, 'cleared', 1, 0, ?, ?)`,
  ).run(NOW, NOW);
  return db;
}

/** Родитель уходит со счёта; части расходятся по категориям. */
function split(db: DB, parts: Array<{ id: string; categoryId: string; cents: number }>) {
  const total = parts.reduce((acc, p) => acc + p.cents, 0);
  const s = db.$client;
  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, payee_name,
       cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('parent', 'acc', NULL, '2026-09-03', ?, 'Kaspi', 'cleared', 1, 0, ?, ?)`,
  ).run(-total, NOW, NOW);
  const ins = s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents,
       parent_transaction_id, cleared, approved, is_deleted, created_at, updated_at)
     VALUES (?, 'acc', ?, '2026-09-03', ?, 'parent', 'cleared', 1, 0, ?, ?)`,
  );
  for (const p of parts) ins.run(p.id, p.categoryId, -p.cents, NOW, NOW);
}

function availableOf(db: DB, categoryId: string): number {
  return getBudgetMonth(db, '2026-09').categoryBudgets
    .find((c) => c.categoryId === categoryId)!.availableCents;
}

describe('сплит-операция', () => {
  it('со счёта уходит одна сумма, а не она же плюс части', () => {
    const db = seed();
    split(db, [
      { id: 'p1', categoryId: 'c-a', cents: 6000000 },
      { id: 'p2', categoryId: 'c-b', cents: 4000000 },
    ]);

    const acc = getAccountBalances(db).find((a) => a.accountId === 'acc')!;
    expect(acc.balanceCents).toBe(20000000 - 10000000);
  });

  it('каждая категория видит свою часть', () => {
    const db = seed();
    split(db, [
      { id: 'p1', categoryId: 'c-a', cents: 6000000 },
      { id: 'p2', categoryId: 'c-b', cents: 4000000 },
    ]);

    expect(availableOf(db, 'c-a')).toBe(-6000000);
    expect(availableOf(db, 'c-b')).toBe(-4000000);
  });

  it('сверка сходится: бюджет и счета говорят одно и то же', () => {
    // Главное утверждение. Посчитай баланс по частям заодно с родителем —
    // и разойдётся ровно на сумму покупки.
    const db = seed();
    split(db, [
      { id: 'p1', categoryId: 'c-a', cents: 6000000 },
      { id: 'p2', categoryId: 'c-b', cents: 4000000 },
    ]);

    const rec = getRtaReconciliation(db, '2026-09');
    expect(rec.reconciliation.unexplainedCents).toBe(0);
    expect(rec.readyToAssignCents + rec.totalAvailableCents)
      .toBe(rec.onBudgetBalanceCents);
  });

  it('родитель без категории не считается нераспределённой тратой', () => {
    // Иначе сверка объявила бы всю покупку «мимо категорий», хотя части
    // разложены полностью.
    const db = seed();
    split(db, [
      { id: 'p1', categoryId: 'c-a', cents: 6000000 },
      { id: 'p2', categoryId: 'c-b', cents: 4000000 },
    ]);

    expect(getRtaReconciliation(db, '2026-09').reconciliation.uncategorizedCents)
      .toBe(0);
  });
});
