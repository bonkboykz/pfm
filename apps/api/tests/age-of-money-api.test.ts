import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { budgetRoutes } from '../src/routes/budget.js';
import { errorHandler } from '../src/errors.js';

/**
 * Возраст денег по API.
 *
 * Отдельная ручка, а не поле месяца: метрика отвечает на вопрос «как сейчас»,
 * и привязывать её к месяцу значило бы приглашать смотреть возраст за январь,
 * которого уже не изменить.
 */
describe('GET /budget/age-of-money', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/budget', budgetRoutes(db));

  beforeAll(() => {
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi Gold', type: 'checking', onBudget: true })
      .run();
    db.insert(categories)
      .values({ id: 'food', groupId: 'inflow-group', name: 'Продукты' })
      .run();
    db.insert(transactions).values([
      { id: 'in-1', accountId: 'acc', date: '2026-01-01', amountCents: 10000000, categoryId: 'ready-to-assign' },
      { id: 'out-1', accountId: 'acc', date: '2026-01-21', amountCents: -1000000, categoryId: 'food' },
    ]).run();
  });

  it('считает возраст на указанную дату', async () => {
    const res = await app.request('/budget/age-of-money?asOf=2026-01-31');
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.days).toBe(20);
    expect(json.sampleSize).toBe(1);
    expect(json.asOfDate).toBe('2026-01-31');
  });

  it('нечего мерить — days равен null, а не нулю', async () => {
    // Ноль означал бы «трачу ровно с колёс» — утверждение о финансах.
    // Отсутствие данных так подавать нельзя.
    const res = await app.request('/budget/age-of-money?asOf=2025-12-31');
    const json = await res.json();

    expect(json.days).toBeNull();
    expect(json.explanation).toMatch(/недостаточно|нет данных/i);
  });

  it('кривую дату отклоняет', async () => {
    const res = await app.request('/budget/age-of-money?asOf=январь');
    expect(res.status).toBe(400);
  });
});
