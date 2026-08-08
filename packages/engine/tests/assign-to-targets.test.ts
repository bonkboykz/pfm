import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  assignToTargets,
  assignToCategory,
  getBudgetMonth,
  getReadyToAssign,
} from '../src/budget/engine.js';

/**
 * Раздача по целям обязана останавливаться на нуле Ready to Assign.
 * До этого кнопка «Недофинансировано» раздавала всё, что просят цели, и при
 * пустом бюджете молча уводила RTA глубоко в минус.
 */

const MONTH = '2026-08';
const GROUP = 'grp';

function seed(inflowCents: number): DB {
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

  if (inflowCents !== 0) {
    sqlite
      .prepare(
        `INSERT INTO transactions
           (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
         VALUES ('tx-in', 'acc', 'ready-to-assign', ?, ?, 'cleared', 1, 0, ?, ?)`,
      )
      .run(`${MONTH}-01`, inflowCents, now, now);
  }
  return db;
}

function target(
  db: DB,
  id: string,
  amountCents: number,
  opts: { type?: string; date?: string | null; sort?: number } = {},
): string {
  db.$client
    .prepare(
      `INSERT INTO categories
         (id, group_id, name, is_system, sort_order, is_hidden,
          target_amount_cents, target_type, target_date, created_at)
       VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      GROUP,
      id,
      opts.sort ?? 0,
      amountCents,
      opts.type ?? 'monthly_funding',
      opts.date ?? null,
      new Date().toISOString(),
    );
  return id;
}

describe('assignToTargets', () => {
  it('при достатке денег закрывает все цели', () => {
    const db = seed(100_000_000);
    target(db, 'a', 5_000_000, { sort: 0 });
    target(db, 'b', 3_000_000, { sort: 1 });

    const result = assignToTargets(db, MONTH);

    expect(result.applied).toHaveLength(2);
    expect(result.totalAddedCents).toBe(8_000_000);
    expect(result.remainingUnderfundedCents).toBe(0);
    expect(result.stoppedAtZeroRta).toBe(false);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(92_000_000);
  });

  it('останавливается на нуле RTA и добивает последнюю категорию частично', () => {
    const db = seed(6_000_000);
    target(db, 'a', 5_000_000, { sort: 0 });
    target(db, 'b', 3_000_000, { sort: 1 });

    const result = assignToTargets(db, MONTH);

    expect(result.totalAddedCents).toBe(6_000_000);
    expect(result.stoppedAtZeroRta).toBe(true);
    // Второй досталось всё, что оставалось, — 10 000 ₸ из нужных 30 000 ₸.
    expect(result.applied.map((a) => [a.categoryId, a.addedCents])).toEqual([
      ['a', 5_000_000],
      ['b', 1_000_000],
    ]);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(0);
    expect(result.remainingUnderfundedCents).toBe(2_000_000);
  });

  it('при нулевом RTA не назначает ничего', () => {
    const db = seed(0);
    target(db, 'a', 5_000_000);

    const result = assignToTargets(db, MONTH);

    expect(result.applied).toHaveLength(0);
    expect(result.totalAddedCents).toBe(0);
    expect(result.stoppedAtZeroRta).toBe(true);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(0);
  });

  it('при отрицательном RTA не назначает ничего и не углубляет минус', () => {
    const db = seed(1_000_000);
    // Категория без цели, в которую вручную раздали больше, чем было денег:
    // это и есть живая ситуация из прода — RTA в минусе, а цель не закрыта.
    target(db, 'plain', 0, { type: 'none', sort: 0 });
    assignToCategory(db, 'plain', MONTH, 5_000_000);
    const a = target(db, 'a', 3_000_000, { sort: 1 });
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(-4_000_000);

    const result = assignToTargets(db, MONTH);

    expect(result.applied).toHaveLength(0);
    expect(result.totalAddedCents).toBe(0);
    expect(result.stoppedAtZeroRta).toBe(true);
    expect(result.remainingUnderfundedCents).toBe(3_000_000);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(-4_000_000);
    expect(
      getBudgetMonth(db, MONTH).categoryBudgets.find((c) => c.categoryId === a)!
        .assignedCents,
    ).toBe(0);
  });

  it('allowNegativeRta раздаёт всё, что просят цели', () => {
    const db = seed(1_000_000);
    target(db, 'a', 5_000_000);

    const result = assignToTargets(db, MONTH, { allowNegativeRta: true });

    expect(result.totalAddedCents).toBe(5_000_000);
    expect(result.remainingUnderfundedCents).toBe(0);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(-4_000_000);
  });

  describe('порядок раздачи', () => {
    it('цель с датой идёт раньше цели без даты, даже если ниже в списке', () => {
      const db = seed(5_000_000);
      target(db, 'no-date', 5_000_000, { sort: 0 });
      target(db, 'dated', 5_000_000, {
        type: 'target_by_date',
        date: '2026-08-31',
        sort: 1,
      });

      const result = assignToTargets(db, MONTH);

      expect(result.applied[0].categoryId).toBe('dated');
    });

    it('среди целей с датами первой идёт ближайшая', () => {
      const db = seed(5_000_000);
      target(db, 'later', 5_000_000, {
        type: 'target_by_date',
        date: '2026-12-31',
        sort: 0,
      });
      target(db, 'sooner', 5_000_000, {
        type: 'target_by_date',
        date: '2026-09-30',
        sort: 1,
      });

      const result = assignToTargets(db, MONTH);

      expect(result.applied[0].categoryId).toBe('sooner');
    });

    it('без дат сохраняется порядок бюджета', () => {
      const db = seed(100_000_000);
      target(db, 'first', 1_000_000, { sort: 0 });
      target(db, 'second', 1_000_000, { sort: 1 });
      target(db, 'third', 1_000_000, { sort: 2 });

      const result = assignToTargets(db, MONTH);

      expect(result.applied.map((a) => a.categoryId)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });
  });

  it('прибавляет к уже назначенному, а не затирает его', () => {
    const db = seed(100_000_000);
    const a = target(db, 'a', 5_000_000);
    assignToTargets(db, MONTH); // закрыли цель целиком

    const budget = getBudgetMonth(db, MONTH);
    const row = budget.categoryBudgets.find((c) => c.categoryId === a)!;
    expect(row.assignedCents).toBe(5_000_000);
    expect(row.underfundedCents).toBe(0);
  });

  it('повторный вызов на закрытых целях ничего не меняет', () => {
    const db = seed(100_000_000);
    target(db, 'a', 5_000_000);
    assignToTargets(db, MONTH);
    const rtaAfterFirst = getReadyToAssign(db, MONTH).readyToAssignCents;

    const second = assignToTargets(db, MONTH);

    expect(second.applied).toHaveLength(0);
    expect(second.totalAddedCents).toBe(0);
    expect(second.stoppedAtZeroRta).toBe(false);
    expect(getReadyToAssign(db, MONTH).readyToAssignCents).toBe(rtaAfterFirst);
  });

  it('без целей возвращает пустой результат', () => {
    const db = seed(100_000_000);
    target(db, 'plain', 0, { type: 'none' });

    const result = assignToTargets(db, MONTH);

    expect(result.applied).toHaveLength(0);
    expect(result.stoppedAtZeroRta).toBe(false);
  });
});
