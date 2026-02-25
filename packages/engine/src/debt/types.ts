export interface DebtSnapshot {
  id: string;
  name: string;
  type: 'credit_card' | 'loan' | 'installment';
  balanceCents: number;
  aprBps: number;
  minPaymentCents: number;
  remainingInstallments?: number;
  latePenaltyCents?: number;
}

export type PayoffStrategy = 'snowball' | 'avalanche' | 'highest_monthly_interest' | 'cash_flow_index';

export interface MonthlySnapshot {
  month: number;
  date: string;
  debtStates: DebtMonthState[];
  totalPaidCents: number;
  totalRemainingCents: number;
}

export interface DebtMonthState {
  debtId: string;
  name: string;
  startBalanceCents: number;
  interestCents: number;
  paymentCents: number;
  endBalanceCents: number;
  isPaidOff: boolean;
}

export interface PayoffSimulationResult {
  strategy: PayoffStrategy;
  strategyDescription: string;
  monthsToPayoff: number;
  totalPaidCents: number;
  totalInterestCents: number;
  totalPenaltiesCents: number;
  debtFreeDate: string;
  schedule: MonthlySnapshot[];
  payoffOrder: string[];
}

export interface StrategyComparison {
  strategies: PayoffSimulationResult[];
  recommended: PayoffStrategy;
  savingsVsWorstCents: number;
}

export interface DebtVsInvestResult {
  debtFirstNetWorthCents: number;
  investFirstNetWorthCents: number;
  recommendation: 'pay_debt' | 'invest' | 'split';
  breakEvenReturnBps: number;
  explanation: string;
}
