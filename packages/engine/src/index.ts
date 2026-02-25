export { createDb, db, schema } from './db/index.js';
export type { DB } from './db/index.js';
export {
  accounts,
  categoryGroups,
  categories,
  payees,
  transactions,
  monthlyBudgets,
  scheduledTransactions,
  loans,
  personalDebts,
} from './db/schema.js';

export { formatMoney, addCents, subtractCents, multiplyCents, sumCents } from './math/money.js';
export type { CategoryBudget, BudgetMonth, AccountBalance, ReadyToAssignBreakdown } from './budget/types.js';
export { getBudgetMonth, assignToCategory, moveBetweenCategories, getAccountBalances, getReadyToAssign } from './budget/engine.js';

export type { DebtSnapshot, PayoffStrategy, MonthlySnapshot, DebtMonthState, PayoffSimulationResult, StrategyComparison, DebtVsInvestResult } from './debt/types.js';
export { simulatePayoff } from './debt/simulator.js';
export { compareStrategies, debtVsInvest } from './debt/analyzer.js';

export type { Frequency, ScheduledTransaction, ProcessResult } from './scheduler/types.js';
export { getUpcoming, processDue, advanceDate } from './scheduler/engine.js';

export type { LoanSummary, AmortizationEntry } from './loan/types.js';
export { getLoanCurrentDebt, getLoanSummary, loanToDebtSnapshot, generateAmortizationSchedule } from './loan/engine.js';
