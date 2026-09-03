import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions, monthlyBudgets, scheduledTransactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { budgetRoutes } from '../src/routes/budget.js';
import { errorHandler } from '../src/errors.js';

/**
 * Один ответ на вопрос «что делать в этом месяце».
 *
 * Раньше картина собиралась из пяти вызовов — RTA, бюджет, нехватки,
 * сверка, расписание — и склеивалась арифметикой в голове агента. Ровно там
 * он и ошибался: складывал недофинансирование с перерасходом, путал остаток
 * категории с назначенным, объявлял месяц спокойным, потому что смотрел не
 * туда.
 *
 * Числа считает движок, а вызывающему остаётся их прочитать.
 */
describe('GET /budget/:month/overview', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/budget', budgetRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.delete(monthlyBudgets).run();
    db.delete(scheduledTransactions).run();
    db.insert(accounts)
      .values({ id: 'acc', name: 'Kaspi', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    for (const [id, name, target] of [
      ['rent', 'Аренда', 25000000],
      ['food', 'Продукты', null],
    ] as const) {
      db.insert(categories).values({
        id, groupId: 'inflow-group', name,
        targetAmountCents: target, targetType: target ? 'monthly_funding' : 'none',
      }).onConflictDoNothing().run();
    }
  });

  async function overview(month = '2026-09') {
    const res = await app.request(`/budget/${month}/overview`);
    return res.json();
  }

  it('называет свободные деньги и признаёт, когда их нет', async () => {
    db.insert(transactions).values({
      id: 'in', accountId: 'acc', date: '2026-09-01',
      amountCents: 5000000, categoryId: 'ready-to-assign',
    }).run();

    const json = await overview();
    expect(json.readyToAssignCents).toBe(5000000);
    expect(json.isOverAssigned).toBe(false);
  });

  it('перечисляет перерасходы с суммами', async () => {
    db.insert(transactions).values({
      id: 'out', accountId: 'acc', date: '2026-09-10',
      amountCents: -300000, categoryId: 'food',
    }).run();

    const json = await overview();
    expect(json.overspent).toHaveLength(1);
    expect(json.overspent[0].categoryId).toBe('food');
    expect(json.overspent[0].amountCents).toBe(300000);
  });

  it('показывает недофинансирование по целям', async () => {
    const json = await overview();
    expect(json.underfundedCents).toBe(25000000);
    expect(json.underfunded[0].categoryId).toBe('rent');
  });

  it('называет ближайшие обязательные платежи с датами', async () => {
    db.insert(scheduledTransactions).values({
      id: 'sch', accountId: 'acc', frequency: 'monthly',
      nextDate: '2026-09-20', amountCents: -1000000, payeeName: 'Halyk',
    }).run();

    const json = await overview();
    expect(json.upcoming[0].payeeName).toBe('Halyk');
    expect(json.upcoming[0].nextDate).toBe('2026-09-20');
  });

  it('предлагает покрыть перерасход, когда есть чем', async () => {
    db.insert(transactions).values([
      { id: 'in', accountId: 'acc', date: '2026-09-01', amountCents: 5000000, categoryId: 'ready-to-assign' },
      { id: 'out', accountId: 'acc', date: '2026-09-10', amountCents: -300000, categoryId: 'food' },
    ]).run();

    const json = await overview();
    const action = json.actions.find((a: { tool: string }) => a.tool === 'assign_budget');
    expect(action).toBeDefined();
    expect(action.arguments.categoryId).toBe('food');
    expect(action.arguments.amountCents).toBe(300000);
  });

  it('не предлагает того, на что нет денег', async () => {
    // Перерасход есть, свободных денег нет: совет «покрой» был бы издевательством.
    db.insert(transactions).values({
      id: 'out', accountId: 'acc', date: '2026-09-10',
      amountCents: -300000, categoryId: 'food',
    }).run();

    const json = await overview();
    expect(json.actions.some((a: { tool: string }) => a.tool === 'assign_budget'))
      .toBe(false);
  });

  it('в спокойном месяце список действий пуст, а не выдуман', async () => {
    db.insert(transactions).values({
      id: 'in', accountId: 'acc', date: '2026-09-01',
      amountCents: 5000000, categoryId: 'ready-to-assign',
    }).run();
    db.insert(monthlyBudgets).values({
      id: 'mb', categoryId: 'rent', month: '2026-09', assignedCents: 2500000,
    }).run();
    db.update(categories).set({ targetAmountCents: 2500000 }).run();

    const json = await overview();
    expect(json.overspent).toEqual([]);
    expect(json.actions.filter((a: { tool: string }) => a.tool === 'assign_budget'))
      .toEqual([]);
  });
});
