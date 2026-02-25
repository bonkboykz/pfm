import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.PFM_DB_PATH ?? './data/pfm.db';

mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('loan', 'installment', 'credit_line')),
    account_id TEXT REFERENCES accounts(id),
    category_id TEXT REFERENCES categories(id),
    principal_cents INTEGER NOT NULL,
    apr_bps INTEGER NOT NULL DEFAULT 0,
    term_months INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    monthly_payment_cents INTEGER NOT NULL,
    payment_day INTEGER NOT NULL,
    penalty_rate_bps INTEGER NOT NULL DEFAULT 0,
    early_repayment_fee_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(is_active);
  CREATE INDEX IF NOT EXISTS idx_loans_category ON loans(category_id);

  CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('term', 'savings', 'demand')),
    account_id TEXT REFERENCES accounts(id),
    category_id TEXT REFERENCES categories(id),
    initial_amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KZT',
    annual_rate_bps INTEGER NOT NULL,
    early_withdrawal_rate_bps INTEGER NOT NULL DEFAULT 0,
    term_months INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    capitalization TEXT NOT NULL DEFAULT 'monthly' CHECK(capitalization IN ('monthly', 'quarterly', 'at_end', 'none')),
    is_withdrawable INTEGER NOT NULL DEFAULT 0,
    is_replenishable INTEGER NOT NULL DEFAULT 0,
    min_balance_cents INTEGER NOT NULL DEFAULT 0,
    top_up_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deposits_active ON deposits(is_active);
  CREATE INDEX IF NOT EXISTS idx_deposits_bank ON deposits(bank_name);

  CREATE TABLE IF NOT EXISTS personal_debts (
    id TEXT PRIMARY KEY,
    person_name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('owe', 'owed')),
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KZT',
    due_date TEXT,
    note TEXT,
    is_settled INTEGER NOT NULL DEFAULT 0,
    settled_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Idempotent ALTER TABLE migrations
const alterStatements = [
  'ALTER TABLE accounts ADD COLUMN bank_name TEXT',
  'ALTER TABLE accounts ADD COLUMN last_4_digits TEXT',
  "ALTER TABLE accounts ADD COLUMN card_type TEXT CHECK(card_type IN ('visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other'))",
  'ALTER TABLE loans ADD COLUMN paid_off_cents INTEGER NOT NULL DEFAULT 0',
];
for (const sql of alterStatements) {
  try {
    sqlite.exec(sql);
  } catch (_) {
    // Column already exists — ignore
  }
}

// Insert system records if they don't exist
const insertGroup = sqlite.prepare(`
  INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
insertGroup.run('inflow-group', 'Inflow', 1, -1, 0, new Date().toISOString());

const insertCategory = sqlite.prepare(`
  INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
insertCategory.run('ready-to-assign', 'inflow-group', 'Ready to Assign', 1, 0, 0, new Date().toISOString());

sqlite.close();

console.log('Migration complete. Database created at', DB_PATH);
console.log('System records:');
console.log('  - Category group "Inflow" (id: inflow-group)');
console.log('  - Category "Ready to Assign" (id: ready-to-assign)');
console.log('Tables: accounts, category_groups, categories, payees, transactions, monthly_budgets, scheduled_transactions, loans, deposits, personal_debts');
