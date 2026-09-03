import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { budgetRoutes } from '../src/routes/budget.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Месяц должен существовать, а не просто выглядеть как месяц.
 *
 * `^\d{4}-\d{2}$` пропускает 2026-13 и 2026-00. Дальше такой месяц ведёт себя
 * почти правдоподобно: сравнение строк работает, границы `-01`/`-31`
 * строятся — и запрос возвращает пустой бюджет вместо ошибки. Опечатка в
 * номере месяца выглядит как «в этом месяце ничего нет».
 */
describe('валидация месяца', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/budget', budgetRoutes(db));
  app.route('/transactions', transactionRoutes(db));

  beforeAll(() => {
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi', type: 'checking', onBudget: true })
      .run();
    db.insert(categories)
      .values({ id: 'cat', groupId: 'inflow-group', name: 'Продукты' })
      .run();
  });

  for (const bad of ['2026-13', '2026-00', '2026-99']) {
    it(`${bad} — не месяц`, async () => {
      const res = await app.request(`/budget/${bad}`);
      expect(res.status).toBe(400);
    });
  }

  for (const good of ['2026-01', '2026-09', '2026-12']) {
    it(`${good} — месяц`, async () => {
      const res = await app.request(`/budget/${good}`);
      expect(res.status).toBe(200);
    });
  }

  it('назначение в несуществующий месяц отклоняется', async () => {
    const res = await app.request('/budget/2026-13/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: 'cat', amountCents: 100000 }),
    });
    expect(res.status).toBe(400);
  });

  // Та же дыра в датах: `\d{2}-\d{2}` пропускает 31 февраля и 45-е число.
  // Такая операция ложится в базу и всплывает потом кривой сортировкой и
  // месяцем, которого не было.
  for (const bad of ['2026-02-31', '2026-13-01', '2026-04-31', '2026-01-00']) {
    it(`операция на ${bad} не создаётся`, async () => {
      const res = await app.request('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: 'acc', date: bad, amountCents: -1000, categoryId: 'cat',
        }),
      });
      expect(res.status).toBe(400);
    });
  }

  it('29 февраля високосного года — настоящая дата', async () => {
    const res = await app.request('/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'acc', date: '2028-02-29', amountCents: -1000, categoryId: 'cat',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('копирование из несуществующего месяца отклоняется', async () => {
    const res = await app.request('/budget/2026-09/copy-from', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromMonth: '2026-13' }),
    });
    expect(res.status).toBe(400);
  });
});
