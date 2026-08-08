import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * `POST /budget/:month/assign-targets` — раздача по целям с остановкой на нуле
 * Ready to Assign. Правило должно держаться на уровне HTTP: этой же ручкой
 * пользуется агент, а не только кнопка в приложении.
 */

const MONTH = '2026-08';

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

function seed(db: DB, inflowCents: number) {
  const s = db.$client;
  const now = '2026-08-08T00:00:00.000Z';

  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Halyk', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(now, now);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Цели', 0, 1, 0, ?)`,
  ).run(now);

  if (inflowCents !== 0) {
    s.prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES ('tx-in', 'acc', 'ready-to-assign', ?, ?, 'cleared', 1, 0, ?, ?)`,
    ).run(`${MONTH}-01`, inflowCents, now, now);
  }

  const insert = s.prepare(
    `INSERT INTO categories
       (id, group_id, name, is_system, sort_order, is_hidden,
        target_amount_cents, target_type, target_date, created_at)
     VALUES (?, 'grp', ?, 0, ?, 0, ?, ?, ?, ?)`,
  );
  insert.run('cat-rent', 'Аренда', 0, 20000000, 'monthly_funding', null, now);
  insert.run('cat-fix', 'Ремонт', 1, 5000000, 'target_by_date', '2026-09-10', now);
}

describe('POST /budget/:month/assign-targets', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db);
  });

  it('раздаёт по целям, когда денег хватает', async () => {
    seed(db, 100000000);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`, {});

    expect(res.status).toBe(200);
    // «Ремонт» с датой финансируется первым: 50 000 ₸ к 10 сентября — два месяца.
    expect(res.data.applied.map((a: any) => [a.categoryId, a.addedCents])).toEqual([
      ['cat-fix', 2500000],
      ['cat-rent', 20000000],
    ]);
    expect(res.data.totalAddedCents).toBe(22500000);
    expect(res.data.stoppedAtZeroRta).toBe(false);
    expect(res.data.remainingUnderfundedCents).toBe(0);
    expect(res.data.readyToAssignCents).toBe(77500000);
  });

  it('останавливается на нуле RTA и честно сообщает об этом', async () => {
    seed(db, 3000000);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`, {});

    expect(res.status).toBe(200);
    expect(res.data.totalAddedCents).toBe(3000000);
    expect(res.data.stoppedAtZeroRta).toBe(true);
    expect(res.data.readyToAssignCents).toBe(0);
    expect(res.data.remainingUnderfundedCents).toBe(19500000);
  });

  it('при пустом RTA не назначает ничего', async () => {
    seed(db, 0);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`, {});

    expect(res.status).toBe(200);
    expect(res.data.applied).toHaveLength(0);
    expect(res.data.stoppedAtZeroRta).toBe(true);
    expect(res.data.readyToAssignCents).toBe(0);
  });

  it('без тела запроса ведёт себя безопасно — не уводит RTA в минус', async () => {
    seed(db, 3000000);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`);

    expect(res.status).toBe(200);
    expect(res.data.readyToAssignCents).toBe(0);
    expect(res.data.stoppedAtZeroRta).toBe(true);
  });

  it('allowNegativeRta раздаёт всё и уводит RTA в минус', async () => {
    seed(db, 3000000);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`, {
      allowNegativeRta: true,
    });

    expect(res.status).toBe(200);
    expect(res.data.totalAddedCents).toBe(22500000);
    expect(res.data.readyToAssignCents).toBe(-19500000);
    expect(res.data.remainingUnderfundedCents).toBe(0);
  });

  it('отбивает неверный месяц', async () => {
    seed(db, 100000000);

    const res = await api(app, 'POST', '/api/v1/budget/2026-8/assign-targets', {});

    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });

  it('возвращает месяц целиком, чтобы клиент не перезапрашивал', async () => {
    seed(db, 100000000);

    const res = await api(app, 'POST', `/api/v1/budget/${MONTH}/assign-targets`, {});

    expect(res.data.budget.month).toBe(MONTH);
    expect(res.data.budget.totalUnderfundedCents).toBe(0);
    expect(res.data.budget.groups).toBeInstanceOf(Array);
  });
});
