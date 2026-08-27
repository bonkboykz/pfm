import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { scheduledRoutes } from '../src/routes/scheduled.js';
import { errorHandler } from '../src/errors.js';

/**
 * Флаг автопроведения по API.
 *
 * Правило-напоминание бесполезно, если о нём нельзя узнать снаружи: клиент,
 * который не видит `autoPost`, показал бы платёж по кредиту как «спишется
 * само» — ровно то, чего флаг и должен избежать.
 */
describe('autoPost через API', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/scheduled', scheduledRoutes(db));

  beforeAll(() => {
    db.insert(accounts).values({ id: 'acc', name: 'Kaspi', type: 'checking' }).run();
    db.insert(categories)
      .values({ id: 'cat-loan', groupId: 'inflow-group', name: 'Кредит' })
      .run();
  });

  async function create(body: Record<string, unknown>) {
    const res = await app.request('/scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'acc',
        frequency: 'monthly',
        nextDate: '2026-09-20',
        amountCents: -5000000,
        payeeName: 'Halyk',
        categoryId: 'cat-loan',
        ...body,
      }),
    });
    return { res, json: await res.json() };
  }

  it('создаёт правило-напоминание с autoPost=false', async () => {
    const { res, json } = await create({ autoPost: false });
    expect(res.status).toBe(201);
    expect(json.autoPost).toBe(false);
  });

  it('без флага правило остаётся автопроводимым', async () => {
    const { json } = await create({});
    expect(json.autoPost).toBe(true);
  });

  it('флаг переключается патчем', async () => {
    const { json: created } = await create({});
    const res = await app.request(`/scheduled/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoPost: false }),
    });
    expect((await res.json()).autoPost).toBe(false);
  });

  it('список показывает флаг', async () => {
    const { json: created } = await create({ autoPost: false });
    const res = await app.request('/scheduled');
    const { scheduled } = await res.json();
    const row = scheduled.find((s: any) => s.id === created.id);
    expect(row.autoPost).toBe(false);
  });
});
