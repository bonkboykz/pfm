import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { accounts, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { accountRoutes } from '../src/routes/accounts.js';
import { errorHandler } from '../src/errors.js';

/**
 * Счёт в чужой валюте не может быть в бюджете.
 *
 * Движок складывает суммы как целые минорные единицы, не глядя на валюту:
 * 100 юаней и 100 тенге для него одно и то же число. Пока валютные счета вне
 * бюджета, это безвредно — выборки фильтруют `on_budget = 1`. Стоит включить
 * такой счёт в бюджет с ненулевым остатком, и RTA соврёт молча, без единой
 * ошибки в логах.
 *
 * Настоящая поддержка валют — курсы на дату, переоценка остатков — это
 * отдельная работа. До неё честнее запретить, чем считать неправильно.
 */
describe('валютный счёт вне бюджета', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/accounts', accountRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(accounts).run();
  });

  function create(body: Record<string, unknown>) {
    return app.request('/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Наличные', type: 'cash', ...body }),
    });
  }

  it('создать валютный счёт в бюджете нельзя', async () => {
    const res = await create({ currency: 'USD', onBudget: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/валют/i);
  });

  it('валютный счёт вне бюджета создаётся', async () => {
    const res = await create({ currency: 'USD', onBudget: false });
    expect(res.status).toBe(201);
  });

  it('тенговый счёт в бюджете — как раньше', async () => {
    const res = await create({ currency: 'KZT', onBudget: true });
    expect(res.status).toBe(201);
  });

  it('втащить валютный счёт в бюджет правкой тоже нельзя', async () => {
    const { id } = await (await create({ currency: 'EUR', onBudget: false })).json();

    const res = await app.request(`/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onBudget: true }),
    });
    expect(res.status).toBe(400);
  });

  it('и сменить валюту бюджетному счёту нельзя', async () => {
    // Обходной путь той же дыры: счёт уже в бюджете, меняем валюту.
    const { id } = await (await create({ currency: 'KZT', onBudget: true })).json();

    const res = await app.request(`/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD' }),
    });
    expect(res.status).toBe(400);
  });

  it('вывести валютный счёт из бюджета можно', async () => {
    // Иначе унаследованный счёт с чужой валютой не починить.
    const { id } = await (await create({ currency: 'KZT', onBudget: true })).json();
    // Прод-случай: счёт завели до появления проверки, чиним через API.
    db.update(accounts).set({ currency: 'CNY' }).where(eq(accounts.id, id)).run();

    const res = await app.request(`/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onBudget: false }),
    });
    expect(res.status).toBe(200);
  });
});
