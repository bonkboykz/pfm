import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Список обязан признаваться, что показал не всё.
 *
 * `GET /transactions` отдавал 50 строк из скольких угодно и молчал об этом.
 * Для человека это «недогрузилось», для агента — данные: он суммирует
 * пятьдесят операций и объявляет результат месячным расходом. Ошибка при этом
 * выглядит как аккуратный ответ.
 *
 * Поэтому список отдаёт не голый массив, а сколько всего есть и есть ли ещё,
 * плюс смещение для следующей страницы.
 */
describe('пагинация списка операций', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/transactions', transactionRoutes(db));

  beforeAll(() => {
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi', type: 'checking', onBudget: true })
      .run();
    db.insert(categories)
      .values({ id: 'cat', groupId: 'inflow-group', name: 'Продукты' })
      .run();
    db.insert(transactions).values(
      Array.from({ length: 120 }, (_, i) => ({
        id: `tx-${String(i).padStart(3, '0')}`,
        accountId: 'acc',
        date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
        amountCents: -1000 * (i + 1),
        categoryId: 'cat',
        payeeName: i % 3 === 0 ? 'Магнум' : 'Wolt',
      })),
    ).run();
  });

  it('говорит, сколько всего операций и есть ли ещё', async () => {
    const res = await app.request('/transactions?limit=50');
    const json = await res.json();

    expect(json.transactions).toHaveLength(50);
    expect(json.totalCount).toBe(120);
    expect(json.hasMore).toBe(true);
  });

  it('смещение даёт следующую страницу без повторов', async () => {
    const first = await (await app.request('/transactions?limit=50')).json();
    const second = await (await app.request('/transactions?limit=50&offset=50')).json();

    const ids = new Set(first.transactions.map((t: { id: string }) => t.id));
    for (const t of second.transactions) expect(ids.has(t.id)).toBe(false);
  });

  it('последняя страница честно говорит, что больше нет', async () => {
    const last = await (await app.request('/transactions?limit=50&offset=100')).json();

    expect(last.transactions).toHaveLength(20);
    expect(last.hasMore).toBe(false);
  });

  it('totalCount считает по фильтру, а не по всей базе', async () => {
    // Иначе «есть ещё» соврёт: сказать про 120, показав 40 отфильтрованных.
    const res = await app.request('/transactions?limit=10&search=Магнум');
    const json = await res.json();

    expect(json.totalCount).toBe(40);
    expect(json.hasMore).toBe(true);
  });

  it('поиск идёт по всей базе, а не по загруженной странице', async () => {
    // Раньше искали среди первых 50 строк, и операция с 80-го места просто
    // не находилась — при том что список выглядел полным.
    const res = await app.request('/transactions?search=Wolt&limit=200');
    const json = await res.json();

    expect(json.totalCount).toBe(80);
    expect(json.transactions.every((t: { payeeName: string }) => t.payeeName === 'Wolt'))
      .toBe(true);
  });
});
