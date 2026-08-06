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
];
