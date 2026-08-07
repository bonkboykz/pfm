import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, initializeDatabase, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  initializeDatabase(sqlite);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  // Account
  sqlite.prepare(`INSERT INTO accounts (id, name, type, on_budget, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'checking', 1, 0, 1, ?, ?)`)
    .run('acc-halyk', 'Halyk', now, now);

  // Debt category group + category
  sqlite.prepare(`INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 0, 3, 0, ?)`)
    .run('grp-debt', 'Долги', now);
  sqlite.prepare(`INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)`)
    .run('cat-halyk-credit', 'grp-debt', 'Халық кредит', now);

  return db;
}

async function api(app: Hono, method: string, path: string, body?: any) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}

describe('Loans API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  it('GET /api/v1/loans returns empty list initially', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/loans');
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('POST /api/v1/loans creates a loan', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/loans', {
      name: 'Халық кредит',
      type: 'loan',
      accountId: 'acc-halyk',
      categoryId: 'cat-halyk-credit',
      principalCents: 200000000,
      aprBps: 1850,
      termMonths: 24,
      startDate: '2025-06-01',
      monthlyPaymentCents: 8500000,
      paymentDay: 25,
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Халық кредит');
    expect(data.currentDebtCents).toBe(200000000);
    expect(data.currentDebtFormatted).toBeDefined();
    expect(data.principalFormatted).toBeDefined();
  });

  it('GET /api/v1/loans lists created loan', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/loans');
    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Халық кредит');
  });

  it('GET /api/v1/loans/:id returns loan details', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/loans');
    const { status, data } = await api(app, 'GET', `/api/v1/loans/${list[0].id}`);
    expect(status).toBe(200);
    expect(data.principalCents).toBe(200000000);
  });

  it('PATCH /api/v1/loans/:id updates loan', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/loans');
    const { status, data } = await api(app, 'PATCH', `/api/v1/loans/${list[0].id}`, {
      note: 'Updated note',
    });
    expect(status).toBe(200);
    expect(data.note).toBe('Updated note');
  });

  it('GET /api/v1/loans/:id/schedule returns amortization', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/loans');
    const { status, data } = await api(app, 'GET', `/api/v1/loans/${list[0].id}/schedule`);
    expect(status).toBe(200);
    expect(data.schedule.length).toBe(24);
    expect(data.schedule[0].interestCents).toBeGreaterThan(0);
  });

  it('POST /api/v1/loans with paidOffCents reduces currentDebtCents', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/loans', {
      name: 'Forte кредит',
      type: 'loan',
      principalCents: 500000000,
      paidOffCents: 200000000,
      aprBps: 1200,
      termMonths: 36,
      startDate: '2024-01-01',
      monthlyPaymentCents: 15000000,
      paymentDay: 15,
    });
    expect(status).toBe(201);
    expect(data.paidOffCents).toBe(200000000);
    expect(data.paidOffFormatted).toBeDefined();
    // currentDebt = principal - paidOff (no category → no payment lookup)
    expect(data.currentDebtCents).toBe(300000000);
  });

  it('PATCH /api/v1/loans/:id updates paidOffCents', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/loans');
    const forte = list.find((l: any) => l.name === 'Forte кредит');
    const { status, data } = await api(app, 'PATCH', `/api/v1/loans/${forte.id}`, {
      paidOffCents: 350000000,
    });
    expect(status).toBe(200);
    expect(data.paidOffCents).toBe(350000000);
    expect(data.currentDebtCents).toBe(150000000);
  });

  it('POST /api/v1/loans creates installment (0% APR)', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/loans', {
      name: 'Kaspi Red iPhone',
      type: 'installment',
      principalCents: 45000000,
      aprBps: 0,
      termMonths: 6,
      startDate: '2026-01-01',
      monthlyPaymentCents: 7500000,
      paymentDay: 20,
    });
    expect(status).toBe(201);
    expect(data.aprBps).toBe(0);

    // Check schedule
    const { data: schedData } = await api(app, 'GET', `/api/v1/loans/${data.id}/schedule`);
    expect(schedData.schedule).toHaveLength(6);
    expect(schedData.schedule.every((e: any) => e.interestCents === 0)).toBe(true);
  });

  it('DELETE /api/v1/loans/:id soft deletes', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/loans');
    const id = list[list.length - 1].id;
    const { status } = await api(app, 'DELETE', `/api/v1/loans/${id}`);
    expect(status).toBe(200);

    // Should be gone from list
    const { data: newList } = await api(app, 'GET', '/api/v1/loans');
    expect(newList.find((l: any) => l.id === id)).toBeUndefined();
  });

  it('GET /api/v1/loans/nonexistent returns 404', async () => {
    const { status } = await api(app, 'GET', '/api/v1/loans/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/v1/loans with invalid data returns 400', async () => {
    const { status } = await api(app, 'POST', '/api/v1/loans', {});
    expect(status).toBe(400);
  });
});
