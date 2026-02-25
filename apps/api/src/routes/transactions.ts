import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  type DB,
  accounts,
  transactions,
  payees,
  formatMoney,
} from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
  payeeName: z.string().optional(),
  categoryId: z.string().optional(),
  transferAccountId: z.string().optional(),
  memo: z.string().optional(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
});

const updateTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountCents: z.number().int().optional(),
  payeeName: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
});

function resolvePayee(db: DB, payeeName: string | undefined, categoryId: string | undefined | null) {
  if (!payeeName) return { payeeId: null, payeeName: null };

  const existing = db.select().from(payees).where(eq(payees.name, payeeName)).get();

  if (existing) {
    if (categoryId) {
      db.update(payees).set({ lastCategoryId: categoryId }).where(eq(payees.id, existing.id)).run();
    }
    return { payeeId: existing.id, payeeName };
  }

  const created = db
    .insert(payees)
    .values({
      name: payeeName,
      lastCategoryId: categoryId ?? null,
    })
    .returning()
    .get();

  return { payeeId: created.id, payeeName };
}

function formatTx(tx: any) {
  return {
    ...tx,
    amountFormatted: formatMoney(tx.amountCents),
  };
}

export function transactionRoutes(db: DB) {
  const router = new Hono();

  // GET / — list with filters
  router.get('/', (c) => {
    const accountId = c.req.query('accountId');
    const categoryId = c.req.query('categoryId');
    const since = c.req.query('since');
    const until = c.req.query('until');
    const limit = parseInt(c.req.query('limit') ?? '50');

    const conditions = [eq(transactions.isDeleted, false)];
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (categoryId) conditions.push(eq(transactions.categoryId, categoryId));
    if (since) conditions.push(gte(transactions.date, since));
    if (until) conditions.push(lte(transactions.date, until));

    const rows = db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date))
      .limit(limit)
      .all();

    return c.json(rows.map(formatTx));
  });

  // POST / — create transaction or transfer
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;

    // Validate source account
    const sourceAcct = db.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
    if (!sourceAcct) throw notFound('Account', data.accountId);

    // Transfer flow
    if (data.transferAccountId) {
      const targetAcct = db.select().from(accounts).where(eq(accounts.id, data.transferAccountId)).get();
      if (!targetAcct) throw notFound('Account', data.transferAccountId);

      const tx1Id = createId();
      const tx2Id = createId();
      const now = new Date().toISOString();

      db.insert(transactions)
        .values({
          id: tx1Id,
          accountId: data.accountId,
          date: data.date,
          amountCents: data.amountCents,
          payeeName: `Transfer: ${targetAcct.name}`,
          categoryId: null,
          transferAccountId: data.transferAccountId,
          transferTransactionId: tx2Id,
          memo: data.memo ?? null,
          cleared: data.cleared ?? 'uncleared',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(transactions)
        .values({
          id: tx2Id,
          accountId: data.transferAccountId,
          date: data.date,
          amountCents: -data.amountCents,
          payeeName: `Transfer: ${sourceAcct.name}`,
          categoryId: null,
          transferAccountId: data.accountId,
          transferTransactionId: tx1Id,
          memo: data.memo ?? null,
          cleared: data.cleared ?? 'uncleared',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const tx1 = db.select().from(transactions).where(eq(transactions.id, tx1Id)).get()!;
      const tx2 = db.select().from(transactions).where(eq(transactions.id, tx2Id)).get()!;

      return c.json([formatTx(tx1), formatTx(tx2)], 201);
    }

    // Regular transaction
    const { payeeId, payeeName } = resolvePayee(db, data.payeeName, data.categoryId);

    const created = db
      .insert(transactions)
      .values({
        accountId: data.accountId,
        date: data.date,
        amountCents: data.amountCents,
        payeeId,
        payeeName,
        categoryId: data.categoryId ?? null,
        memo: data.memo ?? null,
        cleared: data.cleared ?? 'uncleared',
      })
      .returning()
      .get();

    return c.json(formatTx(created), 201);
  });

  // GET /:id — single transaction
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    return c.json(formatTx(tx));
  });

  // PATCH /:id — update transaction
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    const body = await c.req.json();
    const parsed = updateTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const now = new Date().toISOString();

    // Handle payee update
    let payeeUpdate: { payeeId?: string | null; payeeName?: string | null } = {};
    if (data.payeeName !== undefined) {
      const resolved = resolvePayee(db, data.payeeName, data.categoryId ?? tx.categoryId);
      payeeUpdate = resolved;
    }

    const updateFields = {
      ...data,
      ...payeeUpdate,
      updatedAt: now,
    };

    db.update(transactions).set(updateFields).where(eq(transactions.id, id)).run();

    // Sync paired transfer if applicable
    if (tx.transferTransactionId) {
      const pairedUpdate: Record<string, any> = { updatedAt: now };
      if (data.date !== undefined) pairedUpdate.date = data.date;
      if (data.amountCents !== undefined) pairedUpdate.amountCents = -data.amountCents;

      if (Object.keys(pairedUpdate).length > 1) {
        db.update(transactions)
          .set(pairedUpdate)
          .where(eq(transactions.id, tx.transferTransactionId))
          .run();
      }
    }

    const updated = db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    return c.json(formatTx(updated));
  });

  // DELETE /:id — soft delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    const now = new Date().toISOString();

    db.update(transactions)
      .set({ isDeleted: true, updatedAt: now })
      .where(eq(transactions.id, id))
      .run();

    // Also soft-delete paired transfer
    if (tx.transferTransactionId) {
      db.update(transactions)
        .set({ isDeleted: true, updatedAt: now })
        .where(eq(transactions.id, tx.transferTransactionId))
        .run();
    }

    return c.json({ success: true });
  });

  return router;
}
