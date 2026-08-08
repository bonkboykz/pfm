import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * `POST /budget/:month/copy-from` — сделать месяц копией другого.
 * Это замена, а не merge: категория, которой назначили в целевом месяце, но
 * не назначали в источнике, обнуляется.
 */

const FROM = '2026-07';
const TO = '2026-08';

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function seed(db: DB) {
  const s = db.$client;
  const now = '2026-08-08T00:00:00.000Z';

  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Halyk', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(now, now);
  s.prepare(
    `INSERT INTO transactions
       (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
     VALUES ('tx-in', 'acc', 'ready-to-assign', '2026-07-01', 100000000, 'cleared', 1, 0, ?, ?)`,
  ).run(now, now);
  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Тест', 0, 1, 0, ?)`,
  ).run(now);

  const cat = s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'grp', ?, 0, ?, 0, ?)`,
  );
  cat.run('cat-rent', 'Аренда', 0, now);
  cat.run('cat-extra', 'Разовое', 1, now);

  const budget = s.prepare(
    `INSERT INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  budget.run('mb-1', 'cat-rent', FROM, 20000000, now, now);
  // Только в целевом месяце — должно обнулиться.
  budget.run('mb-2', 'cat-extra', TO, 7000000, now, now);
}

describe('POST /budget/:month/copy-from', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db);
    seed(db);
  });

  it('переносит суммы и обнуляет лишнее', async () => {
    const res = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: FROM,
    });

    expect(res.status).toBe(200);
    expect(res.data.sourceEmpty).toBe(false);
    expect(res.data.clearedCount).toBe(1);

    const byId = Object.fromEntries(
      res.data.budget.groups
        .flatMap((g: any) => g.categories)
        .map((c: any) => [c.categoryId, c.assignedCents]),
    );
    expect(byId['cat-rent']).toBe(20000000);
    expect(byId['cat-extra']).toBe(0);
  });

  it('сообщает, что именно изменилось', async () => {
    const res = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: FROM,
    });

    const applied = res.data.applied as any[];
    expect(applied).toHaveLength(2);
    expect(applied.find((a) => a.categoryId === 'cat-extra')).toMatchObject({
      fromCents: 7000000,
      toCents: 0,
    });
  });

  it('пустой источник ничего не трогает', async () => {
    const res = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: '2026-01',
    });

    expect(res.status).toBe(200);
    expect(res.data.sourceEmpty).toBe(true);
    expect(res.data.applied).toHaveLength(0);

    const extra = res.data.budget.groups
      .flatMap((g: any) => g.categories)
      .find((c: any) => c.categoryId === 'cat-extra');
    expect(extra.assignedCents).toBe(7000000);
  });

  it('отказывается копировать месяц в самого себя', async () => {
    const res = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: TO,
    });

    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('требует fromMonth в формате YYYY-MM', async () => {
    const res = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: 'июль',
    });

    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('повторный вызов ничего не меняет', async () => {
    await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, { fromMonth: FROM });
    const second = await api(app, 'POST', `/api/v1/budget/${TO}/copy-from`, {
      fromMonth: FROM,
    });

    expect(second.data.applied).toHaveLength(0);
    expect(second.data.clearedCount).toBe(0);
  });
});
