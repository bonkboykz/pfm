import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * The forecast answers "which category runs out, and when". The cases that
 * matter are the ones a naive subtraction gets wrong: a payment that belongs to
 * next month's Available, and a rule that fires more than once in the window.
 */

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

let db: DB;
let app: Hono;

beforeEach(async () => {
  db = createTestDb();
  const s = db.$client;
  const now = '2026-08-07T00:00:00.000Z';

  s.prepare(`INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
             VALUES ('acc-main', 'Kaspi Gold', 'checking', 1, 'KZT', 0, 1, ?, ?)`).run(now, now);
  s.prepare(`INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
             VALUES ('acc-2', 'Forte Solo', 'checking', 1, 'KZT', 1, 1, ?, ?)`).run(now, now);
  s.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
             VALUES ('grp', 'Счета', 0, 1, 0, ?)`).run(now);
  for (const [id, name] of [['cat-rent', 'Аренда'], ['cat-phone', 'Связь'], ['cat-food', 'Продукты']]) {
    s.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
               VALUES (?, 'grp', ?, 0, 0, 0, ?)`).run(id, name, now);
  }

  app = createApp(db);
  await api(app, 'POST', '/api/v1/transactions', {
    accountId: 'acc-main', date: '2026-08-01', amountCents: 50000000, categoryId: 'ready-to-assign',
  });
});

const sched = (over: Record<string, unknown>) => ({
  accountId: 'acc-main', frequency: 'monthly', ...over,
});

