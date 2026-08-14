import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  getBudgetMonth,
  assignToCategory,
  getReadyToAssign,
  getRtaReconciliation,
} from '../src/budget/engine.js';

/**
 * Перерасход на границе месяца.
 *
 * Available был чистой суммой «всё назначенное плюс вся активность с начала
 * времён», поэтому минус категории переносился во все последующие месяцы и
 * висел там вечно. YNAB переносит только положительные остатки: непокрытый
 * кассовый перерасход обнуляет категорию и вычитается из Ready to Assign
 * следующего месяца — деньги ведь действительно ушли со счёта.
 *
 * Кредитный перерасход ведёт себя иначе: он увеличивает долг по карте, а не
 * съедает бюджет. Категории платежа по кредитке у нас пока нет (PFM-27),
 * поэтому кредитная часть продолжает висеть видимым минусом — молча её
 * обнулить значило бы потерять единственный след того, что перерасход был.
 */

const GROUP = 'grp';
const JUL = '2026-07';
const AUG = '2026-08';
const SEP = '2026-09';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);
  const now = '2026-07-01T00:00:00.000Z';

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'Тест', 0, 1, 0, ?)`,
  ).run(GROUP, now);

  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('acc-cash', 'Halyk', 'checking', now, now);
  acct.run('acc-card', 'Kaspi Red', 'credit_card', now, now);

  // Доход, чтобы Ready to Assign было из чего вычитать.
  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'acc-cash', 'ready-to-assign', '2026-07-01', 100000000, 'cleared', 1, 0, ?, ?)`,
  ).run(now, now);

  return db;
}

function category(db: DB, id: string): string {
  db.$client
    .prepare(
      `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(id, GROUP, id, '2026-07-01T00:00:00.000Z');
  return id;
}

/** Расход по категории. `account` решает, кассовый он или кредитный. */
function spend(
  db: DB,
  id: string,
  categoryId: string,
  date: string,
  cents: number,
  account: 'acc-cash' | 'acc-card' = 'acc-cash',
) {
  const now = '2026-07-01T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(id, account, categoryId, date, -cents, now, now);
}

function availableOf(db: DB, month: string, categoryId: string): number {
  const budget = getBudgetMonth(db, month);
  return budget.categoryBudgets.find((c) => c.categoryId === categoryId)!.availableCents;
}

describe('перерасход на границе месяца', () => {
  it('кассовый минус не переносится — категория стартует с нуля', () => {
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);

    expect(availableOf(db, JUL, cat)).toBe(-500000);
    expect(availableOf(db, AUG, cat)).toBe(0);
  });

  it('и вычитается из Ready to Assign следующего месяца', () => {
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);

    const july = getBudgetMonth(db, JUL);
    const august = getBudgetMonth(db, AUG);

    // Июль: 100 000 ₸ дохода минус 10 000 ₸ назначенных.
    expect(july.readyToAssignCents).toBe(99000000);
    // Август: то же минус 5 000 ₸ непокрытого кассового перерасхода.
    expect(august.readyToAssignCents).toBe(98500000);
  });

  it('вычет применяется один раз, а не в каждом следующем месяце', () => {
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);

    expect(getBudgetMonth(db, SEP).readyToAssignCents).toBe(98500000);
  });

  it('положительный остаток переносится как прежде', () => {
    const db = seed();
    const cat = category(db, 'Отпуск');
    assignToCategory(db, cat, JUL, 1000000);
    assignToCategory(db, cat, AUG, 500000);

    expect(availableOf(db, AUG, cat)).toBe(1500000);
    expect(getBudgetMonth(db, AUG).readyToAssignCents).toBe(98500000);
  });

  it('покрытый в своём же месяце перерасход ничего не уносит', () => {
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);
    assignToCategory(db, cat, JUL, 1500000);

    expect(availableOf(db, JUL, cat)).toBe(0);
    expect(availableOf(db, AUG, cat)).toBe(0);
    expect(getBudgetMonth(db, AUG).readyToAssignCents).toBe(98500000);
  });

  it('кредитный перерасход продолжает висеть минусом', () => {
    // Деньги со счёта не уходили — вырос долг по карте. Обнулить категорию
    // сейчас значило бы стереть единственный след перерасхода: категории
    // платежа по кредитке ещё нет.
    const db = seed();
    const cat = category(db, 'Кафе');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000, 'acc-card');

    expect(availableOf(db, AUG, cat)).toBe(-500000);
    expect(getBudgetMonth(db, AUG).readyToAssignCents).toBe(99000000);
  });

  it('смешанный перерасход: кассовая часть списывается первой', () => {
    // YNAB списывает кассовую часть раньше кредитной — эти деньги
    // действительно покинули банк.
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-cash', cat, '2026-07-10', 800000);
    spend(db, 'tx-card', cat, '2026-07-20', 900000, 'acc-card');

    // Итог июля: 10 000 − 8 000 − 9 000 = −7 000 ₸.
    expect(availableOf(db, JUL, cat)).toBe(-700000);
    // Кассовая часть перерасхода — 8 000 ₸ трат, но перерасход всего 7 000 ₸,
    // значит он весь кассовый: категория обнуляется, RTA теряет 7 000 ₸.
    expect(availableOf(db, AUG, cat)).toBe(0);
    expect(getBudgetMonth(db, AUG).readyToAssignCents).toBe(98300000);
  });

  it('getReadyToAssign не расходится с бюджетом месяца', () => {
    // Второй путь к RTA: он кормит /ready-to-assign и прогноз по будущим
    // месяцам. Разъехавшись, он обещал бы деньги, которых нет.
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);

    expect(getReadyToAssign(db, AUG).readyToAssignCents).toBe(
      getBudgetMonth(db, AUG).readyToAssignCents,
    );
  });

  it('тождество сверки не ломается', () => {
    // RTA + Σ Available должно оставаться равным приходу плюс активности:
    // сколько ушло из RTA, ровно столько прибавилось к категории, которую
    // перестали держать в минусе.
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-1', cat, '2026-07-15', 1500000);

    const rec = getRtaReconciliation(db, AUG);
    expect(rec.reconciliation.unexplainedCents).toBe(0);
  });

  it('кассовой части хватает не на весь перерасход — остаток остаётся минусом', () => {
    const db = seed();
    const cat = category(db, 'Продукты');
    assignToCategory(db, cat, JUL, 1000000);
    spend(db, 'tx-cash', cat, '2026-07-10', 1200000);
    spend(db, 'tx-card', cat, '2026-07-20', 2000000, 'acc-card');

    // Итог: 10 000 − 12 000 − 20 000 = −22 000 ₸.
    // Кассовых трат 12 000 ₸ — столько и уходит из RTA; остальные 10 000 ₸
    // кредитные и продолжают висеть на категории.
    expect(availableOf(db, AUG, cat)).toBe(-1000000);
    expect(getBudgetMonth(db, AUG).readyToAssignCents).toBe(97800000);
  });
});
