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
];
