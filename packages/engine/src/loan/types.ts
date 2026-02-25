import type { DebtSnapshot } from '../debt/types.js';

export interface LoanSummary {
  id: string;
  name: string;
  type: 'loan' | 'installment' | 'credit_line';
  principalCents: number;
  aprBps: number;
  termMonths: number;
  startDate: string;
  monthlyPaymentCents: number;
  paymentDay: number;
  currentDebtCents: number;
  isActive: boolean;
}

export interface AmortizationEntry {
  month: number;
  date: string;
  startBalanceCents: number;
  principalCents: number;
  interestCents: number;
  paymentCents: number;
  endBalanceCents: number;
}

export type { DebtSnapshot };
