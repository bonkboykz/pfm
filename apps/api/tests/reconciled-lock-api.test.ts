import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Замок на сверенных операциях.
 *
 * Статус `reconciled` означает, что операция сверена с выпиской банка: её
 * сумма и дата подтверждены документом. Молча переписать её — значит увести
 * баланс от выписки и потерять единственную точку, к которой сверка была
 * привязана. Раньше PATCH этого не проверял вовсе, и статус был украшением.
 *
 * Расcверить операцию можно — но явно, отдельным действием, а не заодно с
 * правкой суммы.
 */
describe('замок на сверенных операциях', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/transactions', transactionRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    db.insert(categories)
      .values({ id: 'cat', groupId: 'inflow-group', name: 'Продукты' })
      .onConflictDoNothing().run();
    db.insert(transactions).values({
      id: 'tx-locked',
      accountId: 'acc',
      date: '2026-08-10',
      amountCents: -500000,
      categoryId: 'cat',
      cleared: 'reconciled',
    }).run();
  });

  function patch(body: Record<string, unknown>) {
    return app.request('/transactions/tx-locked', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('сумму сверенной операции менять нельзя', async () => {
    const res = await patch({ amountCents: -900000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/сверен/i);
  });

  it('дату сверенной операции менять нельзя', async () => {
    expect((await patch({ date: '2026-08-11' })).status).toBe(409);
  });

  // Счёт в схеме правки отсутствует — перенести операцию между счетами
  // нельзя вовсе, и запирать тут нечего. Но Zod выбрасывает лишнее поле
  // молча: PATCH с accountId вернёт 200, будто перенос состоялся. Это
  // отдельная беда, общая для всех маршрутов, и решать её надо строгими
  // схемами, а не здесь.

  it('категорию и памятку менять можно — на баланс они не влияют', async () => {
    // Разметка расходов уточняется месяцами после сверки, и запрещать это
    // значило бы заморозить категоризацию вместе с суммой.
    const res = await patch({ categoryId: 'cat', memo: 'уточнил' });
    expect(res.status).toBe(200);
  });

  it('расcверить можно, и после этого сумма правится', async () => {
    expect((await patch({ cleared: 'cleared' })).status).toBe(200);
    expect((await patch({ amountCents: -900000 })).status).toBe(200);
  });

  it('удалить сверенную операцию нельзя', async () => {
    const res = await app.request('/transactions/tx-locked', { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  it('несверенная операция правится как раньше', async () => {
    db.insert(transactions).values({
      id: 'tx-open', accountId: 'acc', date: '2026-08-10',
      amountCents: -500000, categoryId: 'cat', cleared: 'cleared',
    }).run();

    const res = await app.request('/transactions/tx-open', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: -900000 }),
    });
    expect(res.status).toBe(200);
  });
});
