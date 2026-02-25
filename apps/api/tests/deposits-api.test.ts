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
      paid_off_cents INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, bank_name TEXT NOT NULL,
      type TEXT NOT NULL, account_id TEXT, category_id TEXT,
      initial_amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'KZT',
      annual_rate_bps INTEGER NOT NULL, early_withdrawal_rate_bps INTEGER NOT NULL DEFAULT 0,
      term_months INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
      capitalization TEXT NOT NULL DEFAULT 'monthly',
      is_withdrawable INTEGER NOT NULL DEFAULT 0, is_replenishable INTEGER NOT NULL DEFAULT 0,
      min_balance_cents INTEGER NOT NULL DEFAULT 0, top_up_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deposits_active ON deposits(is_active);
    CREATE INDEX IF NOT EXISTS idx_deposits_bank ON deposits(bank_name);
  `);

  const now = new Date().toISOString();

  // System records
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

describe('Deposits API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  it('GET /api/v1/deposits returns empty list initially', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits');
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('POST /api/v1/deposits creates a term deposit', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/deposits', {
      name: 'Halyk Срочный 14.5%',
      bankName: 'Halyk Bank',
      type: 'term',
      initialAmountCents: 100000000,
      annualRateBps: 1450,
      termMonths: 12,
      startDate: '2025-06-01',
      endDate: '2026-06-01',
      capitalization: 'monthly',
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Halyk Срочный 14.5%');
    expect(data.initialAmountCents).toBe(100000000);
    expect(data.initialAmountFormatted).toBeDefined();
    expect(data.currentBalanceCents).toBe(100000000);
    expect(data.currentBalanceFormatted).toBeDefined();
    expect(data.projectedInterestCents).toBeGreaterThan(0);
  });

  it('GET /api/v1/deposits lists created deposit', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits');
    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Halyk Срочный 14.5%');
  });

  it('GET /api/v1/deposits/:id returns deposit details', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'GET', `/api/v1/deposits/${list[0].id}`);
    expect(status).toBe(200);
    expect(data.initialAmountCents).toBe(100000000);
    expect(data.annualRateBps).toBe(1450);
  });

  it('PATCH /api/v1/deposits/:id updates topUpCents', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'PATCH', `/api/v1/deposits/${list[0].id}`, {
      topUpCents: 50000000,
    });
    expect(status).toBe(200);
    expect(data.topUpCents).toBe(50000000);
    // Balance should reflect topUp (no account linked)
    expect(data.currentBalanceCents).toBe(150000000);
  });

  it('GET /api/v1/deposits/:id/schedule returns interest schedule', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'GET', `/api/v1/deposits/${list[0].id}/schedule`);
    expect(status).toBe(200);
    expect(data.schedule.length).toBe(12);
    expect(data.schedule[0].interestCents).toBeGreaterThan(0);
    expect(data.schedule[0].interestFormatted).toBeDefined();
    expect(data.schedule[11].endBalanceCents).toBeGreaterThan(150000000);
  });

  it('POST /api/v1/deposits creates savings (perpetual) deposit', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/deposits', {
      name: 'Kaspi Накопительный',
      bankName: 'Kaspi Bank',
      type: 'savings',
      initialAmountCents: 50000000,
      annualRateBps: 1000,
      termMonths: 0,
      startDate: '2025-01-01',
      isWithdrawable: true,
      isReplenishable: true,
    });
    expect(status).toBe(201);
    expect(data.type).toBe('savings');
    expect(data.termMonths).toBe(0);
    expect(data.isWithdrawable).toBe(true);
  });

  it('DELETE /api/v1/deposits/:id soft deletes', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const lastId = list[list.length - 1].id;
    const { status } = await api(app, 'DELETE', `/api/v1/deposits/${lastId}`);
    expect(status).toBe(200);

    const { data: newList } = await api(app, 'GET', '/api/v1/deposits');
    expect(newList.find((d: any) => d.id === lastId)).toBeUndefined();
  });

  it('GET /api/v1/deposits/kdif returns KDIF exposure', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits/kdif');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    // We have 1 active deposit (Halyk)
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].bankName).toBeDefined();
    expect(data[0].totalDepositsCents).toBeGreaterThan(0);
    expect(data[0].guaranteeLimitCents).toBe(1500000000);
    expect(data[0].totalDepositsFormatted).toBeDefined();
  });

  it('GET /api/v1/deposits/nonexistent returns 404', async () => {
    const { status } = await api(app, 'GET', '/api/v1/deposits/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/v1/deposits with invalid data returns 400', async () => {
    const { status } = await api(app, 'POST', '/api/v1/deposits', {});
    expect(status).toBe(400);
  });

  it('POST /api/v1/simulate/deposit-compare compares deposits', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/simulate/deposit-compare', {
      deposits: [
        { name: 'Halyk 14.5%', initialAmountCents: 100000000, annualRateBps: 1450, termMonths: 12, capitalization: 'monthly' },
        { name: 'Kaspi 12%', initialAmountCents: 100000000, annualRateBps: 1200, termMonths: 12, capitalization: 'quarterly' },
      ],
    });
    expect(status).toBe(200);
    expect(data.deposits).toHaveLength(2);
    expect(data.recommended).toBe('Halyk 14.5%');
    expect(data.explanation).toContain('Halyk 14.5%');
    expect(data.deposits[0].totalInterestFormatted).toBeDefined();
    expect(data.deposits[0].schedule.length).toBe(12);
  });
});
