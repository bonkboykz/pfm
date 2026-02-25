import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { getLoanCurrentDebt, getLoanSummary, loanToDebtSnapshot, generateAmortizationSchedule } from '../src/loan/engine.js';

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      on_budget INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'KZT',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      bank_name TEXT,
      last_4_digits TEXT,
      card_type TEXT,
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
      target_type TEXT DEFAULT 'none',
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
      cleared TEXT NOT NULL DEFAULT 'uncleared',
      approved INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL,
      assigned_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
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
  `);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  // Account & category for loan
  sqlite.prepare(`INSERT INTO accounts (id, name, type, on_budget, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'checking', 1, 0, 1, ?, ?)`)
    .run('acc-halyk', 'Halyk Текущий', now, now);

  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 0, 3, 0, ?)`)
    .run('grp-debt', 'Долги', now);

  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 1, 0, ?)`)
    .run('cat-halyk-credit', 'grp-debt', 'Халық кредит', now);

  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)`)
    .run('cat-kaspi-red', 'grp-debt', 'Kaspi Red iPhone', now);

  // Loan with payments (Халық кредит — regular loan)
  sqlite.prepare(`INSERT INTO loans (id, name, type, account_id, category_id, principal_cents, apr_bps, term_months, start_date, monthly_payment_cents, payment_day, penalty_rate_bps, early_repayment_fee_cents, note, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run('loan-halyk', 'Халық кредит', 'loan', 'acc-halyk', 'cat-halyk-credit', 200000000, 1850, 24, '2025-06-01', 8500000, 25, 0, 0, null, now, now);

  // Two payments made
  sqlite.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, category_id, payee_name, cleared, approved, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
    .run('tx-loan-1', 'acc-halyk', '2026-01-25', -8500000, 'cat-halyk-credit', 'Halyk Bank', now, now);
  sqlite.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, category_id, payee_name, cleared, approved, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
    .run('tx-loan-2', 'acc-halyk', '2026-02-25', -8500000, 'cat-halyk-credit', 'Halyk Bank', now, now);

  // Kaspi Red installment (0% APR)
  sqlite.prepare(`INSERT INTO loans (id, name, type, account_id, category_id, principal_cents, apr_bps, term_months, start_date, monthly_payment_cents, payment_day, penalty_rate_bps, early_repayment_fee_cents, note, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run('loan-kaspi-red', 'Kaspi Red iPhone', 'installment', null, 'cat-kaspi-red', 45000000, 0, 6, '2026-01-01', 7500000, 20, 0, 0, null, now, now);

  return db;
}

describe('Loan Engine', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  describe('getLoanCurrentDebt', () => {
    it('computes current debt = principal - payments', () => {
      const debt = getLoanCurrentDebt(db, 'loan-halyk');
      // 2,000,000 - 85,000 - 85,000 = 1,830,000 tiyns
      expect(debt).toBe(200000000 - 8500000 - 8500000);
    });

    it('returns 0 for unknown loan', () => {
      expect(getLoanCurrentDebt(db, 'nonexistent')).toBe(0);
    });

    it('returns principal for loan without payments', () => {
      const debt = getLoanCurrentDebt(db, 'loan-kaspi-red');
      expect(debt).toBe(45000000);
    });
  });

  describe('getLoanSummary', () => {
    it('returns summary with computed currentDebtCents', () => {
      const summary = getLoanSummary(db, 'loan-halyk');
      expect(summary).not.toBeNull();
      expect(summary!.name).toBe('Халық кредит');
      expect(summary!.currentDebtCents).toBe(183000000);
      expect(summary!.principalCents).toBe(200000000);
    });

    it('returns null for unknown loan', () => {
      expect(getLoanSummary(db, 'nonexistent')).toBeNull();
    });
  });

  describe('loanToDebtSnapshot', () => {
    it('converts loan to DebtSnapshot', () => {
      const snapshot = loanToDebtSnapshot(db, 'loan-halyk');
      expect(snapshot).not.toBeNull();
      expect(snapshot!.type).toBe('loan');
      expect(snapshot!.balanceCents).toBe(183000000);
      expect(snapshot!.aprBps).toBe(1850);
      expect(snapshot!.minPaymentCents).toBe(8500000);
    });

    it('converts installment correctly', () => {
      const snapshot = loanToDebtSnapshot(db, 'loan-kaspi-red');
      expect(snapshot).not.toBeNull();
      expect(snapshot!.type).toBe('installment');
      expect(snapshot!.remainingInstallments).toBe(6);
    });
  });

  describe('generateAmortizationSchedule', () => {
    it('generates schedule for installment (0% APR)', () => {
      const schedule = generateAmortizationSchedule(db, 'loan-kaspi-red');
      expect(schedule).toHaveLength(6);
      // All interest should be 0
      expect(schedule.every((e) => e.interestCents === 0)).toBe(true);
      // Each payment = 75,000 tiyns
      expect(schedule[0].paymentCents).toBe(7500000);
      // Last entry should end at 0
      expect(schedule[schedule.length - 1].endBalanceCents).toBe(0);
    });

    it('generates schedule for regular loan with interest', () => {
      const schedule = generateAmortizationSchedule(db, 'loan-halyk');
      expect(schedule.length).toBe(24);
      // First month should have interest
      expect(schedule[0].interestCents).toBeGreaterThan(0);
      // Payments should equal monthly payment
      expect(schedule[0].paymentCents).toBe(8500000);
    });

    it('returns empty for unknown loan', () => {
      expect(generateAmortizationSchedule(db, 'nonexistent')).toEqual([]);
    });
  });
});
