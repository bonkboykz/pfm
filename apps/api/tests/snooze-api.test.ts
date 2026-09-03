import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { categoryRoutes } from '../src/routes/categories.js';
import { budgetRoutes } from '../src/routes/budget.js';
import { errorHandler } from '../src/errors.js';

/**
 * Отложить цель на месяц через API.
 *
 * Снуз хранится месяцем, а не флагом, поэтому и в API это месяц: «отложено на
 * сентябрь», а не «отложено». В октябре цель просит денег сама, и вспоминать
 * о ней не нужно — этим снуз и отличается от снятия цели.
 */
describe('снуз цели через API', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/categories', categoryRoutes(db));
  app.route('/budget', budgetRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    db.insert(categories).values({
      id: 'rent', groupId: 'inflow-group', name: 'Аренда',
      targetAmountCents: 25000000, targetType: 'monthly_funding',
    }).onConflictDoNothing().run();
    db.update(categories).set({ targetSnoozedMonth: null }).run();
  });

  async function underfunded(month: string) {
    const res = await app.request(`/budget/${month}`);
    const json = await res.json();
    return json.groups
      .flatMap((g: { categories: unknown[] }) => g.categories)
      .find((c: { categoryId: string }) => c.categoryId === 'rent');
  }

  it('откладывает цель на указанный месяц', async () => {
    const res = await app.request('/categories/rent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSnoozedMonth: '2026-09' }),
    });
    expect(res.status).toBe(200);

    expect((await underfunded('2026-09')).underfundedCents).toBe(0);
    expect((await underfunded('2026-10')).underfundedCents).toBe(25000000);
  });

  it('снимает отложку', async () => {
    await app.request('/categories/rent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSnoozedMonth: '2026-09' }),
    });
    await app.request('/categories/rent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSnoozedMonth: null }),
    });

    expect((await underfunded('2026-09')).underfundedCents).toBe(25000000);
  });

  it('несуществующий месяц отклоняется', async () => {
    const res = await app.request('/categories/rent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSnoozedMonth: '2026-13' }),
    });
    expect(res.status).toBe(400);
  });

  it('состояние отложки видно в бюджете', async () => {
    await app.request('/categories/rent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSnoozedMonth: '2026-09' }),
    });

    expect((await underfunded('2026-09')).targetSnoozedMonth).toBe('2026-09');
    expect((await underfunded('2026-10')).targetSnoozedMonth).toBe('2026-09');
  });
});
