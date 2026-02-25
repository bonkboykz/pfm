import Decimal from 'decimal.js';
import type { DebtSnapshot, PayoffStrategy, MonthlySnapshot, DebtMonthState, PayoffSimulationResult } from './types.js';

const STRATEGY_DESCRIPTIONS: Record<PayoffStrategy, string> = {
  snowball: 'Smallest balance first. Fast psychological wins.',
  avalanche: 'Highest interest rate first. Lowest total cost.',
  highest_monthly_interest: 'Highest monthly interest charge first. Aggressive on expensive debt.',
  cash_flow_index: 'Lowest balance-to-payment ratio first. Frees cash flow fastest.',
};

interface MutableDebt {
  id: string;
  name: string;
  type: DebtSnapshot['type'];
  currentBalance: number;
  aprBps: number;
  minPaymentCents: number;
  remainingInstallments: number | undefined;
  latePenaltyCents: number;
  isPaidOff: boolean;
  originalMinPayment: number;
  monthsElapsed: number;
}

function advanceMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const nextMonth = m + 1;
  if (nextMonth > 12) {
    return `${y + 1}-01`;
  }
  return `${y}-${String(nextMonth).padStart(2, '0')}`;
}

function sortByStrategy(debts: MutableDebt[], strategy: PayoffStrategy): MutableDebt[] {
  const active = debts.filter((d) => !d.isPaidOff);
  switch (strategy) {
    case 'snowball':
      return active.sort((a, b) => a.currentBalance - b.currentBalance);
    case 'avalanche':
      return active.sort((a, b) => b.aprBps - a.aprBps);
    case 'highest_monthly_interest':
      return active.sort((a, b) => {
        const aInterest = new Decimal(b.currentBalance).times(b.aprBps).div(12).toNumber();
        const bInterest = new Decimal(a.currentBalance).times(a.aprBps).div(12).toNumber();
        return aInterest - bInterest;
      });
    case 'cash_flow_index':
      return active.sort((a, b) => {
        const aRatio = a.minPaymentCents > 0 ? a.currentBalance / a.minPaymentCents : Infinity;
        const bRatio = b.minPaymentCents > 0 ? b.currentBalance / b.minPaymentCents : Infinity;
        return aRatio - bRatio;
      });
  }
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function simulatePayoff(
  debts: DebtSnapshot[],
  strategy: PayoffStrategy,
  extraMonthlyCents: number,
  startDate?: string,
): PayoffSimulationResult {
  const date = startDate ?? getCurrentMonth();

  // Clone debts into mutable state
  const mutableDebts: MutableDebt[] = debts.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    currentBalance: d.balanceCents,
    aprBps: d.aprBps,
    minPaymentCents: d.minPaymentCents,
    remainingInstallments: d.remainingInstallments,
    latePenaltyCents: d.latePenaltyCents ?? 0,
    isPaidOff: d.balanceCents <= 0,
    originalMinPayment: d.minPaymentCents,
    monthsElapsed: 0,
  }));

  let monthCounter = 0;
  let currentDate = date;
  const schedule: MonthlySnapshot[] = [];
  const payoffOrder: string[] = [];
  let totalInterestCents = 0;
  let totalPenaltiesCents = 0;
  let totalPaidCents = 0;
  let freedMinPayments = 0;

  const MAX_MONTHS = 600;

  while (mutableDebts.some((d) => !d.isPaidOff) && monthCounter < MAX_MONTHS) {
    monthCounter++;
    currentDate = advanceMonth(currentDate);

    const debtStates: DebtMonthState[] = [];
    let monthTotalPaid = 0;

    // Track payments per debt this month
    const payments = new Map<string, number>();
    const interests = new Map<string, number>();

    // b. Accrue interest
    for (const debt of mutableDebts) {
      if (debt.isPaidOff) continue;
      debt.monthsElapsed++;

      let interestCents = 0;
      if (debt.type === 'credit_card' || debt.type === 'loan') {
        interestCents = new Decimal(debt.currentBalance)
          .times(debt.aprBps)
          .div(10000)
          .div(12)
          .round()
          .toNumber();
      }

      // Check for installment late penalty
      if (debt.type === 'installment' && debt.remainingInstallments !== undefined) {
        if (debt.monthsElapsed > debt.remainingInstallments && debt.currentBalance > 0) {
          interestCents = debt.latePenaltyCents;
          totalPenaltiesCents += debt.latePenaltyCents;
        }
      }

      interests.set(debt.id, interestCents);
      totalInterestCents += interestCents;
      payments.set(debt.id, 0);
    }

    // c. Compute minimum payments and pay them
    for (const debt of mutableDebts) {
      if (debt.isPaidOff) continue;

      const interest = interests.get(debt.id) ?? 0;
      let minPayment: number;

      if (debt.type === 'credit_card') {
        const percentPlusInterest = new Decimal(debt.currentBalance)
          .times(0.01)
          .floor()
          .plus(interest)
          .toNumber();
        minPayment = Math.max(250000, percentPlusInterest);
        // Cap at balance + interest
        minPayment = Math.min(minPayment, debt.currentBalance + interest);
      } else if (debt.type === 'loan') {
        minPayment = Math.min(debt.minPaymentCents, debt.currentBalance + interest);
      } else {
        // installment: include penalty (interest) in cap when applicable
        minPayment = Math.min(debt.minPaymentCents, debt.currentBalance + interest);
      }

      payments.set(debt.id, minPayment);
    }

    // e. Compute extra available
    let extra = extraMonthlyCents + freedMinPayments;

    // f. Sort active debts by strategy
    const sorted = sortByStrategy(mutableDebts, strategy);

    // g. Distribute extra to sorted debts
    for (const debt of sorted) {
      if (extra <= 0) break;
      const interest = interests.get(debt.id) ?? 0;
      const alreadyPaid = payments.get(debt.id) ?? 0;
      const maxPayable = debt.currentBalance + interest - alreadyPaid;
      if (maxPayable <= 0) continue;

      const payment = Math.min(extra, maxPayable);
      extra -= payment;
      payments.set(debt.id, alreadyPaid + payment);
    }

    // h. Update balances, detect payoffs
    for (const debt of mutableDebts) {
      if (debt.isPaidOff) continue;

      const interest = interests.get(debt.id) ?? 0;
      const payment = payments.get(debt.id) ?? 0;
      const startBalance = debt.currentBalance;

      const endBalance = new Decimal(startBalance).plus(interest).minus(payment).toNumber();
      debt.currentBalance = Math.max(0, endBalance);

      monthTotalPaid += payment;

      const isPaidOff = debt.currentBalance <= 0;
      if (isPaidOff && !debt.isPaidOff) {
        debt.isPaidOff = true;
        payoffOrder.push(debt.id);
        freedMinPayments += debt.originalMinPayment;
      }

      debtStates.push({
        debtId: debt.id,
        name: debt.name,
        startBalanceCents: startBalance,
        interestCents: interest,
        paymentCents: payment,
        endBalanceCents: debt.currentBalance,
        isPaidOff,
      });
    }

    totalPaidCents += monthTotalPaid;
    const totalRemaining = mutableDebts.reduce((sum, d) => sum + d.currentBalance, 0);

    schedule.push({
      month: monthCounter,
      date: currentDate,
      debtStates,
      totalPaidCents: monthTotalPaid,
      totalRemainingCents: totalRemaining,
    });
  }

  return {
    strategy,
    strategyDescription: STRATEGY_DESCRIPTIONS[strategy],
    monthsToPayoff: monthCounter,
    totalPaidCents,
    totalInterestCents,
    totalPenaltiesCents,
    debtFreeDate: currentDate,
    schedule,
    payoffOrder,
  };
}