describe('forecast', () => {
  it('reports no shortfall when a payment is fully funded', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-phone', amountCents: 2580000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-30', amountCents: -1549000, categoryId: 'cat-phone', payeeName: 'Tele2',
    }));

    const { status, data } = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    expect(status).toBe(200);
    expect(data.totalShortfallCents).toBe(0);
    expect(data.firstShortDate).toBeNull();
  });

  it('catches a category that is a few tiyn short', async () => {
    // The real case: Tele2 15 490 + Kazakhtelecom 10 315 = 25 805 against 25 790.
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-phone', amountCents: 2579000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-30', amountCents: -1549000, categoryId: 'cat-phone', payeeName: 'Tele2',
    }));
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-31', amountCents: -1031500, categoryId: 'cat-phone', payeeName: 'Казахтелеком',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    const aug = data.months.find((m: { month: string }) => m.month === '2026-08');
    const phone = aug.categories.find((c: { categoryId: string }) => c.categoryId === 'cat-phone');

    expect(phone.shortfallCents).toBe(1500);
    expect(phone.projectedAvailableCents).toBe(-1500);
    expect(phone.firstShortDate).toBe('2026-08-31');
    expect(phone.occurrences).toHaveLength(2);
  });

  it('bills a payment against the month it falls in, not the month being viewed', async () => {
    // Rent is already paid for August, so August is deliberately at zero and the
    // rule points at September. Charging it to August would invent a shortfall.
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-09-03', amountCents: -25000000, categoryId: 'cat-rent', payeeName: 'Аренда',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=40&asOf=2026-08-07');
    const months = data.months.map((m: { month: string }) => m.month);

    expect(months).toContain('2026-09');
    expect(months).not.toContain('2026-08');
    expect(data.months[0].categories[0].firstShortDate).toBe('2026-09-03');
  });

  it('does not report a shortfall that a later assignment already covers', async () => {
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-09-03', amountCents: -25000000, categoryId: 'cat-rent',
    }));
    await api(app, 'POST', '/api/v1/budget/2026-09/assign', { categoryId: 'cat-rent', amountCents: 25000000 });

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=40&asOf=2026-08-07');
    expect(data.totalShortfallCents).toBe(0);
  });

  it('expands a repeating rule into every occurrence in the window', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-food', amountCents: 5000000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      frequency: 'weekly', nextDate: '2026-08-10', amountCents: -1000000, categoryId: 'cat-food',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=28&asOf=2026-08-07');
    const aug = data.months.find((m: { month: string }) => m.month === '2026-08');
    const food = aug.categories.find((c: { categoryId: string }) => c.categoryId === 'cat-food');

    // 10, 17, 24, 31 August — four withdrawals of 10 000 against 50 000 assigned.
    expect(food.occurrences).toHaveLength(4);
    expect(food.scheduledNetCents).toBe(-4000000);
    expect(food.shortfallCents).toBe(0);
  });

  it('carries an unspent balance into the next month', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 25000000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-09-03', amountCents: -25000000, categoryId: 'cat-rent',
    }));

    // August's assignment is untouched, so it still covers September's payment.
    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=40&asOf=2026-08-07');
    expect(data.totalShortfallCents).toBe(0);
  });

  it('does not let an earlier month spend the same money twice', async () => {
    // 25 790 assigned once. Tele2 takes 15 490 in August and again in
    // September, and Kazakhtelecom takes 10 315 in September. A forecast that
    // reads Available fresh each month sees 25 790 in September and reports a
    // 15 shortfall; the real hole is 15 505, because August already spent.
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-phone', amountCents: 2579000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-30', amountCents: -1549000, categoryId: 'cat-phone', payeeName: 'Tele2',
    }));
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-09-07', amountCents: -1031500, categoryId: 'cat-phone', payeeName: 'Казахтелеком',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=55&asOf=2026-08-07');
    const aug = data.months.find((m: { month: string }) => m.month === '2026-08');
    const sep = data.months.find((m: { month: string }) => m.month === '2026-09');

    expect(aug.categories[0].availableCents).toBe(2579000);
    expect(aug.totalShortfallCents).toBe(0);

    // September starts from what August left, not from the original assignment.
    const phone = sep.categories.find((c: { categoryId: string }) => c.categoryId === 'cat-phone');
    expect(phone.availableCents).toBe(2579000 - 1549000);
    expect(phone.shortfallCents).toBe(1550500);
  });

  it('names scheduled money that reaches no category', async () => {
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-20', amountCents: -500000, payeeName: 'Что-то без категории',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    expect(data.uncategorizedUpcoming).toHaveLength(1);
    expect(data.uncategorizedUpcoming[0].payeeName).toBe('Что-то без категории');
  });

  it('leaves transfers out — they cannot starve a category', async () => {
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-20', amountCents: -500000, transferAccountId: 'acc-2',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    expect(data.months).toHaveLength(0);
    expect(data.uncategorizedUpcoming).toHaveLength(0);
  });

  it('reports the earliest breaking date across every category', async () => {
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-25', amountCents: -1000000, categoryId: 'cat-food',
    }));
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-12', amountCents: -1000000, categoryId: 'cat-rent',
    }));

    const { data } = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    expect(data.firstShortDate).toBe('2026-08-12');
  });

  it('can return only the categories that come up short', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-food', amountCents: 5000000 });
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-20', amountCents: -1000000, categoryId: 'cat-food',
    }));
    await api(app, 'POST', '/api/v1/scheduled', sched({
      nextDate: '2026-08-20', amountCents: -1000000, categoryId: 'cat-rent',
    }));

    const all = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07');
    const short = await api(app, 'GET', '/api/v1/budget/forecast?days=30&asOf=2026-08-07&onlyShort=true');

    expect(all.data.months[0].categories).toHaveLength(2);
    expect(short.data.months[0].categories).toHaveLength(1);
    expect(short.data.months[0].categories[0].categoryId).toBe('cat-rent');
  });

  it('rejects a nonsense horizon', async () => {
    expect((await api(app, 'GET', '/api/v1/budget/forecast?days=0')).status).toBe(400);
    expect((await api(app, 'GET', '/api/v1/budget/forecast?days=9999')).status).toBe(400);
    expect((await api(app, 'GET', '/api/v1/budget/forecast?asOf=07.08.2026')).status).toBe(400);
  });

  it('still serves a month whose name could look like the forecast route', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/budget/2026-08');
    expect(status).toBe(200);
    expect(data.month).toBe('2026-08');
  });
});
