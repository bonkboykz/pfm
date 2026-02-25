import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { advanceDate, getUpcoming, processDue } from '../src/scheduler/engine.js';

// --- Deterministic IDs ---

const acc = {
  kaspiGold: 'acc-kaspi-gold',
  halyk: 'acc-halyk',
};

const grp = {
  inflow: 'inflow-group',
  fixed: 'grp-fixed',
};

const cat = {
  readyToAssign: 'ready-to-assign',
  rent: 'cat-rent',
};

const sched = {
  rent: 'sched-rent',
  transfer: 'sched-transfer',
  inactive: 'sched-inactive',
  farFuture: 'sched-far-future',
};

// --- DDL + Seed ---

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking')),
      on_budget INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'KZT',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES category_groups(id),
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      target_amount_cents INTEGER,
      target_type TEXT DEFAULT 'none' CHECK(target_type IN ('none', 'monthly_funding', 'target_balance', 'target_by_date')),
      target_date TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      last_category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payee_id TEXT REFERENCES payees(id),
      payee_name TEXT,
      category_id TEXT REFERENCES categories(id),
      transfer_account_id TEXT REFERENCES accounts(id),
      transfer_transaction_id TEXT,
      memo TEXT,
      cleared TEXT NOT NULL DEFAULT 'uncleared' CHECK(cleared IN ('uncleared', 'cleared', 'reconciled')),
      approved INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_transaction_id);

    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL,
      assigned_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budget_cat_month ON monthly_budgets(category_id, month);

    CREATE TABLE IF NOT EXISTS scheduled_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
      next_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payee_name TEXT,
      category_id TEXT REFERENCES categories(id),
      transfer_account_id TEXT REFERENCES accounts(id),
      memo TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sched_next_date ON scheduled_transactions(next_date);
    CREATE INDEX IF NOT EXISTS idx_sched_active ON scheduled_transactions(is_active);
  `);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run(grp.inflow, 'Inflow', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run(cat.readyToAssign, grp.inflow, 'Ready to Assign', now);

  // Accounts
  const insertAccount = sqlite.prepare(`
    INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'KZT', ?, 1, ?, ?)
  `);
  insertAccount.run(acc.kaspiGold, 'Kaspi Gold', 'checking', 1, 0, now, now);
  insertAccount.run(acc.halyk, 'Halyk Текущий', 'checking', 1, 1, now, now);

  // Category group + category
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 0, 1, 0, ?)`)
    .run(grp.fixed, 'Постоянные', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)`)
    .run(cat.rent, grp.fixed, 'Аренда', now);

  // Scheduled transactions
  const insertSched = sqlite.prepare(`
    INSERT INTO scheduled_transactions (id, account_id, frequency, next_date, amount_cents, payee_name, category_id, transfer_account_id, memo, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. Rent -150,000₸ monthly, due 2026-03-05
  insertSched.run(sched.rent, acc.kaspiGold, 'monthly', '2026-03-05', -15000000, 'Арендодатель', cat.rent, null, 'Аренда', 1, now, now);
  // 2. Transfer Kaspi Gold → Halyk, monthly, due 2026-03-10
  insertSched.run(sched.transfer, acc.kaspiGold, 'monthly', '2026-03-10', -15000000, null, null, acc.halyk, 'Перевод', 1, now, now);
  // 3. Inactive schedule (should be skipped)
  insertSched.run(sched.inactive, acc.kaspiGold, 'monthly', '2026-03-01', -500000, 'Disabled', cat.rent, null, null, 0, now, now);
  // 4. Far future schedule (2026-06-01)
  insertSched.run(sched.farFuture, acc.kaspiGold, 'monthly', '2026-06-01', -1000000, 'Future', cat.rent, null, null, 1, now, now);

  return db;
}

// --- Tests ---

describe('advanceDate', () => {
  it('monthly: Jan 31 → Feb 28 (not Mar 3)', () => {
    expect(advanceDate('2026-01-31', 'monthly')).toBe('2026-02-28');
  });

  it('yearly: Feb 29 2028 → Feb 28 2029 (leap year)', () => {
    expect(advanceDate('2028-02-29', 'yearly')).toBe('2029-02-28');
  });

  it('weekly: adds 7 days', () => {
    expect(advanceDate('2026-03-01', 'weekly')).toBe('2026-03-08');
  });

  it('biweekly: adds 14 days', () => {
    expect(advanceDate('2026-03-01', 'biweekly')).toBe('2026-03-15');
  });
});

