import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, deposits, scheduledTransactions, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { accountRoutes } from '../src/routes/accounts.js';
import { depositRoutes } from '../src/routes/deposits.js';
import { scheduledRoutes } from '../src/routes/scheduled.js';
import { errorHandler } from '../src/errors.js';

/**
 * Архивация должна быть обратимой.
 *
 * `DELETE` выключает счёт, вклад или правило, а обратно включить нечем:
 * `isActive` в схемах правки нет, да и сам PATCH архивную запись не находит —
 * маршруты требуют `isActive = true`. Архив получался ловушкой: закрыл по
 * ошибке — и починить можно только через базу.
 *
 * Читать архивное тоже надо: иначе не посмотреть, что именно закрыл.
 */
describe('архив обратим', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/accounts', accountRoutes(db));
  app.route('/deposits', depositRoutes(db));
  app.route('/scheduled', scheduledRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(scheduledTransactions).run();
    db.delete(deposits).run();
    db.delete(accounts).run();
    db.insert(accounts).values({
      id: 'acc', name: 'Закрытая карта', type: 'checking',
      onBudget: true, isActive: false,
    }).run();
    db.insert(deposits).values({
      id: 'dep', name: 'Вклад', bankName: 'Halyk', type: 'term',
      initialAmountCents: 10000000, annualRateBps: 1500, termMonths: 12,
      startDate: '2026-01-01', isActive: false,
    }).run();
    db.insert(accounts).values({
      id: 'acc-live', name: 'Живой', type: 'checking', onBudget: true,
    }).run();
    db.insert(scheduledTransactions).values({
      id: 'sch', accountId: 'acc-live', frequency: 'monthly',
      nextDate: '2026-10-01', amountCents: -100000, isActive: false,
    }).run();
  });

  it('архивный счёт можно прочитать', async () => {
    const res = await app.request('/accounts/acc');
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(false);
  });

  it('архивный счёт можно вернуть в строй', async () => {
    const res = await app.request('/accounts/acc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(true);
  });

  it('архивный счёт можно поправить, не воскрешая', async () => {
    // Чтобы вывести из бюджета унаследованный валютный счёт, не включая его
    // обратно в списки.
    const res = await app.request('/accounts/acc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onBudget: false }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.onBudget).toBe(false);
    expect(json.isActive).toBe(false);
  });

  it('архивный вклад возвращается', async () => {
    const res = await app.request('/deposits/dep', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(true);
  });

  it('архивное правило возвращается', async () => {
    const res = await app.request('/scheduled/sch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(true);
  });
});
