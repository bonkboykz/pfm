import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      on_budget INTEGER NOT NULL DEFAULT 1, currency TEXT NOT NULL DEFAULT 'KZT',
      sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT, bank_name TEXT, last_4_digits TEXT, card_type TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES category_groups(id),
      name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0,
      target_amount_cents INTEGER, target_type TEXT DEFAULT 'none', target_date TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0,
      note TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      last_category_id TEXT REFERENCES categories(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      payee_id TEXT, payee_name TEXT, category_id TEXT,
      transfer_account_id TEXT, transfer_transaction_id TEXT,
      memo TEXT, cleared TEXT NOT NULL DEFAULT 'uncleared',
      approved INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_transaction_id);
    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL, assigned_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_budget_cat_month ON monthly_budgets(category_id, month);
    CREATE TABLE IF NOT EXISTS scheduled_transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      frequency TEXT NOT NULL, next_date TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      payee_name TEXT, category_id TEXT, transfer_account_id TEXT,
      memo TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      type TEXT NOT NULL, account_id TEXT, category_id TEXT,
      principal_cents INTEGER NOT NULL, apr_bps INTEGER NOT NULL DEFAULT 0,
      term_months INTEGER NOT NULL, start_date TEXT NOT NULL,
      monthly_payment_cents INTEGER NOT NULL, payment_day INTEGER NOT NULL,
      penalty_rate_bps INTEGER NOT NULL DEFAULT 0,
      early_repayment_fee_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS personal_debts (
      id TEXT PRIMARY KEY, person_name TEXT NOT NULL,
      direction TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KZT', due_date TEXT,
      note TEXT, is_settled INTEGER NOT NULL DEFAULT 0,
      settled_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();

  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

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

describe('Personal Debts API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  it('GET /api/v1/debts returns empty list with summary', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/debts');
    expect(status).toBe(200);
    expect(data.debts).toEqual([]);
    expect(data.summary.totalOweCents).toBe(0);
    expect(data.summary.totalOwedCents).toBe(0);
    expect(data.summary.netCents).toBe(0);
  });

  it('POST /api/v1/debts creates a debt (owe)', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/debts', {
      personName: 'Ансар С.',
      direction: 'owe',
      amountCents: 5000000,
      dueDate: '2026-03-15',
      note: 'За обед',
    });
    expect(status).toBe(201);
    expect(data.personName).toBe('Ансар С.');
    expect(data.direction).toBe('owe');
    expect(data.amountCents).toBe(5000000);
    expect(data.amountFormatted).toBe('50 000 ₸');
    expect(data.isSettled).toBe(false);
  });

  it('POST /api/v1/debts creates a debt (owed)', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/debts', {
      personName: 'Марат К.',
      direction: 'owed',
      amountCents: 3000000,
    });
    expect(status).toBe(201);
    expect(data.direction).toBe('owed');
  });

  it('GET /api/v1/debts returns debts with correct summary', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/debts');
    expect(status).toBe(200);
    expect(data.debts).toHaveLength(2);
    expect(data.summary.totalOweCents).toBe(5000000);
    expect(data.summary.totalOwedCents).toBe(3000000);
    expect(data.summary.netCents).toBe(-2000000);
    expect(data.summary.netFormatted).toBe('-20 000 ₸');
  });

  it('GET /api/v1/debts/:id returns single debt', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/debts');
    const { status, data } = await api(app, 'GET', `/api/v1/debts/${list.debts[0].id}`);
    expect(status).toBe(200);
    expect(data.personName).toBe('Ансар С.');
  });

  it('PATCH /api/v1/debts/:id updates debt', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/debts');
    const id = list.debts[0].id;
    const { status, data } = await api(app, 'PATCH', `/api/v1/debts/${id}`, {
      note: 'Updated note',
    });
    expect(status).toBe(200);
    expect(data.note).toBe('Updated note');
  });

  it('POST /api/v1/debts/:id/settle marks as settled', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/debts');
    const id = list.debts[0].id;
    const { status, data } = await api(app, 'POST', `/api/v1/debts/${id}/settle`);
    expect(status).toBe(200);
    expect(data.isSettled).toBe(true);
    expect(data.settledDate).toBeDefined();
  });

  it('POST /api/v1/debts/:id/settle on already settled returns 400', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/debts?includeSettled=true');
    const settled = list.debts.find((d: any) => d.isSettled);
    const { status } = await api(app, 'POST', `/api/v1/debts/${settled.id}/settle`);
    expect(status).toBe(400);
  });

  it('GET /api/v1/debts excludes settled by default', async () => {
    const { data } = await api(app, 'GET', '/api/v1/debts');
    expect(data.debts.every((d: any) => !d.isSettled)).toBe(true);
  });

  it('GET /api/v1/debts?includeSettled=true includes settled', async () => {
    const { data } = await api(app, 'GET', '/api/v1/debts?includeSettled=true');
    expect(data.debts.some((d: any) => d.isSettled)).toBe(true);
  });

  it('DELETE /api/v1/debts/:id deletes debt', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/debts');
    const id = list.debts[0].id;
    const { status } = await api(app, 'DELETE', `/api/v1/debts/${id}`);
    expect(status).toBe(200);

    const { status: getStatus } = await api(app, 'GET', `/api/v1/debts/${id}`);
    expect(getStatus).toBe(404);
  });

  it('GET /api/v1/debts/nonexistent returns 404', async () => {
    const { status } = await api(app, 'GET', '/api/v1/debts/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/v1/debts with invalid data returns 400', async () => {
    const { status } = await api(app, 'POST', '/api/v1/debts', {});
    expect(status).toBe(400);
  });
});
