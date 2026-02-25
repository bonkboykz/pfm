import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { type DB, accounts, scheduledTransactions } from '@pfm/engine';
import { getUpcoming, processDue } from '@pfm/engine';
import { formatMoney } from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createScheduledSchema = z.object({
  accountId: z.string().min(1),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
  payeeName: z.string().optional(),
  categoryId: z.string().optional(),
  transferAccountId: z.string().optional(),
  memo: z.string().optional(),
});

const updateScheduledSchema = z.object({
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']).optional(),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountCents: z.number().int().optional(),
  payeeName: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  transferAccountId: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
});

const processSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function scheduledRoutes(db: DB) {
  const router = new Hono();

  // GET / — list active scheduled transactions
  router.get('/', (c) => {
    const upcoming = c.req.query('upcoming');

    if (upcoming) {
      const days = parseInt(upcoming);
      if (isNaN(days) || days < 0) {
        throw validationError('upcoming must be a non-negative integer');
      }
      const rows = getUpcoming(db, days);
      return c.json({ scheduled: rows });
    }

    // Return all active
    const rows = getUpcoming(db, 36500); // ~100 years = all
    return c.json({ scheduled: rows });
  });

  // POST /process — must be before /:id to avoid route conflict
  router.post('/process', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body is fine
    }

    const parsed = processSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const result = processDue(db, parsed.data.asOfDate);
    return c.json(result);
  });

  // POST / — create scheduled transaction
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createScheduledSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;

    // Validate account exists
    const acct = db.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
    if (!acct) throw notFound('Account', data.accountId);

    if (data.transferAccountId) {
      const targetAcct = db.select().from(accounts).where(eq(accounts.id, data.transferAccountId)).get();
      if (!targetAcct) throw notFound('Account', data.transferAccountId);
    }

    const created = db
      .insert(scheduledTransactions)
      .values({
        accountId: data.accountId,
        frequency: data.frequency,
        nextDate: data.nextDate,
        amountCents: data.amountCents,
        payeeName: data.payeeName ?? null,
        categoryId: data.categoryId ?? null,
        transferAccountId: data.transferAccountId ?? null,
        memo: data.memo ?? null,
      })
      .returning()
      .get();

    return c.json({
      ...created,
      amountFormatted: formatMoney(created.amountCents),
    }, 201);
  });

  // PATCH /:id — update scheduled transaction
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db
      .select()
      .from(scheduledTransactions)
      .where(eq(scheduledTransactions.id, id))
      .get();
    if (!existing || !existing.isActive) throw notFound('ScheduledTransaction', id);

    const body = await c.req.json();
    const parsed = updateScheduledSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(scheduledTransactions)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(scheduledTransactions.id, id))
      .run();

    const updated = db
      .select()
      .from(scheduledTransactions)
      .where(eq(scheduledTransactions.id, id))
      .get()!;

    return c.json({
      ...updated,
      amountFormatted: formatMoney(updated.amountCents),
    });
  });

  // DELETE /:id — soft deactivate
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const existing = db
      .select()
      .from(scheduledTransactions)
      .where(eq(scheduledTransactions.id, id))
      .get();
    if (!existing || !existing.isActive) throw notFound('ScheduledTransaction', id);

    db.update(scheduledTransactions)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(scheduledTransactions.id, id))
      .run();

    return c.json({ success: true });
  });

  return router;
}
