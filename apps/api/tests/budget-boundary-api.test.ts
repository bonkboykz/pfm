import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Категория на границе бюджета.
 *
 * Перевод за периметр — трата: деньги ушли со счетов и в бюджет уже не
 * вернутся сами. Без категории он снова стал бы невидимкой, а инвариант
 * «RTA + доступное = деньги на счетах» разъехался бы на его сумму.
 *
 * Внутри периметра всё наоборот: там ничего не потрачено, только переложено,
 * и категория означала бы трату, которой не было.
 */
describe('переводы через границу бюджета', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/transactions', transactionRoutes(db));

  beforeAll(() => {
    db.insert(accounts).values([
      { id: 'bank-a', name: 'Kaspi Gold', type: 'checking', onBudget: true },
      { id: 'bank-b', name: 'Forte Visa', type: 'checking', onBudget: true },
      { id: 'outside', name: 'Брокерский счёт', type: 'tracking', onBudget: false },
    ]).run();
    db.insert(categories)
      .values({ id: 'invest', groupId: 'inflow-group', name: 'Инвестиции' })
      .run();
  });

  function post(body: Record<string, unknown>) {
    return app.request('/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-08-10', amountCents: -2000000, ...body }),
    });
  }

  it('за периметр без категории — отказ', async () => {
    const res = await post({ accountId: 'bank-a', transferAccountId: 'outside' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/категор|categor/i);
  });

  it('за периметр с категорией — категория садится на бюджетную сторону', async () => {
    const res = await post({
      accountId: 'bank-a',
      transferAccountId: 'outside',
      categoryId: 'invest',
    });
    expect(res.status).toBe(201);

    const [out, into] = await res.json();
    expect(out.accountId).toBe('bank-a');
    expect(out.categoryId).toBe('invest');
    expect(into.accountId).toBe('outside');
    expect(into.categoryId).toBeNull();
  });

  it('внутрь бюджета категория садится на бюджетную сторону, а не на внешнюю', async () => {
    const res = await post({
      accountId: 'outside',
      transferAccountId: 'bank-a',
      amountCents: -5000000,
      categoryId: 'ready-to-assign',
    });
    expect(res.status).toBe(201);

    const [out, into] = await res.json();
    expect(out.accountId).toBe('outside');
    expect(out.categoryId).toBeNull();
    expect(into.accountId).toBe('bank-a');
    expect(into.categoryId).toBe('ready-to-assign');
  });

  it('между бюджетными счетами категория — отказ', async () => {
    const res = await post({
      accountId: 'bank-a',
      transferAccountId: 'bank-b',
      categoryId: 'invest',
    });
    expect(res.status).toBe(400);
  });

  it('между бюджетными счетами без категории — как раньше', async () => {
    const res = await post({ accountId: 'bank-a', transferAccountId: 'bank-b' });
    expect(res.status).toBe(201);
    const [out, into] = await res.json();
    expect(out.categoryId).toBeNull();
    expect(into.categoryId).toBeNull();
  });

  it('обычной операции внебюджетного счёта категорию поставить нельзя', async () => {
    // Сегодня безвредно: выборки фильтруют on_budget. Но включи счёт в
    // бюджет — и та же строка начнёт считаться тратой задним числом.
    const res = await post({ accountId: 'outside', categoryId: 'invest' });
    expect(res.status).toBe(400);
  });
});
