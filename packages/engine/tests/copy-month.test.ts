import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  copyMonthAssignments,
  getBudgetMonth,
  assignToCategory,
} from '../src/budget/engine.js';

/**
 * «Как в прошлом» обещало замену, а делало merge: копировались только
 * категории с ненулевым назначением в источнике, а те, которым назначили
 * в текущем месяце, сохраняли свои суммы. Получался месяц, не похожий ни на
 * прошлый, ни на текущий.
 */

const FROM = '2026-07';
const TO = '2026-08';
const GROUP = 'grp';

function seed(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;
  initializeDatabase(sqlite);
  const now = new Date().toISOString();

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
       VALUES (?, 'Тест', 0, 1, 0, ?)`,
    )
    .run(GROUP, now);
  sqlite
    .prepare(
      `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
       VALUES ('acc', 'Счёт', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES ('tx-in', 'acc', 'ready-to-assign', '2026-07-01', 100000000, 'cleared', 1, 0, ?, ?)`,
    )
    .run(now, now);
  return db;
}

function category(db: DB, id: string, sort = 0): string {
  db.$client
    .prepare(
      `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
       VALUES (?, ?, ?, 0, ?, 0, ?)`,
    )
    .run(id, GROUP, id, sort, new Date().toISOString());
  return id;
}

function assignedIn(db: DB, month: string, categoryId: string): number {
  return getBudgetMonth(db, month).categoryBudgets.find(
    (c) => c.categoryId === categoryId,
  )!.assignedCents;
}

describe('copyMonthAssignments', () => {
  it('переносит суммы источника', () => {
    const db = seed();
    const rent = category(db, 'rent', 0);
    const food = category(db, 'food', 1);
    assignToCategory(db, rent, FROM, 20_000_000);
    assignToCategory(db, food, FROM, 5_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    expect(assignedIn(db, TO, rent)).toBe(20_000_000);
    expect(assignedIn(db, TO, food)).toBe(5_000_000);
    expect(result.applied).toHaveLength(2);
    expect(result.sourceEmpty).toBe(false);
  });

  it('обнуляет категорию, которой в источнике не назначали — это замена, не merge', () => {
    const db = seed();
    const rent = category(db, 'rent', 0);
    const extra = category(db, 'extra', 1);
    assignToCategory(db, rent, FROM, 20_000_000);
    // В августе назначили категории, которой в июле не было.
    assignToCategory(db, extra, TO, 7_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    expect(assignedIn(db, TO, extra)).toBe(0);
    expect(result.clearedCount).toBe(1);
    expect(
      result.applied.find((a) => a.categoryId === extra),
    ).toMatchObject({ fromCents: 7_000_000, toCents: 0 });
  });

  it('пустой источник ничего не трогает', () => {
    const db = seed();
    const rent = category(db, 'rent');
    assignToCategory(db, rent, TO, 9_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    expect(result.sourceEmpty).toBe(true);
    expect(result.applied).toHaveLength(0);
    expect(assignedIn(db, TO, rent)).toBe(9_000_000);
  });

  it('возвращает только изменённые категории', () => {
    const db = seed();
    const same = category(db, 'same', 0);
    const differs = category(db, 'differs', 1);
    assignToCategory(db, same, FROM, 3_000_000);
    assignToCategory(db, same, TO, 3_000_000);
    assignToCategory(db, differs, FROM, 4_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    expect(result.applied.map((a) => a.categoryId)).toEqual(['differs']);
  });

  it('повторный вызов ничего не меняет', () => {
    const db = seed();
    const rent = category(db, 'rent');
    assignToCategory(db, rent, FROM, 20_000_000);
    copyMonthAssignments(db, FROM, TO);

    const second = copyMonthAssignments(db, FROM, TO);

    expect(second.applied).toHaveLength(0);
    expect(assignedIn(db, TO, rent)).toBe(20_000_000);
  });

  it('пересчитывает Ready to Assign после замены', () => {
    const db = seed();
    const rent = category(db, 'rent');
    assignToCategory(db, rent, FROM, 20_000_000);
    assignToCategory(db, rent, TO, 50_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    // 1 000 000 ₸ дохода − 200 000 ₸ в июле − 200 000 ₸ в августе.
    expect(result.readyToAssignCents).toBe(60_000_000);
  });

  it('отказывается копировать месяц в самого себя', () => {
    const db = seed();
    category(db, 'rent');

    expect(() => copyMonthAssignments(db, TO, TO)).toThrow();
  });

  it('не трогает скрытые и системные категории', () => {
    const db = seed();
    const rent = category(db, 'rent');
    assignToCategory(db, rent, FROM, 20_000_000);

    const result = copyMonthAssignments(db, FROM, TO);

    expect(result.applied.every((a) => a.categoryId !== 'ready-to-assign')).toBe(
      true,
    );
  });
});
