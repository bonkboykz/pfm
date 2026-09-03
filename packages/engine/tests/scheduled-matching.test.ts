import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { processDue } from '../src/scheduler/engine.js';

/**
 * Не создавать то, что уже оплачено.
 *
 * Правило Казахтелекома стоит на 25-е, а счёт бывает оплачен 13-го — руками и
 * раньше срока. Проведение по дате создавало вторую операцию, и категория
 * показывала расход вдвое больше настоящего. На границе месяца этот лишний
 * минус ещё и списывался из Ready to Assign как настоящие деньги.
 *
 * Поэтому перед созданием ищем, не заведена ли эта же трата уже: тот же счёт,
 * тот же плательщик, окно ±10 дней вокруг даты правила. Нашли — считаем
 * вхождение исполненным: операцию не создаём, а дату двигаем, потому что
 * платёж действительно был.
 *
 * Сумма в условие не входит намеренно. У Казахтелекома она плавает — часть
 * гасится бонусами, — и требовать совпадения значило бы не поймать ровно тот
 * случай, ради которого всё делается. Риски несимметричны: лишний пропуск
 * человек увидит в ответе и заведёт руками, а лишний дубль тихо удвоит расход.
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
  s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('cat', 'grp', 'Связь', 0, 0, 0, ?)`,
  ).run(NOW);
  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('acc', 'Forte', NOW, NOW);
  acct.run('other', 'Kaspi', NOW, NOW);
  return db;
}

function rule(db: DB, { payee = 'Казахтелеком', nextDate = '2026-09-25', amount = -1174300 } = {}) {
  db.$client
    .prepare(
      `INSERT INTO scheduled_transactions
         (id, account_id, frequency, next_date, amount_cents, payee_name, category_id,
          auto_post, is_active, created_at, updated_at)
       VALUES ('rule', 'acc', 'monthly', ?, ?, ?, 'cat', 1, 1, ?, ?)`,
    )
    .run(nextDate, amount, payee, NOW, NOW);
}

let seq = 0;
function existing(
  db: DB,
  { date, amount = -1174300, payee = 'Казахтелеком', account = 'acc', deleted = false } :
  { date: string; amount?: number; payee?: string; account?: string; deleted?: boolean },
) {
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, payee_name,
         cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, ?, 'cat', ?, ?, ?, 'cleared', 1, ?, ?, ?)`,
    )
    .run(`tx-${seq++}`, account, date, amount, payee, deleted ? 1 : 0, NOW, NOW);
}

function nextDateOf(db: DB): string {
  return (db.$client.prepare(`SELECT next_date FROM scheduled_transactions WHERE id='rule'`)
    .get() as { next_date: string }).next_date;
}

describe('матчинг перед проведением', () => {
  it('за пределами окна — это уже другой период', () => {
    // 12 дней до срока: слишком далеко, чтобы считать тем же платежом.
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-13' });

    const res = processDue(db, '2026-09-25');

    expect(res.created).toBe(1);
    expect(nextDateOf(db)).toBe('2026-10-25');
  });

  it('оплата за 10 дней до срока считается тем же платежом', () => {
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-15' });

    const res = processDue(db, '2026-09-25');

    expect(res.created).toBe(0);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].scheduledId).toBe('rule');
    // Вхождение исполнено, значит следующее — через месяц.
    expect(nextDateOf(db)).toBe('2026-10-25');
  });

  it('плавающая сумма не мешает совпасть', () => {
    // Казахтелеком: 21 000 минус 17 006 бонусами. Сумма другая, платёж тот же.
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-20', amount: -399400 });

    const res = processDue(db, '2026-09-25');

    expect(res.created).toBe(0);
    expect(res.matched[0].amountCents).toBe(-399400);
    expect(res.matched[0].expectedAmountCents).toBe(-1174300);
  });

  it('другой плательщик — не тот платёж', () => {
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-20', payee: 'Tele2' });

    expect(processDue(db, '2026-09-25').created).toBe(1);
  });

  it('другой счёт — не тот платёж', () => {
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-20', account: 'other' });

    expect(processDue(db, '2026-09-25').created).toBe(1);
  });

  it('удалённая операция совпадением не считается', () => {
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-20', deleted: true });

    expect(processDue(db, '2026-09-25').created).toBe(1);
  });

  it('следующий месяц уже не матчится о ту же операцию', () => {
    // Иначе одна ручная оплата глушила бы правило навсегда.
    const db = seed();
    rule(db);
    existing(db, { date: '2026-09-20' });

    expect(processDue(db, '2026-09-25').created).toBe(0);
    expect(processDue(db, '2026-10-25').created).toBe(1);
  });
});
