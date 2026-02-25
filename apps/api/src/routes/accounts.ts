import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  accounts,
  getAccountBalances,
  formatMoney,
} from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking']),
  onBudget: z.boolean().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  bankName: z.string().optional(),
  last4Digits: z.string().length(4).regex(/^\d{4}$/).optional(),
  cardType: z.enum(['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other']).optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  onBudget: z.boolean().optional(),
  currency: z.string().optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  last4Digits: z.string().length(4).regex(/^\d{4}$/).nullable().optional(),
  cardType: z.enum(['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other']).nullable().optional(),
});

function formatAccountBalance(ab: { accountId: string; accountName: string; type: string; balanceCents: number; clearedCents: number; unclearedCents: number }, currency = 'KZT') {
  return {
    ...ab,
    balanceFormatted: formatMoney(ab.balanceCents, currency),
    clearedFormatted: formatMoney(ab.clearedCents, currency),
    unclearedFormatted: formatMoney(ab.unclearedCents, currency),
  };
}

export function accountRoutes(db: DB) {
  const router = new Hono();

  // GET / — list all accounts with balances
  router.get('/', (c) => {
    const balances = getAccountBalances(db);
    const accts = db.select().from(accounts).where(eq(accounts.isActive, true)).orderBy(accounts.sortOrder).all();

    const result = accts.map((acct) => {
      const bal = balances.find((b) => b.accountId === acct.id);
      return {
        id: acct.id,
        name: acct.name,
        type: acct.type,
        onBudget: acct.onBudget,
        currency: acct.currency,
        sortOrder: acct.sortOrder,
        balanceCents: bal?.balanceCents ?? 0,
        balanceFormatted: formatMoney(bal?.balanceCents ?? 0, acct.currency),
        clearedCents: bal?.clearedCents ?? 0,
        clearedFormatted: formatMoney(bal?.clearedCents ?? 0, acct.currency),
        unclearedCents: bal?.unclearedCents ?? 0,
        unclearedFormatted: formatMoney(bal?.unclearedCents ?? 0, acct.currency),
      };
    });

    return c.json(result);
  });

  // POST / — create account
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const onBudget = data.type === 'tracking' ? false : (data.onBudget ?? true);

    const created = db
      .insert(accounts)
      .values({
        name: data.name,
        type: data.type,
        onBudget,
        currency: data.currency ?? 'KZT',
        note: data.note ?? null,
        bankName: data.bankName ?? null,
        last4Digits: data.last4Digits ?? null,
        cardType: data.cardType ?? null,
      })
      .returning()
      .get();

    return c.json(created, 201);
  });

  // GET /:id — single account with balance
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct || !acct.isActive) throw notFound('Account', id);

    const balances = getAccountBalances(db);
    const bal = balances.find((b) => b.accountId === id);

    return c.json({
      id: acct.id,
      name: acct.name,
      type: acct.type,
      onBudget: acct.onBudget,
      currency: acct.currency,
      sortOrder: acct.sortOrder,
      balanceCents: bal?.balanceCents ?? 0,
      balanceFormatted: formatMoney(bal?.balanceCents ?? 0, acct.currency),
      clearedCents: bal?.clearedCents ?? 0,
      clearedFormatted: formatMoney(bal?.clearedCents ?? 0, acct.currency),
      unclearedCents: bal?.unclearedCents ?? 0,
      unclearedFormatted: formatMoney(bal?.unclearedCents ?? 0, acct.currency),
    });
  });

  // PATCH /:id — update account
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct || !acct.isActive) throw notFound('Account', id);

    const body = await c.req.json();
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(accounts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    const updated = db.select().from(accounts).where(eq(accounts.id, id)).get()!;
    return c.json(updated);
  });

  // DELETE /:id — soft delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct || !acct.isActive) throw notFound('Account', id);

    db.update(accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    return c.json({ success: true });
  });

  return router;
}
