import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Сплит через API.
 *
 * Каспи списывает пять рассрочек одной строкой на 107 940 ₸. Разбивать её на
 * пять операций руками значит развести приложение с выпиской: в банке одна
 * строка, у нас пять, и сматчить их при импорте нечем.
 *
 * Части создаются вместе с родителем и только целиком: половина сплита — это
 * покупка, у которой часть суммы потерялась.
 */
describe('сплит-операции', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/transactions', transactionRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi Gold', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    for (const [id, name] of [['c-a', 'Рассрочка А'], ['c-b', 'Рассрочка Б']]) {
      db.insert(categories)
        .values({ id, groupId: 'inflow-group', name })
        .onConflictDoNothing().run();
    }
  });

  function create(body: Record<string, unknown>) {
    return app.request('/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'acc', date: '2026-09-03', amountCents: -10000000,
        payeeName: 'Kaspi', ...body,
      }),
    });
  }

  const splits = [
    { categoryId: 'c-a', amountCents: -6000000 },
    { categoryId: 'c-b', amountCents: -4000000, memo: 'вторая рассрочка' },
  ];

  it('создаёт родителя и части одним вызовом', async () => {
    const res = await create({ splits });
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.categoryId).toBeNull();
    expect(json.splits).toHaveLength(2);
    expect(json.splits[0].categoryId).toBe('c-a');
    expect(json.splits[1].memo).toBe('вторая рассрочка');
  });

  it('части, не сходящиеся с суммой, отклоняются целиком', async () => {
    const res = await create({
      splits: [
        { categoryId: 'c-a', amountCents: -6000000 },
        { categoryId: 'c-b', amountCents: -3000000 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/сумм/i);
    // Ничего не записалось: половина сплита хуже, чем его отсутствие.
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('неизвестная категория в части отклоняет весь сплит', async () => {
    const res = await create({
      splits: [
        { categoryId: 'c-a', amountCents: -6000000 },
        { categoryId: 'нет-такой', amountCents: -4000000 },
      ],
    });
    expect(res.status).toBe(404);
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it('категория у родителя вместе с частями — противоречие', async () => {
    const res = await create({ splits, categoryId: 'c-a' });
    expect(res.status).toBe(400);
  });

  it('одна часть — это не сплит', async () => {
    const res = await create({
      splits: [{ categoryId: 'c-a', amountCents: -10000000 }],
    });
    expect(res.status).toBe(400);
  });

  it('операция отдаётся с частями при чтении', async () => {
    const { id } = await (await create({ splits })).json();

    const res = await app.request(`/transactions/${id}`);
    const json = await res.json();
    expect(json.splits).toHaveLength(2);
  });

  it('удаление родителя уносит части', async () => {
    // Иначе части остались бы висеть в бюджете без покупки.
    const { id } = await (await create({ splits })).json();
    await app.request(`/transactions/${id}`, { method: 'DELETE' });

    const alive = db.select().from(transactions).all().filter((t) => !t.isDeleted);
    expect(alive).toHaveLength(0);
  });

  it('в списке части не показываются отдельными строками', async () => {
    // В банке это одна покупка, и в ленте она должна быть одной.
    await create({ splits });

    const list = await (await app.request('/transactions')).json();
    expect(list).toHaveLength(1);
    expect(list[0].splits).toHaveLength(2);
  });
});
