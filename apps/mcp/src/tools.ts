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
      'List accounts with computed balances. Each entry carries balanceCents plus balanceFormatted, the cleared/uncleared split, and the onBudget, currency and isActive flags. Pass includeInactive to also see deactivated accounts — their transactions still move Ready to Assign, so an unexplained total is often one of them. Start here to discover account IDs.',
    schema: z.object({ includeInactive: z.boolean().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/accounts${qs({ includeInactive: a.includeInactive })}`,
  },
  {
    name: 'reconcile_account',
    description:
      "Correct an account's balance to what the bank actually shows, by writing one adjustment transaction for the difference. Use this when the computed balance has drifted from reality — never a pile of hand-made offsetting transactions. On on-budget accounts the adjustment lands in Ready to Assign.",
    schema: z.object({
      id: z.string(),
      actualBalanceCents: z.number().int(),
      date: z.string().optional(),
      memo: z.string().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/accounts/${a.id}/reconcile`,
    body: omitId,
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
      isActive: z.boolean().optional(),
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
      'Archive an account: it disappears from the lists, its history stays. Pass purge to remove it permanently — allowed only when nothing hangs off it (no transactions, transfers, loans, deposits or scheduled rules); otherwise it returns 409 and archiving is the only option. Prefer fixing individual transactions over removing an account.',
    schema: z.object({ id: z.string(), purge: z.boolean().optional() }),
    method: 'DELETE',
    path: (a) => `/api/v1/accounts/${a.id}${a.purge ? '?purge=true' : ''}`,
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
    name: 'get_age_of_money',
    description:
      'Age of Money — the fourth YNAB rule. How many days a tenge sits in the accounts before it is spent, resolved FIFO: every outflow consumes the oldest untouched inflows. Above 30 means the month runs on last month\'s income and payday stops being an event. Transfers between two on-budget accounts count as neither inflow nor outflow. days is null when there is nothing to measure — report that as missing data, never as zero, which would claim the user lives hand to mouth.',
    schema: z.object({ asOf: z.string().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/age-of-money${qs({ asOf: a.asOf })}`,
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
      'Set the amount assigned to a category for a month (YYYY-MM). amountCents is the new total for that month in tiyn, not a delta, and must be zero or positive. An unknown categoryId is rejected with UNKNOWN_REFERENCE rather than silently accepted. Defaults to returning only the touched category and the new Ready to Assign; pass full=true for the whole month.',
    schema: z.object({
      month: z.string(),
      categoryId: z.string().min(1),
      amountCents: z.number().int().min(0),
      full: z.boolean().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/assign${a.full ? '' : '?response=minimal'}`,
    body: (a) => ({ categoryId: a.categoryId, amountCents: a.amountCents }),
  },
  {
    name: 'bulk_assign_budget',
    description:
      'Assign to many categories in one month in a single all-or-nothing write. Every categoryId is validated before anything is stored, so a bad id cannot leave the batch half-applied. Prefer this over a run of assign_budget calls.',
    schema: z.object({
      month: z.string(),
      assignments: z.array(z.object({
        categoryId: z.string().min(1),
        amountCents: z.number().int().min(0),
      })).min(1),
      full: z.boolean().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/bulk-assign${a.full ? '' : '?response=minimal'}`,
    body: (a) => ({ assignments: a.assignments }),
  },
  {
    name: 'assign_to_targets',
    description:
      'Fund every underfunded target for the month in one call, stopping when Ready to Assign hits zero — the answer to "distribute my salary". Amounts come from the engine per target type, so no arithmetic is needed on the caller side. Targets with a date are funded first (nearest first), then the rest in budget order; the last category may be funded partially. Returns what was applied, the new Ready to Assign, what is still short, and stoppedAtZeroRta. Set allowNegativeRta to overspend the budget deliberately.',
    schema: z.object({
      month: z.string(),
      allowNegativeRta: z.boolean().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/assign-targets`,
    body: (a) => ({ allowNegativeRta: a.allowNegativeRta ?? false }),
  },
  {
    name: 'copy_month_assignments',
    description:
      'Make a month a copy of another one: every category gets the amount it was assigned in fromMonth, including zero. This is a replacement, not a merge — a category assigned this month but not in the source is cleared. If the source month has nothing assigned at all, nothing is written and sourceEmpty comes back true.',
    schema: z.object({
      month: z.string(),
      fromMonth: z.string(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/copy-from`,
    body: (a) => ({ fromMonth: a.fromMonth }),
  },
  {
    name: 'set_available',
    description:
      "Force a category's Available to an exact figure for a month, including zero — the way to clear carryover inherited from earlier months, which assign_budget cannot do because it only sets the current month and refuses negatives. The difference moves to or from Ready to Assign. This shuffles money between the budget's own buckets; if the budget holds more than the accounts do, the inflows are wrong and reconcile_account is the fix.",
    schema: z.object({
      month: z.string(),
      categoryId: z.string().min(1),
      amountCents: z.number().int(),
      full: z.boolean().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/set-available${a.full ? '' : '?response=minimal'}`,
    body: (a) => ({ categoryId: a.categoryId, amountCents: a.amountCents }),
  },
  {
    name: 'reset_budget',
    description:
      'Delete every assignment from fromMonth (YYYY-MM) onward — "start budgeting again from here". Requires confirm: true. Carryover from months before fromMonth survives; clear that with set_available. Destructive, and undoable only via undo_changes.',
    schema: z.object({
      fromMonth: z.string(),
      confirm: z.literal(true),
    }),
    method: 'POST',
    path: () => '/api/v1/budget/reset',
    body: (a) => a,
  },
  {
    name: 'get_upcoming_shortfalls',
    description:
      'Look ahead and report which categories will run out of money, and on what date, by pushing every scheduled payment forward against the money assigned to it. Repeating rules are expanded into each occurrence in the window, and each payment is measured against the Available of the month it actually falls in — so a rent payment due next month is not reported as a shortfall against this month. Set onlyShort to get just the problems. Also lists scheduled money that reaches no category, which the budget can never see. Use this before assigning a month, and after, to check the plan survives contact with the calendar.',
    schema: z.object({
      days: z.number().int().min(1).max(730).optional(),
      asOf: z.string().optional(),
      onlyShort: z.boolean().optional(),
    }),
    method: 'GET',
    path: (a) => `/api/v1/budget/forecast${qs({ days: a.days, asOf: a.asOf, onlyShort: a.onlyShort })}`,
  },
  {
    name: 'get_rta_reconciliation',
    description:
      'Explain why the money in the accounts does not equal Ready to Assign plus everything sitting in categories. Returns every account with its balance, onBudget, currency and isActive, then itemises the gap: off-budget balances, deactivated accounts, foreign currency, uncategorised spending and transfers that left the budget. A non-zero unexplainedCents means a real anomaly, not a modelling gap.',
    schema: z.object({ month: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/${a.month}/reconciliation`,
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
      'List transactions newest first, default limit 50. Filter by accountId, categoryId and a since/until date range (YYYY-MM-DD). Amounts are tiyn; negative is an outflow. Pass estimated=true to list only rows still carrying a provisional amount — a purchase priced in another currency, recorded at a quoted rate and waiting for the bank statement to confirm the tenge figure.',
    schema: z.object({
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      estimated: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    }),
    method: 'GET',
    path: (a) =>
      `/api/v1/transactions${qs({
        accountId: a.accountId,
        categoryId: a.categoryId,
        since: a.since,
        until: a.until,
        estimated: a.estimated,
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
      'Record a transaction. amountCents is tiyn: negative for spending, positive for income. Supplying transferAccountId makes it a transfer between two accounts — the API writes both paired sides. Between two accounts on the same side of the budget it stays uncategorised and categoryId is rejected: nothing was spent, the money only moved. Crossing the budget boundary (one account on-budget, the other not) requires categoryId, because the money leaves the budget or enters it — use "ready-to-assign" for money coming in. The API puts the category on whichever side is on-budget. Omitting categoryId for a payee seen before fills in that payee\'s last category; passing it explicitly always wins. For a purchase priced in another currency on a tenge card, put the receipt amount in originalAmountCents + originalCurrency and the rate you used in quotedRateCents (tiyn per one unit, 464.02 KZT/USD is 46402), and set isEstimated until the bank statement confirms the tenge figure — never bury the rate in memo, it cannot be queried or recomputed there.',
    schema: z.object({
      accountId: z.string().min(1),
      date: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
      originalAmountCents: z.number().int().optional(),
      originalCurrency: z.string().length(3).optional(),
      quotedRateCents: z.number().int().positive().optional(),
      isEstimated: z.boolean().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/transactions',
    body: (a) => a,
  },
  {
    name: 'bulk_create_transactions',
    description:
      'Record many transactions in one all-or-nothing write. Every accountId and categoryId is validated before anything is stored. Set skipDuplicates to drop rows matching an existing date + amount + payee on the same account. Transfers are not supported here — use create_transaction for those.',
    schema: z.object({
      transactions: z.array(z.object({
        accountId: z.string().min(1),
        date: z.string(),
        amountCents: z.number().int(),
        payeeName: z.string().optional(),
        categoryId: z.string().optional(),
        memo: z.string().optional(),
        cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
      })).min(1),
      skipDuplicates: z.boolean().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/transactions/bulk',
    body: (a) => a,
  },
  {
    name: 'import_transactions',
    description:
      'Import a bank statement CSV into one account, skipping rows that duplicate an existing date + amount + payee. Column names are detected from the header (English or Russian) and can be overridden. Dates accept YYYY-MM-DD, DD.MM.YYYY or DD/MM/YYYY; amounts accept spaces as thousand separators, comma or dot decimals, and parentheses for debits. Run with dryRun first to see what would land. Rows whose payee is already known arrive with that payee\'s last category and the response counts them in categorised; the rest arrive uncategorised.',
    schema: z.object({
      accountId: z.string().min(1),
      csv: z.string().min(1),
      dateColumn: z.string().optional(),
      amountColumn: z.string().optional(),
      payeeColumn: z.string().optional(),
      memoColumn: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/transactions/import',
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
      originalAmountCents: z.number().int().optional(),
      originalCurrency: z.string().length(3).optional(),
      quotedRateCents: z.number().int().positive().optional(),
      isEstimated: z.boolean().optional(),
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
      'Create a recurring transaction. frequency is weekly, biweekly, monthly or yearly; nextDate (YYYY-MM-DD) is the next occurrence. amountCents is tiyn, negative for spending. Supplying transferAccountId schedules a recurring transfer. Pass autoPost false for a reminder-only rule: process_scheduled then reports it instead of posting it — use that for loan payments, where the amount paid and the debt repaid are different numbers.',
    schema: z.object({
      accountId: z.string().min(1),
      frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']),
      nextDate: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
      autoPost: z.boolean().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/scheduled',
    body: (a) => a,
  },
  {
    name: 'update_scheduled',
    description:
      'Update a scheduled transaction, including accountId — a rule created against the wrong account is fixed here, not by deleting it and creating a new one. Setting autoPost false turns it into a reminder without losing its history. Only supplied fields change; nullable fields accept null to clear them.',
    schema: z.object({
      isActive: z.boolean().optional(),
      id: z.string(),
      autoPost: z.boolean().optional(),
      accountId: z.string().min(1).optional(),
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
      'Create real transactions for every scheduled item due on or before asOfDate (YYYY-MM-DD, defaults to today) and advance each to its next occurrence. Rules with autoPost false are left untouched and come back in reminders[] — they still need a transaction entered by hand. This writes to the ledger — confirm with the user before calling it.',
    schema: z.object({ asOfDate: z.string().optional() }),
    method: 'POST',
    path: () => '/api/v1/scheduled/process',
    body: (a) => (a.asOfDate === undefined ? {} : { asOfDate: a.asOfDate }),
  },

  // ===== Loans =====
  {
    name: 'list_loans',
    description:
      'List bank loans with current outstanding debt, monthly payment and progress. Amounts are tiyn; aprBps is basis points (1850 = 18.50%). Pass includeInactive to also see closed loans, and withTotals for the summed active debt.',
    schema: z.object({
      includeInactive: z.boolean().optional(),
      withTotals: z.boolean().optional(),
    }),
    method: 'GET',
    path: (a) => `/api/v1/loans${qs({ includeInactive: a.includeInactive, withTotals: a.withTotals })}`,
  },
  {
    name: 'pay_loan',
    description:
      'Record a payment against a loan. One call does both jobs: it writes the spending transaction and reduces the debt by the part that actually went to principal. Interest is computed from the real outstanding balance for the real number of days since the previous payment (actual/365), and everything above it reduces the principal — so paying extra shortens the loan and the next payment accrues on less. Do not record loan payments with create_transaction: the budget would see the money leave while the debt stayed put. Pass amountCents as the amount that left the account (sign is ignored). categoryId defaults to the loan\'s own category.',
    schema: z.object({
      id: z.string(),
      accountId: z.string().min(1),
      date: z.string(),
      amountCents: z.number().int(),
      categoryId: z.string().optional(),
      payeeName: z.string().optional(),
      memo: z.string().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/loans/${a.id}/payment`,
    body: omitId,
  },
  {
    name: 'close_loan',
    description:
      'Close a paid-off loan: marks it inactive, settles the outstanding balance to zero and records when and why. This is the right way to retire a loan — delete_loan only hides it and leaves its balance in the debt totals, which is how repaid loans end up inflating what you owe. The loan stays readable by id and via list_loans(includeInactive).',
    schema: z.object({
      id: z.string(),
      closedDate: z.string().optional(),
      reason: z.string().optional(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/loans/${a.id}/close`,
    body: omitId,
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
      'Create a loan. Amounts are tiyn, aprBps is basis points, startDate is YYYY-MM-DD, paymentDay is 1–28. Quote the bank statement directly with currentBalanceCents — what is left to repay. Use principalCents plus paidOffCents only when you genuinely know the original sum and how much of it is already repaid; do not reconstruct them by arithmetic.',
    schema: z.object({
      name: z.string().min(1),
      type: z.enum(['loan', 'installment', 'credit_line']),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      currentBalanceCents: z.number().int().min(0).optional(),
      principalCents: z.number().int().positive().optional(),
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
      'Update a loan, including its terms: principal, APR, term, start date and type are editable, so a rate the bank revised or a figure typed wrong is a PATCH, not a delete and recreate — recreating loses the id and the payment history hanging off it. paidOffCents can never exceed principalCents; changing either is checked against the other. isActive false retires a loan without settling its balance; to retire one that is actually repaid, use close_loan instead. Setting isActive true reopens a closed loan and clears its closure record.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      type: z.enum(['loan', 'installment', 'credit_line']).optional(),
      principalCents: z.number().int().positive().optional(),
      aprBps: z.number().int().min(0).optional(),
      termMonths: z.number().int().positive().optional(),
      startDate: z.string().optional(),
      accountId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      monthlyPaymentCents: z.number().int().positive().optional(),
      paymentDay: z.number().int().min(1).max(28).optional(),
      penaltyRateBps: z.number().int().min(0).optional(),
      earlyRepaymentFeeCents: z.number().int().min(0).optional(),
      paidOffCents: z.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
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

  // ===== Deposits =====
  {
    name: 'list_deposits',
    description:
      'List active deposits with current balance, accrued interest and effective annual rate. annualRateBps is basis points (1550 = 15.50%); amounts are tiyn.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/deposits',
  },
  {
    name: 'get_deposit',
    description:
      'Get one deposit by id with its computed summary: current balance, interest accrued and days to maturity.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/deposits/${a.id}`,
  },
  {
    name: 'create_deposit',
    description:
      'Create a deposit. initialAmountCents is tiyn, annualRateBps is basis points, startDate is YYYY-MM-DD, termMonths 0 means open-ended. capitalization controls compounding: monthly, quarterly, at_end or none.',
    schema: z.object({
      name: z.string().min(1),
      bankName: z.string().min(1),
      type: z.enum(['term', 'savings', 'demand']),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      initialAmountCents: z.number().int().positive(),
      currency: z.string().optional(),
      annualRateBps: z.number().int().min(0),
      earlyWithdrawalRateBps: z.number().int().min(0).optional(),
      termMonths: z.number().int().min(0),
      startDate: z.string(),
      endDate: z.string().optional(),
      capitalization: z.enum(['monthly', 'quarterly', 'at_end', 'none']).optional(),
      isWithdrawable: z.boolean().optional(),
      isReplenishable: z.boolean().optional(),
      minBalanceCents: z.number().int().min(0).optional(),
      topUpCents: z.number().int().min(0).optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/deposits',
    body: (a) => a,
  },
  {
    name: 'update_deposit',
    description:
      'Update a deposit. Rate, term and start date are deliberately not editable — recreate the deposit if those were entered wrong. topUpCents records additional money paid in.',
    schema: z.object({
      isActive: z.boolean().optional(),
      id: z.string(),
      name: z.string().min(1).optional(),
      accountId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      topUpCents: z.number().int().min(0).optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/deposits/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_deposit',
    description: 'Deactivate a deposit, removing it from lists and KDIF exposure.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/deposits/${a.id}`,
  },
  {
    name: 'get_deposit_schedule',
    description:
      'Month-by-month interest schedule for a deposit: opening balance, interest, capitalised amount, closing balance and cumulative interest, all in tiyn. Pass months to truncate a long schedule.',
    schema: z.object({ id: z.string(), months: z.number().int().positive().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/deposits/${a.id}/schedule${qs({ months: a.months })}`,
  },
  {
    name: 'get_kdif_exposure',
    description:
      'Deposit exposure per bank against the Kazakhstan Deposit Insurance Fund guarantee limit, flagging any bank where the user holds more than is insured.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/deposits/kdif',
  },

  // ===== Simulations =====
  {
    name: 'simulate_payoff',
    description:
      'Simulate paying off a set of debts under one strategy: snowball (smallest balance first), avalanche (highest APR first), highest_monthly_interest, or cash_flow_index. Debts are passed in explicitly rather than read from the database, so hypotheticals are possible. extraMonthlyCents is the additional payment above the minimums; startDate is YYYY-MM.',
    schema: z.object({
      debts: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            type: z.enum(['credit_card', 'loan', 'installment']),
            balanceCents: z.number().int().positive(),
            aprBps: z.number().int().min(0),
            minPaymentCents: z.number().int().positive(),
            remainingInstallments: z.number().int().positive().optional(),
            latePenaltyCents: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(20),
      strategy: z.enum(['snowball', 'avalanche', 'highest_monthly_interest', 'cash_flow_index']),
      extraMonthlyCents: z.number().int().min(0).optional(),
      startDate: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/payoff',
    body: (a) => a,
  },
  {
    name: 'compare_strategies',
    description:
      'Run every payoff strategy against the same debts and compare total interest and months to debt-free. Use this to answer "snowball or avalanche" with numbers instead of opinion.',
    schema: z.object({
      debts: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            type: z.enum(['credit_card', 'loan', 'installment']),
            balanceCents: z.number().int().positive(),
            aprBps: z.number().int().min(0),
            minPaymentCents: z.number().int().positive(),
            remainingInstallments: z.number().int().positive().optional(),
            latePenaltyCents: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(20),
      extraMonthlyCents: z.number().int().min(0).optional(),
      startDate: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/compare',
    body: (a) => a,
  },
  {
    name: 'debt_vs_invest',
    description:
      'Compare putting extraMonthlyCents against one debt versus investing it at expectedReturnBps over horizonMonths, and report which leaves the user better off.',
    schema: z.object({
      extraMonthlyCents: z.number().int().min(0),
      debt: z.object({
        id: z.string().optional(),
        name: z.string(),
        type: z.enum(['credit_card', 'loan', 'installment']),
        balanceCents: z.number().int().positive(),
        aprBps: z.number().int().min(0),
        minPaymentCents: z.number().int().positive(),
        remainingInstallments: z.number().int().positive().optional(),
        latePenaltyCents: z.number().int().min(0).optional(),
      }),
      expectedReturnBps: z.number().int().min(0),
      horizonMonths: z.number().int().positive().max(600),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/debt-vs-invest',
    body: (a) => a,
  },
  {
    name: 'compare_deposits',
    description:
      'Compare 2–10 hypothetical deposit offers by effective annual rate and total interest, accounting for how each compounds. Use this to choose between bank offers before opening one.',
    schema: z.object({
      deposits: z
        .array(
          z.object({
            name: z.string().min(1),
            initialAmountCents: z.number().int().positive(),
            annualRateBps: z.number().int().min(0),
            termMonths: z.number().int().min(0),
            capitalization: z.enum(['monthly', 'quarterly', 'at_end', 'none']).optional(),
          }),
        )
        .min(2)
        .max(10),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/deposit-compare',
    body: (a) => a,
  },

  // ===== Audit =====
  {
    name: 'list_recent_changes',
    description:
      'Review what was changed recently, newest first, grouped into batches — one batch per request, so a bulk import reads as a single entry. Each batch carries the batchId that undo_changes takes. Filter by entity (transactions, monthly_budgets, loans). Use this to check your own work before trusting it.',
    schema: z.object({
      limit: z.number().int().min(1).max(500).optional(),
      entity: z.enum(['transactions', 'monthly_budgets', 'loans']).optional(),
      batchId: z.string().optional(),
      includeReverted: z.boolean().optional(),
    }),
    method: 'GET',
    path: (a) => `/api/v1/audit${qs({
      limit: a.limit,
      entity: a.entity,
      batchId: a.batchId,
      includeReverted: a.includeReverted,
    })}`,
  },
  {
    name: 'undo_changes',
    description:
      'Roll back every change a single batch made, restoring the prior state of each row it touched. Get the batchId from list_recent_changes. Covers transactions, budget assignments and loans. The rollback is itself recorded, so history stays complete.',
    schema: z.object({ batchId: z.string().min(1) }),
    method: 'POST',
    path: () => '/api/v1/audit/undo',
    body: (a) => a,
  },
];
