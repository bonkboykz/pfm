import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { DB } from '../db/index.js';
import { loans, transactions } from '../db/schema.js';
import type { LoanSummary, AmortizationEntry } from './types.js';
import type { DebtSnapshot } from '../debt/types.js';

export function getLoanCurrentDebt(db: DB, loanId: string): number {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return 0;

  if (!loan.categoryId) return loan.principalCents;

  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, loan.categoryId),
        eq(transactions.isDeleted, false),
        sql`${transactions.transferAccountId} IS NULL`,
      ),
    )
    .get();

  const totalPayments = Math.abs(result?.total ?? 0);
  return Math.max(0, loan.principalCents - totalPayments);
}

export function getLoanSummary(db: DB, loanId: string): LoanSummary | null {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return null;

  const currentDebtCents = getLoanCurrentDebt(db, loanId);

  return {
    id: loan.id,
    name: loan.name,
    type: loan.type,
    principalCents: loan.principalCents,
    aprBps: loan.aprBps,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    monthlyPaymentCents: loan.monthlyPaymentCents,
    paymentDay: loan.paymentDay,
    currentDebtCents,
    isActive: loan.isActive,
  };
}

export function loanToDebtSnapshot(db: DB, loanId: string): DebtSnapshot | null {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return null;

  const currentDebtCents = getLoanCurrentDebt(db, loanId);

  return {
    id: loan.id,
    name: loan.name,
    type: loan.type === 'credit_line' ? 'credit_card' : loan.type,
    balanceCents: currentDebtCents,
    aprBps: loan.aprBps,
    minPaymentCents: loan.monthlyPaymentCents,
    remainingInstallments: loan.type === 'installment'
      ? Math.ceil(currentDebtCents / loan.monthlyPaymentCents)
      : undefined,
  };
}

export function generateAmortizationSchedule(db: DB, loanId: string): AmortizationEntry[] {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return [];

  const schedule: AmortizationEntry[] = [];
  let balance = loan.principalCents;
  const monthlyRate = loan.aprBps > 0
    ? new Decimal(loan.aprBps).div(10000).div(12)
    : new Decimal(0);

  const [startYear, startMonth] = loan.startDate.split('-').map(Number);

  for (let i = 1; i <= loan.termMonths && balance > 0; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const date = `${year}-${String(month).padStart(2, '0')}`;

    const startBalance = balance;

    let interestCents = 0;
    if (loan.aprBps > 0) {
      interestCents = new Decimal(balance).times(monthlyRate).round().toNumber();
    }

    const payment = Math.min(loan.monthlyPaymentCents, balance + interestCents);
    const principalPaid = payment - interestCents;
    balance = Math.max(0, startBalance - principalPaid);

    schedule.push({
      month: i,
      date,
      startBalanceCents: startBalance,
      principalCents: principalPaid,
      interestCents,
      paymentCents: payment,
      endBalanceCents: balance,
    });
  }

  return schedule;
}
