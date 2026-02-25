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
    CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(is_active);
    CREATE INDEX IF NOT EXISTS idx_loans_category ON loans(category_id);
    CREATE TABLE IF NOT EXISTS personal_debts (
      id TEXT PRIMARY KEY, person_name TEXT NOT NULL,
      direction TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KZT', due_date TEXT,
      note TEXT, is_settled INTEGER NOT NULL DEFAULT 0,
      settled_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  // Account
  sqlite.prepare(`INSERT INTO accounts (id, name, type, on_budget, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'checking', 1, 0, 1, ?, ?)`)
    .run('acc-halyk', 'Halyk', now, now);

  // Debt category group + category
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 0, 3, 0, ?)`)
    .run('grp-debt', 'Долги', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)`)
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
