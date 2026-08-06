import { createDb, type DB } from '@pfm/engine';

/**
 * An in-memory database with the full schema and the two system rows the
 * engine hardcodes ("inflow-group" / "ready-to-assign"), but no user data.
 *
 * `createDb` only opens a connection — it does not create tables, and
 * `packages/engine/src/db/migrate.ts` is a side-effecting script that writes
 * to ./data, so it cannot be reused from a test. The older API test files each
 * carry their own copy of this DDL; new tests should import this instead.
 */
export function createTestDb(): DB {
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
  sqlite
    .prepare(
      `INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`,
    )
    .run('inflow-group', 'Inflow', now);
  sqlite
    .prepare(
      `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`,
    )
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  return db;
}
