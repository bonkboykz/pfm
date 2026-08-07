import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import {
  getDepositCurrentBalance,
  getDepositSummary,
  generateInterestSchedule,
  computeEffectiveAnnualRate,
  getKdifExposure,
  compareDeposits,
} from '../src/deposit/engine.js';

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

  // Account for deposit with transactions
  sqlite.prepare(`INSERT INTO accounts (id, name, type, on_budget, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'savings', 1, 0, 1, ?, ?)`)
    .run('acc-kaspi-dep', 'Kaspi Депозит', now, now);

  // Halyk term deposit: 1M₸, 14.5%, 12 months, monthly cap, non-withdrawable
  sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, initial_amount_cents, annual_rate_bps, term_months, start_date, end_date, capitalization, is_withdrawable, is_replenishable, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?)`)
    .run('dep-halyk-term', 'Halyk Срочный 14.5%', 'Halyk Bank', 'term', 100000000, 1450, 12, '2025-06-01', '2026-06-01', 'monthly', now, now);

  // Kaspi savings: 500K₸, 10%, term=0 (perpetual), monthly cap, withdrawable+replenishable, linked to account
  sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, account_id, initial_amount_cents, annual_rate_bps, term_months, start_date, capitalization, is_withdrawable, is_replenishable, top_up_cents, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1, ?, ?)`)
    .run('dep-kaspi-savings', 'Kaspi Накопительный 10%', 'Kaspi Bank', 'savings', 'acc-kaspi-dep', 50000000, 1000, 0, '2025-01-01', 'monthly', 10000000, now, now);

  // Forte demand deposit: 200K₸, 5%, term=0, none (simple interest)
  sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, initial_amount_cents, annual_rate_bps, term_months, start_date, capitalization, is_withdrawable, is_replenishable, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)`)
    .run('dep-forte-demand', 'Forte До востребования 5%', 'Forte Bank', 'demand', 20000000, 500, 0, '2025-03-01', 'none', now, now);

  // Halyk term deposit for quarterly capitalization test
  sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, initial_amount_cents, annual_rate_bps, term_months, start_date, capitalization, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run('dep-halyk-quarterly', 'Halyk Квартальный', 'Halyk Bank', 'term', 100000000, 1200, 12, '2025-01-01', 'quarterly', now, now);

  // Halyk term deposit for at_end capitalization test
  sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, initial_amount_cents, annual_rate_bps, term_months, start_date, capitalization, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run('dep-halyk-atend', 'Halyk Вконце', 'Halyk Bank', 'term', 100000000, 1200, 12, '2025-01-01', 'at_end', now, now);

  // Transactions in the account linked to Kaspi savings
  sqlite.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, payee_name, cleared, approved, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
    .run('tx-dep-1', 'acc-kaspi-dep', '2025-01-15', 50000000, 'Initial deposit', now, now);
  sqlite.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, payee_name, cleared, approved, is_deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
    .run('tx-dep-2', 'acc-kaspi-dep', '2025-02-15', 10000000, 'Top up', now, now);

  return db;
}

describe('Deposit Engine', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  describe('getDepositCurrentBalance', () => {
    it('returns initialAmount + topUp when no account linked', () => {
      const balance = getDepositCurrentBalance(db, 'dep-halyk-term');
      // 1M₸ + 0 topUp = 100000000
      expect(balance).toBe(100000000);
    });

    it('returns balance from transactions when account is linked', () => {
      const balance = getDepositCurrentBalance(db, 'dep-kaspi-savings');
      // 500K + 100K from transactions
      expect(balance).toBe(60000000);
    });

    it('returns 0 for unknown deposit', () => {
      expect(getDepositCurrentBalance(db, 'nonexistent')).toBe(0);
    });
  });

  describe('generateInterestSchedule', () => {
    it('generates monthly cap schedule with 12 entries', () => {
      const schedule = generateInterestSchedule(db, 'dep-halyk-term');
      expect(schedule).toHaveLength(12);
      // With compound interest, end balance should exceed initial
      expect(schedule[schedule.length - 1].endBalanceCents).toBeGreaterThan(100000000);
      // Each month should have interest
      expect(schedule.every((e) => e.interestCents > 0)).toBe(true);
      // Monthly cap: capitalizedCents = interestCents each month
      expect(schedule.every((e) => e.capitalizedCents === e.interestCents)).toBe(true);
    });

    it('generates quarterly cap schedule — capitalization every 3 months', () => {
      const schedule = generateInterestSchedule(db, 'dep-halyk-quarterly');
      expect(schedule).toHaveLength(12);
      // Months 1,2 should have capitalizedCents = 0, month 3 > 0
      expect(schedule[0].capitalizedCents).toBe(0);
      expect(schedule[1].capitalizedCents).toBe(0);
      expect(schedule[2].capitalizedCents).toBeGreaterThan(0);
      // Month 4,5 = 0, month 6 > 0
      expect(schedule[3].capitalizedCents).toBe(0);
      expect(schedule[4].capitalizedCents).toBe(0);
      expect(schedule[5].capitalizedCents).toBeGreaterThan(0);
    });

    it('generates at_end schedule — balance flat until last month', () => {
      const schedule = generateInterestSchedule(db, 'dep-halyk-atend');
      expect(schedule).toHaveLength(12);
      // All months except last should have capitalizedCents = 0
      for (let i = 0; i < 11; i++) {
        expect(schedule[i].capitalizedCents).toBe(0);
        expect(schedule[i].endBalanceCents).toBe(100000000);
      }
      // Last month should capitalize all accrued interest
      expect(schedule[11].capitalizedCents).toBeGreaterThan(0);
      expect(schedule[11].endBalanceCents).toBeGreaterThan(100000000);
    });

    it('generates none (simple interest) — balance never changes', () => {
      const schedule = generateInterestSchedule(db, 'dep-forte-demand');
      expect(schedule).toHaveLength(12); // perpetual default 12
      // Balance stays the same throughout
      expect(schedule.every((e) => e.endBalanceCents === 20000000)).toBe(true);
      // No capitalization
      expect(schedule.every((e) => e.capitalizedCents === 0)).toBe(true);
      // Interest still accrues
      expect(schedule.every((e) => e.interestCents > 0)).toBe(true);
    });

    it('uses default 12 months for perpetual deposit', () => {
      const schedule = generateInterestSchedule(db, 'dep-kaspi-savings');
      expect(schedule).toHaveLength(12);
    });

    it('returns empty for unknown deposit', () => {
      expect(generateInterestSchedule(db, 'nonexistent')).toEqual([]);
    });
  });

  describe('computeEffectiveAnnualRate', () => {
    it('monthly > nominal rate', () => {
      const ear = computeEffectiveAnnualRate(1450, 'monthly');
      expect(ear).toBeGreaterThan(1450);
    });

    it('none = nominal rate', () => {
      const ear = computeEffectiveAnnualRate(1450, 'none');
      expect(ear).toBe(1450);
    });

    it('quarterly < monthly for same nominal rate', () => {
      const monthly = computeEffectiveAnnualRate(1200, 'monthly');
      const quarterly = computeEffectiveAnnualRate(1200, 'quarterly');
      expect(monthly).toBeGreaterThan(quarterly);
    });
  });

  describe('getKdifExposure', () => {
    it('groups deposits by bank and computes totals', () => {
      const exposures = getKdifExposure(db);
      expect(exposures.length).toBeGreaterThanOrEqual(3);

      const halyk = exposures.find((e) => e.bankName === 'Halyk Bank');
      expect(halyk).toBeDefined();
      // Halyk has 3 deposits: dep-halyk-term (1M), dep-halyk-quarterly (1M), dep-halyk-atend (1M)
      expect(halyk!.depositCount).toBe(3);
      expect(halyk!.totalDepositsCents).toBe(300000000);
      // 3M₸ < 15M₸ limit, so not over-insured
      expect(halyk!.isOverInsured).toBe(false);
      expect(halyk!.excessCents).toBe(0);
    });

    it('detects over-insured banks', () => {
      // Add a massive deposit to Kaspi
      const sqlite = db.$client;
      const now = new Date().toISOString();
      sqlite.prepare(`INSERT INTO deposits (id, name, bank_name, type, initial_amount_cents, annual_rate_bps, term_months, start_date, capitalization, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run('dep-kaspi-big', 'Kaspi Mega', 'Kaspi Bank', 'term', 2000000000, 1000, 12, '2025-01-01', 'monthly', now, now);

      const exposures = getKdifExposure(db);
      const kaspi = exposures.find((e) => e.bankName === 'Kaspi Bank');
      expect(kaspi).toBeDefined();
      expect(kaspi!.isOverInsured).toBe(true);
      expect(kaspi!.excessCents).toBeGreaterThan(0);

      // Cleanup
      sqlite.prepare('DELETE FROM deposits WHERE id = ?').run('dep-kaspi-big');
    });
  });

  describe('compareDeposits', () => {
    it('recommends deposit with more interest', () => {
      const result = compareDeposits([
        { name: 'Halyk 14.5%', initialAmountCents: 100000000, annualRateBps: 1450, termMonths: 12, capitalization: 'monthly' },
        { name: 'Kaspi 12%', initialAmountCents: 100000000, annualRateBps: 1200, termMonths: 12, capitalization: 'quarterly' },
      ]);

      expect(result.deposits).toHaveLength(2);
      expect(result.recommended).toBe('Halyk 14.5%');
      expect(result.deposits[0].totalInterestCents).toBeGreaterThan(result.deposits[1].totalInterestCents);
      expect(result.explanation).toContain('Halyk 14.5%');
    });
  });
});
