import { z } from 'zod';
import type { HttpMethod } from './dispatch.js';

export interface ToolDef {
  name: string;
  description: string;
  /** Argument schema. Shown to the model; the route re-validates on arrival. */
  schema: z.ZodObject<z.ZodRawShape>;
  method: HttpMethod;
  path: (args: any) => string;
  /** Omit for GET/DELETE. */
  body?: (args: any) => unknown;
}

/** Builds a query string, dropping undefined values. Returns '' when empty. */
function qs(params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** PATCH tools take `id` for the path; it must not travel in the body. */
function omitId<T extends Record<string, unknown>>(args: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = args;
  return rest;
}

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking'] as const;
const CARD_TYPES = ['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other'] as const;

export const tools: ToolDef[] = [
  // ===== Accounts =====
  {
    name: 'list_accounts',
    description:
      'List all active accounts with computed balances. Each entry carries balanceCents plus balanceFormatted, and the cleared/uncleared split. Start here to discover account IDs.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/accounts',
  },
  {
    name: 'get_account',
    description: 'Get one account by id, including its computed balance and cleared/uncleared split.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/accounts/${a.id}`,
  },
  {
    name: 'create_account',
    description:
      'Create an account. type "tracking" is always off-budget; every other type defaults to on-budget. Currency defaults to KZT.',
    schema: z.object({
      name: z.string().min(1),
      type: z.enum(ACCOUNT_TYPES),
      onBudget: z.boolean().optional(),
      currency: z.string().optional(),
      note: z.string().optional(),
      bankName: z.string().optional(),
      last4Digits: z.string().length(4).optional(),
      cardType: z.enum(CARD_TYPES).optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/accounts',
    body: (a) => a,
  },
  {
    name: 'update_account',
    description: 'Update an account. Only the supplied fields change. Nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      onBudget: z.boolean().optional(),
      currency: z.string().optional(),
      sortOrder: z.number().int().optional(),
      note: z.string().nullable().optional(),
      bankName: z.string().nullable().optional(),
      last4Digits: z.string().length(4).nullable().optional(),
      cardType: z.enum(CARD_TYPES).nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/accounts/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_account',
    description:
      'Deactivate an account. This hides the account and its history from balances. Prefer fixing individual transactions over deleting an account.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/accounts/${a.id}`,
  },

  // ===== Categories =====
  {
    name: 'list_categories',
    description:
      'List category groups with their categories, excluding system and hidden ones. Use this to discover category IDs before assigning money or filing a transaction.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/categories',
  },
  {
    name: 'create_category_group',
    description: 'Create a category group — the heading that categories are filed under, e.g. "Fixed costs".',
    schema: z.object({ name: z.string().min(1) }),
    method: 'POST',
    path: () => '/api/v1/categories/groups',
    body: (a) => a,
  },
  {
    name: 'create_category',
    description:
      'Create a category inside a group. Optional target: targetType "monthly_funding" | "target_balance" | "target_by_date" with targetAmountCents in tiyn, and targetDate as YYYY-MM-DD for date targets.',
    schema: z.object({
      groupId: z.string().min(1),
      name: z.string().min(1),
      targetAmountCents: z.number().int().optional(),
      targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
      targetDate: z.string().optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/categories',
    body: (a) => a,
  },
  {
    name: 'update_category',
    description: 'Update a category name, target or note. Nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      targetAmountCents: z.number().int().nullable().optional(),
      targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
      targetDate: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/categories/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_category',
    description:
      'Hide a category. Its past transactions keep their history; the category stops appearing in the budget.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/categories/${a.id}`,
  },

  // ===== Budget =====
  {
    name: 'get_budget',
    description:
      'Full budget for a month (YYYY-MM): every category with assigned, activity and available in tiyn plus formatted variants, grouped by category group, and Ready to Assign for that month.',
    schema: z.object({ month: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/${a.month}`,
  },
  {
    name: 'get_rta_overview',
    description:
      'Ready to Assign across a range of months at once, starting at optional `from` (YYYY-MM). Use this instead of calling get_ready_to_assign month by month when diagnosing where money went missing — RTA is cumulative, so a single month in isolation misleads.',
    schema: z.object({ from: z.string().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/rta-overview${qs({ from: a.from })}`,
  },
  {
    name: 'get_ready_to_assign',
    description:
      'Ready to Assign for one month (YYYY-MM) with its breakdown: total inflows and total assigned, computed cumulatively from the beginning through that month.',
    schema: z.object({ month: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/${a.month}/ready-to-assign`,
  },
  {
    name: 'assign_budget',
    description:
      'Set the amount assigned to a category for a month (YYYY-MM). amountCents is the new total for that month in tiyn, not a delta, and must be zero or positive.',
    schema: z.object({
      month: z.string(),
      categoryId: z.string().min(1),
      amountCents: z.number().int().min(0),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/assign`,
    body: (a) => ({ categoryId: a.categoryId, amountCents: a.amountCents }),
  },
  {
    name: 'move_budget',
    description:
      'Move assigned money between two categories within a month (YYYY-MM). amountCents must be positive and is taken from the source and added to the target. This is how you cover an overspent category without touching Ready to Assign.',
    schema: z.object({
      month: z.string(),
      fromCategoryId: z.string().min(1),
      toCategoryId: z.string().min(1),
      amountCents: z.number().int().positive(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/move`,
    body: (a) => ({
      fromCategoryId: a.fromCategoryId,
      toCategoryId: a.toCategoryId,
      amountCents: a.amountCents,
    }),
  },

  // ===== Transactions =====
  {
    name: 'list_transactions',
    description:
      'List transactions newest first, default limit 50. Filter by accountId, categoryId and a since/until date range (YYYY-MM-DD). Amounts are tiyn; negative is an outflow.',
    schema: z.object({
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    method: 'GET',
    path: (a) =>
      `/api/v1/transactions${qs({
        accountId: a.accountId,
        categoryId: a.categoryId,
        since: a.since,
        until: a.until,
        limit: a.limit,
      })}`,
  },
  {
    name: 'get_transaction',
    description: 'Get one transaction by id.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/transactions/${a.id}`,
  },
  {
    name: 'create_transaction',
    description:
      'Record a transaction. amountCents is tiyn: negative for spending, positive for income. Supplying transferAccountId makes it a transfer between two accounts — the API writes both paired sides and leaves them uncategorised, which is correct and must not be "fixed" by also passing categoryId.',
    schema: z.object({
      accountId: z.string().min(1),
      date: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/transactions',
    body: (a) => a,
  },
  {
    name: 'update_transaction',
    description:
      'Update a transaction. Only supplied fields change. categoryId and memo accept null to clear them. To recategorise a transfer, edit the accounts instead — transfers carry no category by design.',
    schema: z.object({
      id: z.string(),
      date: z.string().optional(),
      amountCents: z.number().int().optional(),
      payeeName: z.string().optional(),
      categoryId: z.string().nullable().optional(),
      memo: z.string().nullable().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/transactions/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_transaction',
    description:
      'Delete a transaction. Use this for typos and duplicates. Deleting one side of a transfer is handled by the API.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/transactions/${a.id}`,
  },

  // ===== Scheduled transactions =====
  {
    name: 'list_scheduled',
    description:
      'List scheduled (recurring) transactions. Pass upcoming as a number of days to only return the ones due within that window.',
    schema: z.object({ upcoming: z.number().int().positive().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/scheduled${qs({ upcoming: a.upcoming })}`,
  },
  {
    name: 'create_scheduled',
    description:
      'Create a recurring transaction. frequency is weekly, biweekly, monthly or yearly; nextDate (YYYY-MM-DD) is the next occurrence. amountCents is tiyn, negative for spending. Supplying transferAccountId schedules a recurring transfer.',
    schema: z.object({
      accountId: z.string().min(1),
      frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']),
      nextDate: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/scheduled',
    body: (a) => a,
  },
  {
    name: 'update_scheduled',
    description:
      'Update a scheduled transaction. Only supplied fields change; nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']).optional(),
      nextDate: z.string().optional(),
      amountCents: z.number().int().optional(),
      payeeName: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      transferAccountId: z.string().nullable().optional(),
      memo: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/scheduled/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_scheduled',
    description:
      'Delete a scheduled transaction. Already-created transactions from past occurrences are not affected.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/scheduled/${a.id}`,
  },
  {
    name: 'process_scheduled',
    description:
      'Create real transactions for every scheduled item due on or before asOfDate (YYYY-MM-DD, defaults to today) and advance each to its next occurrence. This writes to the ledger — confirm with the user before calling it.',
    schema: z.object({ asOfDate: z.string().optional() }),
    method: 'POST',
    path: () => '/api/v1/scheduled/process',
    body: (a) => (a.asOfDate === undefined ? {} : { asOfDate: a.asOfDate }),
  },

  // ===== Loans =====
  {
    name: 'list_loans',
    description:
      'List bank loans with current outstanding debt, monthly payment and progress. Amounts are tiyn; aprBps is basis points (1850 = 18.50%).',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/loans',
  },
  {
    name: 'get_loan',
    description:
      'Get one loan by id with its computed summary: outstanding principal, payments made and remaining term.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/loans/${a.id}`,
  },
  {
    name: 'create_loan',
    description:
      'Create a loan. principalCents and monthlyPaymentCents are tiyn, aprBps is basis points, startDate is YYYY-MM-DD, paymentDay is 1–28. paidOffCents records principal already repaid before this loan was entered.',
    schema: z.object({
      name: z.string().min(1),
      type: z.enum(['loan', 'installment', 'credit_line']),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      principalCents: z.number().int().positive(),
      aprBps: z.number().int().min(0).optional(),
      termMonths: z.number().int().positive(),
      startDate: z.string(),
      monthlyPaymentCents: z.number().int().positive(),
      paymentDay: z.number().int().min(1).max(28),
      penaltyRateBps: z.number().int().min(0).optional(),
      earlyRepaymentFeeCents: z.number().int().min(0).optional(),
      paidOffCents: z.number().int().min(0).optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/loans',
    body: (a) => a,
  },
  {
    name: 'update_loan',
    description:
      'Update a loan. Principal, APR, term and start date are deliberately not editable — recreate the loan if those were entered wrong.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      accountId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      monthlyPaymentCents: z.number().int().positive().optional(),
      paymentDay: z.number().int().min(1).max(28).optional(),
      penaltyRateBps: z.number().int().min(0).optional(),
      earlyRepaymentFeeCents: z.number().int().min(0).optional(),
      paidOffCents: z.number().int().min(0).optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/loans/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_loan',
    description: 'Deactivate a loan, removing it from lists and debt totals.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/loans/${a.id}`,
  },
  {
    name: 'get_loan_schedule',
    description:
      'Full amortization schedule for a loan: per-month principal, interest and remaining balance in tiyn. Use this to answer "how much of my payment is interest".',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/loans/${a.id}/schedule`,
  },

  // ===== Personal debts =====
  {
    name: 'list_debts',
    description:
      'List informal debts between the user and other people. direction "owe" means the user owes them; "owed" means they owe the user. Settled debts are excluded unless includeSettled is true.',
    schema: z.object({ includeSettled: z.boolean().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/debts${qs({ includeSettled: a.includeSettled })}`,
  },
  {
    name: 'get_debt',
    description: 'Get one personal debt by id.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/debts/${a.id}`,
  },
  {
    name: 'create_debt',
    description:
      'Record a personal debt. direction "owe" = the user owes personName; "owed" = personName owes the user. amountCents is tiyn and must be positive — direction carries the sign, not the amount. dueDate is YYYY-MM-DD.',
    schema: z.object({
      personName: z.string().min(1),
      direction: z.enum(['owe', 'owed']),
      amountCents: z.number().int().positive(),
      currency: z.string().optional(),
      dueDate: z.string().optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/debts',
    body: (a) => a,
  },
  {
    name: 'update_debt',
    description:
      'Update a personal debt. direction cannot be changed — delete and recreate if it was entered backwards.',
    schema: z.object({
      id: z.string(),
      personName: z.string().min(1).optional(),
      amountCents: z.number().int().positive().optional(),
      currency: z.string().optional(),
      dueDate: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/debts/${a.id}`,
    body: omitId,
  },
  {
    name: 'settle_debt',
    description:
      'Mark a personal debt as settled, stamped with today as the settled date. Fails if it is already settled. This does not create a transaction — record any money movement separately with create_transaction.',
    schema: z.object({ id: z.string() }),
    method: 'POST',
    path: (a) => `/api/v1/debts/${a.id}/settle`,
  },
  {
    name: 'delete_debt',
    description: 'Permanently delete a personal debt record. Prefer settle_debt when the debt was actually repaid.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/debts/${a.id}`,
  },
];
