import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { getBudgetMonth, assignToCategory } from '../src/budget/engine.js';

/**
 * `underfundedCents` — сколько ещё надо назначить категории в этом месяце,
 * чтобы её цель осталась на треке.
 *
 * До этих тестов движок отдавал только флаг `available < target`, одинаковый
 * для всех трёх типов цели, а число считал мобильный клиент по третьей формуле
 * (`target − assigned`). Тесты фиксируют, что каждый `targetType` считается
 * по своему смыслу.
 */

const GROUP = 'grp-test';
const MONTH = '2026-08';
const PREV = '2026-07';

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
  return db;
}

/** Заводит категорию с целью. `amount` и `date` — как в схеме, tiyn и YYYY-MM-DD. */
function category(
  db: DB,
  id: string,
  opts: {
    type?: 'none' | 'monthly_funding' | 'target_balance' | 'target_by_date';
    amount?: number | null;
    date?: string | null;
  } = {},
): string {
  db.$client
    .prepare(
      `INSERT INTO categories
         (id, group_id, name, is_system, sort_order, is_hidden,
          target_amount_cents, target_type, target_date, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      GROUP,
      id,
      opts.amount ?? null,
      opts.type ?? 'none',
      opts.date ?? null,
      new Date().toISOString(),
    );
  return id;
}

function underfunded(db: DB, categoryId: string): number {
  const budget = getBudgetMonth(db, MONTH);
  const row = budget.categoryBudgets.find((c) => c.categoryId === categoryId);
  if (!row) throw new Error(`Category ${categoryId} missing from budget`);
  return row.underfundedCents;
}

describe('underfundedCents по типам цели', () => {
  describe('monthly_funding — «отложить ещё N» каждый месяц', () => {
    it('считает от назначенного В ЭТОМ месяце, а не от Available', () => {
      const db = seed();
      const id = category(db, 'mf-partial', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      assignToCategory(db, id, MONTH, 2_000_000);

      expect(underfunded(db, id)).toBe(3_000_000);
    });

    it('остаток с прошлого месяца НЕ закрывает цель этого месяца', () => {
      const db = seed();
      const id = category(db, 'mf-carryover', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      // 100 000 ₸ перекатились с июля, в августе не назначено ничего.
      assignToCategory(db, id, PREV, 10_000_000);

      // Старая формула (`available < target`) дала бы 0 — деньги же есть.
      // Но ежемесячная цель просит откладывать заново каждый месяц.
      expect(underfunded(db, id)).toBe(5_000_000);
    });

    it('полностью назначенная в этом месяце цель закрыта', () => {
      const db = seed();
      const id = category(db, 'mf-full', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      assignToCategory(db, id, MONTH, 5_000_000);

      expect(underfunded(db, id)).toBe(0);
    });

    it('назначенное сверх цели не уходит в минус', () => {
      const db = seed();
      const id = category(db, 'mf-over', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      assignToCategory(db, id, MONTH, 8_000_000);

      expect(underfunded(db, id)).toBe(0);
    });
  });

  describe('target_balance — «дополнить до N»', () => {
    it('считает от Available, включая перекатившееся', () => {
      const db = seed();
      const id = category(db, 'tb-partial', {
        type: 'target_balance',
        amount: 20_000_000,
      });
      assignToCategory(db, id, PREV, 12_000_000);

      // Деньги с июля засчитываются — просить надо только разницу.
      expect(underfunded(db, id)).toBe(8_000_000);
    });

    it('достигнутый баланс закрывает цель', () => {
      const db = seed();
      const id = category(db, 'tb-reached', {
        type: 'target_balance',
        amount: 20_000_000,
      });
      assignToCategory(db, id, PREV, 20_000_000);

      expect(underfunded(db, id)).toBe(0);
    });

    it('перерасход увеличивает требуемую сумму', () => {
      const db = seed();
      const id = category(db, 'tb-overspent', {
        type: 'target_balance',
        amount: 5_000_000,
      });
      spend(db, id, 1_000_000); // Available = −10 000 ₸

      expect(underfunded(db, id)).toBe(6_000_000);
    });
  });

  describe('target_by_date — «накопить N к дате»', () => {
    it('делит остаток на число месяцев до даты включительно', () => {
      const db = seed();
      const id = category(db, 'tbd-spread', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: '2026-11-30',
      });
      assignToCategory(db, id, PREV, 10_000_000);

      // Не хватает 200 000 ₸; август, сентябрь, октябрь, ноябрь — четыре месяца.
      expect(underfunded(db, id)).toBe(5_000_000);
    });

    it('округляет вверх, чтобы к дате хватило', () => {
      const db = seed();
      const id = category(db, 'tbd-round', {
        type: 'target_by_date',
        amount: 10_000_100,
        date: '2026-10-01',
      });

      // 100 001 ₸ на три месяца: 33 333,67 ₸ округляется вверх.
      expect(underfunded(db, id)).toBe(3_333_367);
    });

    it('дата в текущем месяце требует всю недостающую сумму сразу', () => {
      const db = seed();
      const id = category(db, 'tbd-now', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: '2026-08-31',
      });
      assignToCategory(db, id, PREV, 10_000_000);

      expect(underfunded(db, id)).toBe(20_000_000);
    });

    it('просроченная дата требует всю недостающую сумму сразу', () => {
      const db = seed();
      const id = category(db, 'tbd-past', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: '2026-03-31',
      });

      expect(underfunded(db, id)).toBe(30_000_000);
    });

    it('назначенная доля месяца закрывает запрос до следующего месяца', () => {
      const db = seed();
      const id = category(db, 'tbd-share-paid', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: '2026-11-30',
      });
      assignToCategory(db, id, PREV, 10_000_000);
      // Доля августа — 50 000 ₸ из недостающих 200 000 ₸ на четыре месяца.
      expect(underfunded(db, id)).toBe(5_000_000);

      assignToCategory(db, id, MONTH, 5_000_000);

      // Раньше остаток делился на те же четыре месяца заново и категория
      // просила ещё, хотя свою долю уже получила.
      expect(underfunded(db, id)).toBe(0);
    });

    it('частично назначенная доля просит только разницу', () => {
      const db = seed();
      const id = category(db, 'tbd-share-partial', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: '2026-11-30',
      });
      assignToCategory(db, id, PREV, 10_000_000);
      assignToCategory(db, id, MONTH, 2_000_000);

      expect(underfunded(db, id)).toBe(3_000_000);
    });

    it('без даты ведёт себя как target_balance', () => {
      const db = seed();
      const id = category(db, 'tbd-nodate', {
        type: 'target_by_date',
        amount: 30_000_000,
        date: null,
      });
      assignToCategory(db, id, PREV, 10_000_000);

      expect(underfunded(db, id)).toBe(20_000_000);
    });
  });

  describe('без цели', () => {
    it('targetType none даёт ноль', () => {
      const db = seed();
      const id = category(db, 'no-target', { type: 'none', amount: 5_000_000 });

      expect(underfunded(db, id)).toBe(0);
    });

    it('тип есть, суммы нет — тоже ноль', () => {
      const db = seed();
      const id = category(db, 'no-amount', {
        type: 'monthly_funding',
        amount: null,
      });

      expect(underfunded(db, id)).toBe(0);
    });
  });

  describe('согласованность', () => {
    it('isUnderfunded — это ровно underfundedCents > 0', () => {
      const db = seed();
      const short = category(db, 'flag-short', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      const done = category(db, 'flag-done', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      assignToCategory(db, done, MONTH, 5_000_000);

      const budget = getBudgetMonth(db, MONTH);
      for (const c of budget.categoryBudgets) {
        expect(c.isUnderfunded).toBe(c.underfundedCents > 0);
      }
      expect(
        budget.categoryBudgets.find((c) => c.categoryId === short)!.isUnderfunded,
      ).toBe(true);
      expect(
        budget.categoryBudgets.find((c) => c.categoryId === done)!.isUnderfunded,
      ).toBe(false);
    });

    it('totalUnderfundedCents складывает категории', () => {
      const db = seed();
      const a = category(db, 'sum-a', {
        type: 'monthly_funding',
        amount: 5_000_000,
      });
      category(db, 'sum-b', { type: 'target_balance', amount: 20_000_000 });
      category(db, 'sum-c', { type: 'none', amount: null });
      assignToCategory(db, a, MONTH, 2_000_000);

      // 30 000 ₸ + 200 000 ₸
      expect(getBudgetMonth(db, MONTH).totalUnderfundedCents).toBe(23_000_000);
    });
  });
});

/** Расход по категории в текущем месяце — чтобы загнать Available в минус. */
function spend(db: DB, categoryId: string, cents: number): void {
  const sqlite = db.$client;
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO accounts
         (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
       VALUES ('acc-test', 'Тестовый', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, 'acc-test', ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(`tx-${categoryId}`, categoryId, `${MONTH}-10`, -cents, now, now);
}
