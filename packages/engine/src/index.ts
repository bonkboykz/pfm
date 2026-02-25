export { createDb, db, schema } from './db/index.js';
export type { DB } from './db/index.js';
export {
  accounts,
  categoryGroups,
  categories,
  payees,
  transactions,
  monthlyBudgets,
} from './db/schema.js';

export { formatMoney, addCents, subtractCents, multiplyCents, sumCents } from './math/money.js';
export type { CategoryBudget, BudgetMonth, AccountBalance, ReadyToAssignBreakdown } from './budget/types.js';
export { getBudgetMonth, assignToCategory, moveBetweenCategories, getAccountBalances, getReadyToAssign } from './budget/engine.js';
