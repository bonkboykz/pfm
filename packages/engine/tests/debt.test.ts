import { describe, it, expect } from 'vitest';
import { simulatePayoff } from '../src/debt/simulator.js';
import { compareStrategies, debtVsInvest } from '../src/debt/analyzer.js';
import type { DebtSnapshot } from '../src/debt/types.js';

describe('Debt Payoff Simulator', () => {
  // Test 1: Single 0% installment (Kaspi Red)
  it('pays off a single 0% installment in exactly 3 months', () => {
    const debt: DebtSnapshot = {
      id: 'kaspi-red',
      name: 'Kaspi Red — iPhone',
      type: 'installment',
      balanceCents: 45000000,
      aprBps: 0,
      minPaymentCents: 15000000,
      remainingInstallments: 3,
      latePenaltyCents: 200000,
    };

    const result = simulatePayoff([debt], 'snowball', 0, '2026-01');

    expect(result.monthsToPayoff).toBe(3);
    expect(result.totalPaidCents).toBe(45000000);
    expect(result.totalInterestCents).toBe(0);
    expect(result.totalPenaltiesCents).toBe(0);
    expect(result.debtFreeDate).toBe('2026-04');
    expect(result.payoffOrder).toEqual(['kaspi-red']);
    expect(result.schedule).toHaveLength(3);
  });

  // Test 2: Single credit card
  it('pays off a credit card with extra payments in ~9 months', () => {
    const debt: DebtSnapshot = {
      id: 'cc-1',
      name: 'Credit Card',
      type: 'credit_card',
      balanceCents: 50000000,
      aprBps: 2400,
      minPaymentCents: 250000,
    };

    const result = simulatePayoff([debt], 'avalanche', 5000000, '2026-01');

    expect(result.monthsToPayoff).toBeGreaterThanOrEqual(7);
    expect(result.monthsToPayoff).toBeLessThanOrEqual(11);
    expect(result.totalInterestCents).toBeLessThan(6000000);
    expect(result.totalInterestCents).toBeGreaterThan(0);
    expect(result.payoffOrder).toEqual(['cc-1']);
  });

  // Test 3: Snowball vs Avalanche ordering and cost
  it('avalanche has lower total interest than snowball for mixed debts', () => {
    const debts: DebtSnapshot[] = [
      {
        id: 'debt-a',
        name: 'Small high-rate',
        type: 'loan',
        balanceCents: 10000000,
        aprBps: 2400,
        minPaymentCents: 1000000,
      },
      {
        id: 'debt-b',
        name: 'Large medium-rate',
        type: 'loan',
        balanceCents: 50000000,
        aprBps: 1200,
        minPaymentCents: 2500000,
      },
      {
        id: 'debt-c',
        name: 'Installment 0%',
        type: 'installment',
        balanceCents: 5000000,
        aprBps: 0,
        minPaymentCents: 2500000,
        remainingInstallments: 2,
      },
    ];

    const snowball = simulatePayoff(debts, 'snowball', 2000000, '2026-01');
    const avalanche = simulatePayoff(debts, 'avalanche', 2000000, '2026-01');

    // debt-c (installment, 2 months) pays off from minimums quickly in both strategies
    // Snowball directs extra to smallest balance (C, then A, then B)
    // Avalanche directs extra to highest rate (A, then B, then C)
    // Both have debt-c as first payoff since its minimums clear it in 2 months
    expect(snowball.payoffOrder).toContain('debt-c');
    expect(avalanche.payoffOrder).toContain('debt-a');

    // Avalanche should have lower or equal total interest (targets high-rate debt first)
    expect(avalanche.totalInterestCents).toBeLessThanOrEqual(snowball.totalInterestCents);
  });

  // Test 4: Late penalty on overdue installment
  it('applies late penalty after installment period expires', () => {
    const debt: DebtSnapshot = {
      id: 'kaspi-late',
      name: 'Kaspi Red late',
      type: 'installment',
      balanceCents: 15000000,
      aprBps: 0,
      minPaymentCents: 5000000,
      remainingInstallments: 2,
      latePenaltyCents: 200000,
    };

    // With min of 5M/month:
    // Month 1: pay 5M, balance = 10M
    // Month 2: pay 5M, balance = 5M
    // Month 3: penalty 200000 kicks in (monthsElapsed 3 > remainingInstallments 2)
    //   balance = 5M, interest = 200000, pay min(5M, 5M+200000) = 5M
    //   end = 5M + 200000 - 5M = 200000
    // Month 4: penalty 200000, balance = 200000, interest = 200000
    //   pay min(5M, 400000) = 400000, end = 0
    const result = simulatePayoff([debt], 'snowball', 0, '2026-01');

    expect(result.monthsToPayoff).toBe(4);
    expect(result.totalPenaltiesCents).toBeGreaterThan(0);
    expect(result.totalPenaltiesCents).toBe(400000); // 2 months of penalty
  });

  // Test 5: Debt vs Invest
  describe('debtVsInvest', () => {
    const debt: DebtSnapshot = {
      id: 'halyk-loan',
      name: 'Халық банк кредит',
      type: 'loan',
      balanceCents: 100000000,
      aprBps: 1850,
      minPaymentCents: 8500000,
    };

    it('recommends pay_debt when debt rate > investment return', () => {
      const result = debtVsInvest(5000000, debt, 1200, 24);
      expect(result.recommendation).toBe('pay_debt');
      expect(result.debtFirstNetWorthCents).toBeGreaterThan(result.investFirstNetWorthCents);
    });

    it('recommends invest when return is very high and debt APR is low', () => {
      const lowRateDebt: DebtSnapshot = {
        id: 'low-rate',
        name: 'Low rate loan',
        type: 'loan',
        balanceCents: 50000000,
        aprBps: 500,
        minPaymentCents: 1000000,
      };
      // 100% return vs 5% debt, long horizon — investing clearly wins
      const result = debtVsInvest(10000000, lowRateDebt, 10000, 120);
      expect(result.recommendation).toBe('invest');
      expect(result.investFirstNetWorthCents).toBeGreaterThan(result.debtFirstNetWorthCents);
    });
  });

  // Test 6: All zero-balance debts
  it('returns 0 months for all zero-balance debts', () => {
    const debts: DebtSnapshot[] = [
      {
        id: 'zero-1',
        name: 'Paid off loan',
        type: 'loan',
        balanceCents: 0,
        aprBps: 1200,
        minPaymentCents: 500000,
      },
    ];

    // balanceCents must be positive per Zod schema, but engine can handle 0
    // Simulate with balance already at 0
    const result = simulatePayoff(
      [{ ...debts[0], balanceCents: 0 }],
      'snowball',
      0,
      '2026-01',
    );

    expect(result.monthsToPayoff).toBe(0);
    expect(result.schedule).toHaveLength(0);
    expect(result.totalPaidCents).toBe(0);
    expect(result.totalInterestCents).toBe(0);
  });
});

describe('compareStrategies', () => {
  it('returns all 4 strategies sorted by total cost', () => {
    const debts: DebtSnapshot[] = [
      {
        id: 'debt-a',
        name: 'High rate',
        type: 'loan',
        balanceCents: 10000000,
        aprBps: 2400,
        minPaymentCents: 1000000,
      },
      {
        id: 'debt-b',
        name: 'Low rate big',
        type: 'loan',
        balanceCents: 50000000,
        aprBps: 1200,
        minPaymentCents: 2500000,
      },
    ];

    const result = compareStrategies(debts, 2000000, '2026-01');

    expect(result.strategies).toHaveLength(4);
    expect(result.recommended).toBeDefined();
    expect(result.savingsVsWorstCents).toBeGreaterThanOrEqual(0);

    // Verify sorted by totalPaidCents ascending
    for (let i = 1; i < result.strategies.length; i++) {
      expect(result.strategies[i].totalPaidCents).toBeGreaterThanOrEqual(
        result.strategies[i - 1].totalPaidCents,
      );
    }
  });
});
