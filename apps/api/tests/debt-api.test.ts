import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, initializeDatabase, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

async function api(app: Hono, method: string, path: string, body?: any) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}

function createMinimalDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;
  const now = new Date().toISOString();

  initializeDatabase(sqlite);

  sqlite.prepare(`INSERT OR IGNORE INTO category_groups VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  return db;
}

describe('Debt Simulation API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createMinimalDb();
    app = createApp(db);
  });

  describe('POST /api/v1/simulate/payoff', () => {
    it('returns payoff simulation with formatted fields', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/payoff', {
        debts: [
          {
            id: 'kaspi-red',
            name: 'Kaspi Red — iPhone',
            type: 'installment',
            balanceCents: 45000000,
            aprBps: 0,
            minPaymentCents: 15000000,
            remainingInstallments: 3,
            latePenaltyCents: 200000,
          },
        ],
        strategy: 'snowball',
        extraMonthlyCents: 0,
        startDate: '2026-01',
      });

      expect(status).toBe(200);
      expect(data.strategy).toBe('snowball');
      expect(data.monthsToPayoff).toBe(3);
      expect(data.totalPaidCents).toBe(45000000);
      expect(data.totalPaidFormatted).toBeDefined();
      expect(data.totalInterestFormatted).toBeDefined();
      expect(data.schedule).toHaveLength(3);
      expect(data.schedule[0].debtStates[0].paymentFormatted).toBeDefined();
    });

    it('auto-generates debt id when not provided', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/payoff', {
        debts: [
          {
            name: 'No ID Debt',
            type: 'loan',
            balanceCents: 10000000,
            aprBps: 1200,
            minPaymentCents: 1000000,
          },
        ],
        strategy: 'avalanche',
      });

      expect(status).toBe(200);
      expect(data.payoffOrder.length).toBeGreaterThan(0);
      expect(data.payoffOrder[0]).toBeDefined();
    });

    it('returns 400 for invalid request', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/payoff', {
        debts: [],
        strategy: 'invalid',
      });

      expect(status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/simulate/compare', () => {
    it('returns all 4 strategies with recommendation', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/compare', {
        debts: [
          {
            id: 'loan-1',
            name: 'Loan A',
            type: 'loan',
            balanceCents: 10000000,
            aprBps: 2400,
            minPaymentCents: 1000000,
          },
          {
            id: 'loan-2',
            name: 'Loan B',
            type: 'loan',
            balanceCents: 50000000,
            aprBps: 1200,
            minPaymentCents: 2500000,
          },
        ],
        extraMonthlyCents: 2000000,
        startDate: '2026-01',
      });

      expect(status).toBe(200);
      expect(data.strategies).toHaveLength(4);
      expect(data.recommended).toBeDefined();
      expect(data.savingsVsWorstCents).toBeGreaterThanOrEqual(0);
      expect(data.savingsVsWorstFormatted).toBeDefined();
    });
  });

  describe('POST /api/v1/simulate/debt-vs-invest', () => {
    it('returns debt-vs-invest comparison with formatted fields', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/debt-vs-invest', {
        extraMonthlyCents: 5000000,
        debt: {
          id: 'halyk',
          name: 'Халық кредит',
          type: 'loan',
          balanceCents: 100000000,
          aprBps: 1850,
          minPaymentCents: 8500000,
        },
        expectedReturnBps: 1200,
        horizonMonths: 24,
      });

      expect(status).toBe(200);
      expect(data.debtFirstNetWorthCents).toBeDefined();
      expect(data.debtFirstFormatted).toBeDefined();
      expect(data.investFirstNetWorthCents).toBeDefined();
      expect(data.investFirstFormatted).toBeDefined();
      expect(data.recommendation).toBe('pay_debt');
      expect(data.breakEvenReturnBps).toBeGreaterThan(0);
      expect(data.explanation).toBeDefined();
    });

    it('returns 400 for missing fields', async () => {
      const { status, data } = await api(app, 'POST', '/api/v1/simulate/debt-vs-invest', {
        extraMonthlyCents: 5000000,
      });

      expect(status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
