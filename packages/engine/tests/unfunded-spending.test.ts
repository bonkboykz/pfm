import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { assignToCategory, findUnfundedSpending } from '../src/budget/engine.js';

/**
 * Траты, которым никто не давал денег.
 *
 * Заём Алдияру 153 040 ₸ прошёл тратой по категории с нулевым остатком.
 * Минус поглотился на границе месяца и вычелся из RTA три недели спустя —
 * к тому моменту связь с решением от 11 августа была потеряна, и падение
 * выглядело необъяснимым. Отчёт должен называть такие месяцы поимённо:
 * сколько ушло, из какой категории и куда именно списалось.
 *
 * Незакрытый месяц сюда не попадает — в нём минус ещё можно закрыть
 * назначением, и жаловаться на него значит требовать невозможного.
 */

const GROUP = 'grp';
const NOW = '2026-07-01T00:00:00.000Z';

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
     VALUES (?, ?, ?, 1, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('acc-cash', 'Kaspi Gold', 'checking', NOW, NOW);
  acct.run('acc-card', 'Kaspi Red', 'credit_card', NOW, NOW);

  s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'acc-cash', 'ready-to-assign', '2026-07-01', 100000000, 'cleared', 1, 0, ?, ?)`,
  ).run(NOW, NOW);

  return db;
}

function category(db: DB, id: string, name: string): string {
  db.$client
    .prepare(
      `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?)`,
    )
    .run(id, GROUP, name, NOW);
  return id;
}

function spend(
  db: DB,
  id: string,
  categoryId: string,
  date: string,
  cents: number,
  account: 'acc-cash' | 'acc-card' = 'acc-cash',
) {
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(id, account, categoryId, date, -cents, NOW, NOW);
}

describe('findUnfundedSpending', () => {
  it('называет месяц, категорию и сумму непокрытой траты', () => {
    const db = seed();
    const cat = category(db, 'debts', '🤝 Личные долги');
    spend(db, 'tx-1', cat, '2026-08-11', 15304000);

    const found = findUnfundedSpending(db, '2026-09');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      categoryId: cat,
      categoryName: '🤝 Личные долги',
      month: '2026-08',
      overspentCents: 15304000,
      cashCents: 15304000,
      creditCents: 0,
    });
  });

  it('молчит, когда трата была обеспечена назначением', () => {
    const db = seed();
    const cat = category(db, 'debts', '🤝 Личные долги');
    assignToCategory(db, cat, '2026-08', 15304000);
    spend(db, 'tx-1', cat, '2026-08-11', 15304000);

    expect(findUnfundedSpending(db, '2026-09')).toEqual([]);
  });

  it('не трогает незакрытый месяц — там минус ещё можно закрыть', () => {
    const db = seed();
    const cat = category(db, 'debts', '🤝 Личные долги');
    spend(db, 'tx-1', cat, '2026-09-11', 15304000);

    expect(findUnfundedSpending(db, '2026-09')).toEqual([]);
  });

  it('кассовая часть списывается первой', () => {
    // Соглашение движка, закреплённое в overspend-carry: перерасход сначала
    // относится на деньги, которые действительно покинули банк. Отчёт обязан
    // рассказывать ту же историю, что и перенос остатков, иначе одно и то же
    // событие получит два разных объяснения.
    const db = seed();
    const cat = category(db, 'food', '🛒 Продукты');
    assignToCategory(db, cat, '2026-08', 1000000);
    spend(db, 'tx-cash', cat, '2026-08-10', 1600000, 'acc-cash');
    spend(db, 'tx-card', cat, '2026-08-20', 900000, 'acc-card');

    const found = findUnfundedSpending(db, '2026-09');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      month: '2026-08',
      overspentCents: 1500000,
      cashCents: 1500000,
      creditCents: 0,
    });
  });

  it('кредитная часть остаётся, когда кассовой не хватило', () => {
    // Ушло с карты больше, чем было потрачено наличными: остаток перерасхода
    // деньгами не был, он стал долгом по карте. Лечится это не пополнением
    // RTA, а платежом по карте — потому и считается отдельно.
    const db = seed();
    const cat = category(db, 'food', '🛒 Продукты');
    spend(db, 'tx-cash', cat, '2026-08-10', 600000, 'acc-cash');
    spend(db, 'tx-card', cat, '2026-08-20', 900000, 'acc-card');

    const found = findUnfundedSpending(db, '2026-09');

    expect(found[0]).toMatchObject({
      overspentCents: 1500000,
      cashCents: 600000,
      creditCents: 900000,
    });
  });

  it('перечисляет каждый провинившийся месяц отдельно', () => {
    const db = seed();
    const cat = category(db, 'debts', '🤝 Личные долги');
    spend(db, 'tx-1', cat, '2026-07-11', 1000000);
    spend(db, 'tx-2', cat, '2026-08-11', 2000000);

    const found = findUnfundedSpending(db, '2026-09');

    expect(found.map((f) => f.month)).toEqual(['2026-07', '2026-08']);
  });
});
