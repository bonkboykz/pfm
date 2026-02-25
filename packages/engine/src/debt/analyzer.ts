import Decimal from 'decimal.js';
import type { DebtSnapshot, PayoffStrategy, StrategyComparison, DebtVsInvestResult } from './types.js';
import { simulatePayoff } from './simulator.js';
import { formatMoney } from '../math/money.js';

const ALL_STRATEGIES: PayoffStrategy[] = ['snowball', 'avalanche', 'highest_monthly_interest', 'cash_flow_index'];

export function compareStrategies(
  debts: DebtSnapshot[],
  extraMonthlyCents: number,
  startDate?: string,
): StrategyComparison {
  const strategies = ALL_STRATEGIES.map((s) => simulatePayoff(debts, s, extraMonthlyCents, startDate));

  strategies.sort((a, b) => a.totalPaidCents - b.totalPaidCents);

  const best = strategies[0];
  const worst = strategies[strategies.length - 1];

  return {
    strategies,
    recommended: best.strategy,
    savingsVsWorstCents: worst.totalPaidCents - best.totalPaidCents,
  };
}

function compoundInvest(
  initialCents: number,
  monthlyContributionCents: number,
  returnBps: number,
  months: number,
): number {
  const monthlyRate = new Decimal(returnBps).div(10000).div(12);
  let balance = new Decimal(initialCents);
  for (let i = 0; i < months; i++) {
    balance = balance.times(new Decimal(1).plus(monthlyRate)).plus(monthlyContributionCents);
  }
  return balance.round().toNumber();
}

function scenarioDebtFirst(
  extraMonthlyCents: number,
  debt: DebtSnapshot,
  expectedReturnBps: number,
  horizonMonths: number,
): number {
  const result = simulatePayoff([debt], 'avalanche', extraMonthlyCents);
  const monthsToPayoff = Math.min(result.monthsToPayoff, horizonMonths);
  const remainingMonths = horizonMonths - monthsToPayoff;

  // After debt is paid, invest extra + freed min payment
  const monthlyInvestment = extraMonthlyCents + debt.minPaymentCents;
  const investmentBalance = compoundInvest(0, monthlyInvestment, expectedReturnBps, remainingMonths);

  return investmentBalance;
}

function scenarioInvestFirst(
  extraMonthlyCents: number,
  debt: DebtSnapshot,
  expectedReturnBps: number,
  horizonMonths: number,
): number {
  // Pay only minimums on debt, invest extra for entire horizon
  const minOnlyResult = simulatePayoff([debt], 'avalanche', 0);

  const investmentBalance = compoundInvest(0, extraMonthlyCents, expectedReturnBps, horizonMonths);

  // Remaining debt after horizon
  let remainingDebt = 0;
  if (minOnlyResult.monthsToPayoff > horizonMonths && minOnlyResult.schedule.length >= horizonMonths) {
    remainingDebt = minOnlyResult.schedule[horizonMonths - 1].totalRemainingCents;
  } else if (minOnlyResult.monthsToPayoff > horizonMonths) {
    const lastSnapshot = minOnlyResult.schedule[minOnlyResult.schedule.length - 1];
    remainingDebt = lastSnapshot ? lastSnapshot.totalRemainingCents : 0;
  }

  return investmentBalance - remainingDebt;
}

export function debtVsInvest(
  extraMonthlyCents: number,
  debt: DebtSnapshot,
  expectedReturnBps: number,
  horizonMonths: number,
): DebtVsInvestResult {
  const debtFirstNW = scenarioDebtFirst(extraMonthlyCents, debt, expectedReturnBps, horizonMonths);
  const investFirstNW = scenarioInvestFirst(extraMonthlyCents, debt, expectedReturnBps, horizonMonths);

  // Binary search for break-even return rate
  let lo = 0;
  let hi = 100000; // up to 1000%
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const debtNW = scenarioDebtFirst(extraMonthlyCents, debt, mid, horizonMonths);
    const investNW = scenarioInvestFirst(extraMonthlyCents, debt, mid, horizonMonths);
    if (investNW >= debtNW) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  const breakEvenReturnBps = hi;

  // Recommendation
  let recommendation: 'pay_debt' | 'invest' | 'split';
  const ratio = debtFirstNW > 0 && investFirstNW > 0
    ? Math.abs(debtFirstNW - investFirstNW) / Math.max(debtFirstNW, investFirstNW)
    : debtFirstNW !== investFirstNW ? 1 : 0;

  if (debtFirstNW > investFirstNW && ratio > 0.05) {
    recommendation = 'pay_debt';
  } else if (investFirstNW > debtFirstNW && ratio > 0.05) {
    recommendation = 'invest';
  } else {
    recommendation = 'split';
  }

  const aprPercent = new Decimal(debt.aprBps).div(100).toFixed(1);
  const returnPercent = new Decimal(expectedReturnBps).div(100).toFixed(1);
  const diff = Math.abs(debtFirstNW - investFirstNW);
  const diffFormatted = formatMoney(diff);

  let explanation: string;
  if (recommendation === 'pay_debt') {
    explanation = `Paying off the ${aprPercent}% loan first yields ${diffFormatted} more than investing at ${returnPercent}%.`;
  } else if (recommendation === 'invest') {
    explanation = `Investing at ${returnPercent}% yields ${diffFormatted} more than paying off the ${aprPercent}% loan first.`;
  } else {
    explanation = `Paying debt (${aprPercent}%) and investing (${returnPercent}%) yield similar results. Consider splitting.`;
  }

  return {
    debtFirstNetWorthCents: debtFirstNW,
    investFirstNetWorthCents: investFirstNW,
    recommendation,
    breakEvenReturnBps,
    explanation,
  };
}
