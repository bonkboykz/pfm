import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { accountRoutes } from '../src/routes/accounts.js';
import { errorHandler } from '../src/errors.js';

/**
 * Архив и удаление — разные вещи.
 *
 * `DELETE` всегда только деактивировал счёт: он исчезал из списков, но
 * оставался в базе навсегда. Для закрытой карты это правильно — её операции
 * никуда не делись и участвуют в истории. Для счёта, заведённого по ошибке и
 * ни разу не использованного, это мусор, который нельзя убрать.
 *
 * Различает их не намерение, а данные: если операций нет, терять нечего.
 * Если есть — удаление унесло бы историю, и остаётся только архив.
 */
describe('удаление и архивация счёта', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/accounts', accountRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(accounts).run();
    db.insert(accounts).values([
      { id: 'empty', name: 'Заведён по ошибке', type: 'checking', onBudget: true },
      { id: 'used', name: 'Закрытая карта', type: 'checking', onBudget: true },
    ]).run();
    db.insert(categories)
      .values({ id: 'cat', groupId: 'inflow-group', name: 'Продукты' })
      .onConflictDoNothing().run();
    db.insert(transactions).values({
      id: 'tx', accountId: 'used', date: '2026-08-10',
      amountCents: -500000, categoryId: 'cat',
    }).run();
  });

  it('пустой счёт удаляется насовсем', async () => {
    const res = await app.request('/accounts/empty?purge=true', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const list = await (await app.request('/accounts?includeInactive=true')).json();
    expect(list.map((a: { id: string }) => a.id)).not.toContain('empty');
  });

  it('счёт с операциями удалить нельзя — только архив', async () => {
    const res = await app.request('/accounts/used?purge=true', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/операц/i);

    const list = await (await app.request('/accounts?includeInactive=true')).json();
    expect(list.map((a: { id: string }) => a.id)).toContain('used');
  });

  it('счёт, на который есть перевод, тоже не удаляется', async () => {
    // Операций «своих» нет, но вторая сторона перевода ссылается на счёт:
    // удалив его, мы оставили бы перевод в никуда.
    db.insert(transactions).values({
      id: 'tr', accountId: 'used', date: '2026-08-11',
      amountCents: -100000, transferAccountId: 'empty', transferTransactionId: 'tr2',
    }).run();

    const res = await app.request('/accounts/empty?purge=true', { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  it('без purge поведение прежнее — архивация', async () => {
    const res = await app.request('/accounts/used', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const list = await (await app.request('/accounts?includeInactive=true')).json();
    const acct = list.find((a: { id: string }) => a.id === 'used');
    expect(acct.isActive).toBe(false);
  });
});
