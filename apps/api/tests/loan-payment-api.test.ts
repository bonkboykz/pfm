import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, loans } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { loanRoutes } from '../src/routes/loans.js';
import { errorHandler } from '../src/errors.js';

/**
 * Проведение платежа по кредиту.
 *
 * Одна операция делает два дела сразу: записывает трату в бюджете и уменьшает
 * тело долга ровно на свою часть. Порознь это не сходилось никогда — бюджет
 * видел платёж, модуль кредитов о нём не знал, и остаток жил своей жизнью.
 */
describe('POST /loans/:id/payment', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/loans', loanRoutes(db));

  beforeAll(() => {
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi Gold', type: 'checking', onBudget: true })
      .run();
    db.insert(categories)
      .values({ id: 'cat-loan', groupId: 'inflow-group', name: '🏦 Кредит' })
      .run();
    db.insert(loans).values({
      id: 'ln',
      name: 'Кредит наличными',
      type: 'loan',
      categoryId: 'cat-loan',
      // 1 000 000 ₸ под 36,5% — ровно 1000 ₸ процентов в день.
      principalCents: 100000000,
      aprBps: 3650,
      termMonths: 12,
      startDate: '2026-01-01',
      monthlyPaymentCents: 5000000,
      paymentDay: 11,
    }).run();
  });

  function pay(body: Record<string, unknown>) {
    return app.request('/loans/ln/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc', date: '2026-01-11', amountCents: 5000000, ...body }),
    });
  }

  it('разносит платёж и создаёт операцию', async () => {
    const res = await pay({});
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.split.interestCents).toBe(1000000);
    expect(json.split.principalCents).toBe(4000000);
    expect(json.transaction.amountCents).toBe(-5000000);
    expect(json.transaction.categoryId).toBe('cat-loan');
    expect(json.loan.currentDebtCents).toBe(96000000);
  });

  it('следующий платёж начисляет проценты только с прошлой даты', async () => {
    // Десять дней с 11-го по 21-е на уменьшившемся остатке 960 000 ₸:
    // 960 ₸ в день вместо тысячи.
    const res = await pay({ date: '2026-01-21' });
    const json = await res.json();

    expect(json.split.daysAccrued).toBe(10);
    expect(json.split.interestCents).toBe(960000);
    expect(json.split.principalCents).toBe(4040000);
  });

  it('досрочное погашение уходит в тело целиком сверх процентов', async () => {
    const before = await (await app.request('/loans/ln')).json();
    const res = await pay({ date: '2026-01-22', amountCents: 30000000 });
    const json = await res.json();

    expect(json.split.principalCents)
      .toBe(30000000 - json.split.interestCents);
    expect(json.loan.currentDebtCents)
      .toBe(before.currentDebtCents - json.split.principalCents);
  });

  it('неизвестный кредит — 404, а не молчаливая запись', async () => {
    const res = await app.request('/loans/нет-такого/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc', date: '2026-02-03', amountCents: 100000 }),
    });
    expect(res.status).toBe(404);
  });

  it('неизвестный счёт — 404 и ничего не записано', async () => {
    const before = await (await app.request('/loans/ln')).json();
    const res = await pay({ accountId: 'нет-такого', date: '2026-02-03' });
    expect(res.status).toBe(404);

    const after = await (await app.request('/loans/ln')).json();
    expect(after.currentDebtCents).toBe(before.currentDebtCents);
  });
});