describe('processDue', () => {
  it('creates transaction on due date, advances nextDate', () => {
    const db = createAndSeedDb();

    const result = processDue(db, '2026-03-05');

    expect(result.created).toBe(1);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].scheduledId).toBe(sched.rent);
    expect(result.transactions[0].date).toBe('2026-03-05');
    expect(result.errors).toHaveLength(0);

    // Verify the created transaction
    const txRow = db.$client.prepare('SELECT * FROM transactions WHERE id = ?').get(result.transactions[0].id) as any;
    expect(txRow.amount_cents).toBe(-15000000);
    expect(txRow.payee_name).toBe('Арендодатель');
    expect(txRow.category_id).toBe(cat.rent);
    expect(txRow.memo).toBe('Аренда (auto)');
    expect(txRow.cleared).toBe('uncleared');

    // Verify nextDate advanced
    const schedRow = db.$client.prepare('SELECT next_date FROM scheduled_transactions WHERE id = ?').get(sched.rent) as any;
    expect(schedRow.next_date).toBe('2026-04-05');
  });

  it('creates paired transfer transactions', () => {
    const db = createAndSeedDb();

    const result = processDue(db, '2026-03-10');

    // Should process rent (due 3/5) and transfer (due 3/10)
    const transferTxs = result.transactions.filter(t => t.scheduledId === sched.transfer);
    expect(transferTxs).toHaveLength(2);

    // Verify paired transactions
    const tx1 = db.$client.prepare('SELECT * FROM transactions WHERE id = ?').get(transferTxs[0].id) as any;
    const tx2 = db.$client.prepare('SELECT * FROM transactions WHERE id = ?').get(transferTxs[1].id) as any;

    expect(tx1.amount_cents).toBe(-15000000);
    expect(tx2.amount_cents).toBe(15000000);
    expect(tx1.transfer_transaction_id).toBe(tx2.id);
    expect(tx2.transfer_transaction_id).toBe(tx1.id);
    expect(tx1.payee_name).toBe('Transfer: Halyk Текущий');
    expect(tx2.payee_name).toBe('Transfer: Kaspi Gold');
  });

  it('processing same date twice does not duplicate', () => {
    const db = createAndSeedDb();

    const first = processDue(db, '2026-03-05');
    expect(first.created).toBe(1);

    const second = processDue(db, '2026-03-05');
    expect(second.created).toBe(0);
    expect(second.transactions).toHaveLength(0);
  });

  it('skips inactive schedules', () => {
    const db = createAndSeedDb();

    // Process well past the inactive schedule's date
    const result = processDue(db, '2026-03-15');

    // Should NOT include the inactive one
    const inactiveTxs = result.transactions.filter(t => t.scheduledId === sched.inactive);
    expect(inactiveTxs).toHaveLength(0);
  });
});

describe('getUpcoming', () => {
  it('daysAhead=7 only returns schedules within window', () => {
    const db = createAndSeedDb();

    // As of 2026-03-03, with 7 days ahead → cutoff 2026-03-10
    const upcoming = getUpcoming(db, 7, '2026-03-03');

    const ids = upcoming.map(s => s.id);
    expect(ids).toContain(sched.rent);       // due 2026-03-05, within window
    expect(ids).toContain(sched.transfer);   // due 2026-03-10, within window
    expect(ids).not.toContain(sched.inactive);  // inactive, filtered out
    expect(ids).not.toContain(sched.farFuture); // 2026-06-01, outside window
  });

  it('returns formatted fields', () => {
    const db = createAndSeedDb();

    const upcoming = getUpcoming(db, 7, '2026-03-03');
    const rent = upcoming.find(s => s.id === sched.rent)!;

    expect(rent.accountName).toBe('Kaspi Gold');
    expect(rent.categoryName).toBe('Аренда');
    expect(rent.amountFormatted).toBe('-150 000 ₸');
    expect(rent.frequency).toBe('monthly');
  });
});
