import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { processDue } from '../src/scheduler/engine.js';

/**
 * Автопроведение — свойство правила, а не всего механизма.
 *
 * Платёж по кредиту заводить автоматически нельзя: списание уходит целиком,
 * а тело долга уменьшается лишь на свою долю, и разнести это без графика
 * невозможно. Такие правила должны напоминать, а не создавать операцию.
 *
 * Для платежей с фиксированной суммой, которые списываются сами (аренда,
 * подписки), автопроведение по-прежнему уместно — поэтому это флаг, а не
 * глобальное отключение.
 */

const TODAY = '2026-08-27';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);
  const now = '2026-08-27T00:00:00.000Z';
  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Halyk', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(now, now);
  return db;
}

function rule(db: DB, id: string, opts: { autoPost?: boolean } = {}) {
  const now = '2026-08-27T00:00:00.000Z';
  db.$client
    .prepare(
      `INSERT INTO scheduled_transactions
         (id, account_id, frequency, next_date, amount_cents, payee_name, auto_post, is_active, created_at, updated_at)
       VALUES (?, 'acc', 'monthly', '2026-08-21', -13664865, ?, ?, 1, ?, ?)`,
    )
    .run(id, id, opts.autoPost === false ? 0 : 1, now, now);
  return id;
}

function txCount(db: DB): number {
  return (db.$client.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
}

function nextDateOf(db: DB, id: string): string {
  return (db.$client
    .prepare('SELECT next_date AS d FROM scheduled_transactions WHERE id = ?')
    .get(id) as { d: string }).d;
}

describe('автопроведение по правилу', () => {
  it('правило с выключённым автопроведением ничего не создаёт', () => {
    const db = seed();
    rule(db, 'кредит', { autoPost: false });

    const res = processDue(db, TODAY);

    expect(res.created).toBe(0);
    expect(txCount(db)).toBe(0);
  });

  it('и не двигает дату — напоминание должно остаться наступившим', () => {
    // Сдвинув nextDate, механизм соврал бы, что платёж проведён.
    const db = seed();
    const id = rule(db, 'кредит', { autoPost: false });

    processDue(db, TODAY);

    expect(nextDateOf(db, id)).toBe('2026-08-21');
  });

  it('такие правила возвращаются отдельным списком, а не молча пропускаются', () => {
    const db = seed();
    rule(db, 'кредит', { autoPost: false });

    const res = processDue(db, TODAY);

    expect(res.reminders).toEqual([{ scheduledId: 'кредит', date: '2026-08-21' }]);
  });

  it('обычное правило проводится как прежде', () => {
    const db = seed();
    const id = rule(db, 'аренда');

    const res = processDue(db, TODAY);

    expect(res.created).toBe(1);
    expect(txCount(db)).toBe(1);
    expect(nextDateOf(db, id)).toBe('2026-09-21');
  });
});
