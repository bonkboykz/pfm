import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { getBudgetMonth, assignToTargets, snoozeTarget } from '../src/budget/engine.js';

/**
 * Отложить цель на месяц, не выключая её.
 *
 * В трудный месяц единственным способом не финансировать цель было снять её
 * совсем — а потом вспомнить и поставить обратно. Обычно не вспоминаешь, и
 * цель тихо исчезает из плана насовсем.
 *
 * Снуз действует только на тот месяц, в котором сделан: в следующем цель
 * просыпается сама. Именно это отличает его от снятия — забыть невозможно.
 */

const NOW = '2026-09-01T00:00:00.000Z';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Расходы', 0, 1, 0, ?)`,
  ).run(NOW);
  const cat = s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, target_amount_cents, target_type,
       sort_order, is_hidden, created_at)
     VALUES (?, 'grp', ?, 0, ?, 'monthly_funding', 0, 0, ?)`,
  );
  cat.run('rent', 'Аренда', 25000000, NOW);
  cat.run('food', 'Продукты', 10000000, NOW);

  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Kaspi', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(NOW, NOW);
  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'acc', 'ready-to-assign', '2026-09-01', 30000000, 'cleared', 1, 0, ?, ?)`,
  ).run(NOW, NOW);
  return db;
}

function underfundedOf(db: DB, month: string, categoryId: string): number {
  return getBudgetMonth(db, month).categoryBudgets
    .find((c) => c.categoryId === categoryId)!.underfundedCents;
}

describe('снуз цели', () => {
  it('снуженная цель не просит денег в этом месяце', () => {
    const db = seed();
    expect(underfundedOf(db, '2026-09', 'rent')).toBe(25000000);

    snoozeTarget(db, 'rent', '2026-09');

    expect(underfundedOf(db, '2026-09', 'rent')).toBe(0);
  });

  it('в следующем месяце цель просыпается сама', () => {
    // Этим снуз и отличается от снятия цели: забыть вернуть её невозможно.
    const db = seed();
    snoozeTarget(db, 'rent', '2026-09');

    expect(underfundedOf(db, '2026-10', 'rent')).toBe(25000000);
  });

  it('снуз одной категории не трогает остальные', () => {
    const db = seed();
    snoozeTarget(db, 'rent', '2026-09');

    expect(underfundedOf(db, '2026-09', 'food')).toBe(10000000);
  });

  it('раздача по целям снуженную пропускает', () => {
    const db = seed();
    snoozeTarget(db, 'rent', '2026-09');

    assignToTargets(db, '2026-09');
    const budget = getBudgetMonth(db, '2026-09');

    expect(budget.categoryBudgets.find((c) => c.categoryId === 'rent')!.assignedCents)
      .toBe(0);
    expect(budget.categoryBudgets.find((c) => c.categoryId === 'food')!.assignedCents)
      .toBe(10000000);
  });

  it('снуз снимается', () => {
    const db = seed();
    snoozeTarget(db, 'rent', '2026-09');
    snoozeTarget(db, 'rent', null);

    expect(underfundedOf(db, '2026-09', 'rent')).toBe(25000000);
  });

  it('неизвестная категория — ошибка, а не тихий пропуск', () => {
    const db = seed();
    expect(() => snoozeTarget(db, 'нет-такой', '2026-09')).toThrow();
  });
});
