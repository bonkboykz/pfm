import type Database from 'better-sqlite3';

/**
 * The single definition of the database's shape.
 *
 * The migration script and every test fixture apply this same function. It used
 * to be a string duplicated across ten files, so adding a column meant editing
 * all ten and discovering the misses one failing suite at a time.
 */
export function applySchema(sqlite: Database.Database): void {
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
      bank_name TEXT,
      last_4_digits TEXT,
      card_type TEXT CHECK(card_type IN ('visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other')),
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
      paid_off_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      closed_date TEXT,
      closure_reason TEXT,
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

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'assign', 'bulk')),
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      summary TEXT,
      before_json TEXT,
      after_json TEXT,
      is_reverted INTEGER NOT NULL DEFAULT 0,
      reverted_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_log(batch_id);

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
}

/**
 * Brings a database created before a column existed up to date.
 *
 * Every statement is expected to fail on a database that already has the
 * column, which is what makes re-running the migration safe.
 */
export function applyColumnMigrations(sqlite: Database.Database): void {
  const statements = [
    'ALTER TABLE accounts ADD COLUMN bank_name TEXT',
    'ALTER TABLE accounts ADD COLUMN last_4_digits TEXT',
    "ALTER TABLE accounts ADD COLUMN card_type TEXT CHECK(card_type IN ('visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other'))",
    'ALTER TABLE loans ADD COLUMN paid_off_cents INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE loans ADD COLUMN closed_date TEXT',
    'ALTER TABLE loans ADD COLUMN closure_reason TEXT',
  ];

  for (const sql of statements) {
    try {
      sqlite.exec(sql);
    } catch {
      // Column already exists — the expected outcome on an up-to-date database.
    }
  }
}

/** Tables whose every row change is journalled to audit_log. */
const AUDITED_TABLES: Record<string, string[]> = {
  transactions: [
    'id', 'account_id', 'date', 'amount_cents', 'payee_id', 'payee_name', 'category_id',
    'transfer_account_id', 'transfer_transaction_id', 'memo', 'cleared', 'approved',
    'is_deleted', 'created_at', 'updated_at',
  ],
  monthly_budgets: ['id', 'category_id', 'month', 'assigned_cents', 'note', 'created_at', 'updated_at'],
  loans: [
    'id', 'name', 'type', 'account_id', 'category_id', 'principal_cents', 'apr_bps',
    'term_months', 'start_date', 'monthly_payment_cents', 'payment_day', 'penalty_rate_bps',
    'early_repayment_fee_cents', 'paid_off_cents', 'note', 'is_active', 'closed_date',
    'closure_reason', 'created_at', 'updated_at',
  ],
};

/**
 * Installs the audit triggers.
 *
 * The journal is written by the database rather than by each route, so a new
 * endpoint cannot forget to record what it changed. Triggers can see the row
 * but not the request, so batch_id/method/path land as placeholders that the
 * API's audit middleware stamps once the request finishes.
 */
export function applyAuditTriggers(sqlite: Database.Database): void {
  const jsonObject = (alias: 'OLD' | 'NEW', cols: string[]) =>
    `json_object(${cols.map((c) => `'${c}', ${alias}.${c}`).join(', ')})`;

  const auditInsert = (table: string, action: string, entityId: string, before: string, after: string) => `
    INSERT INTO audit_log
      (id, batch_id, entity, entity_id, action, method, path, summary, before_json, after_json, is_reverted, created_at)
    VALUES
      (lower(hex(randomblob(16))), 'pending', '${table}', ${entityId}, '${action}', '', '', NULL,
       ${before}, ${after}, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
  `;

  for (const [table, cols] of Object.entries(AUDITED_TABLES)) {
    const oldJson = jsonObject('OLD', cols);
    const newJson = jsonObject('NEW', cols);

    sqlite.exec(`
      DROP TRIGGER IF EXISTS audit_${table}_insert;
      DROP TRIGGER IF EXISTS audit_${table}_update;
      DROP TRIGGER IF EXISTS audit_${table}_delete;

      CREATE TRIGGER audit_${table}_insert AFTER INSERT ON ${table}
      BEGIN ${auditInsert(table, 'create', 'NEW.id', 'NULL', newJson)} END;

      CREATE TRIGGER audit_${table}_update AFTER UPDATE ON ${table}
      BEGIN ${auditInsert(table, 'update', 'NEW.id', oldJson, newJson)} END;

      CREATE TRIGGER audit_${table}_delete AFTER DELETE ON ${table}
      BEGIN ${auditInsert(table, 'delete', 'OLD.id', oldJson, 'NULL')} END;
    `);
  }
}

/** The two rows the engine hardcodes by id and expects to always exist. */
export function seedSystemRows(sqlite: Database.Database): void {
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('inflow-group', 'Inflow', 1, -1, 0, now);

  sqlite.prepare(`
    INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ready-to-assign', 'inflow-group', 'Ready to Assign', 1, 0, 0, now);
}

/** Everything a usable database needs, in order. */
export function initializeDatabase(sqlite: Database.Database): void {
  applySchema(sqlite);
  applyColumnMigrations(sqlite);
  applyAuditTriggers(sqlite);
  seedSystemRows(sqlite);
}
