import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  personalDebts,
  formatMoney,
  sumCents,
} from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createDebtSchema = z.object({
  personName: z.string().min(1),
  direction: z.enum(['owe', 'owed']),
  amountCents: z.number().int().positive(),
  currency: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().optional(),
});

const updateDebtSchema = z.object({
  personName: z.string().min(1).optional(),
  amountCents: z.number().int().positive().optional(),
  currency: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().nullable().optional(),
});

function formatDebt(debt: typeof personalDebts.$inferSelect) {
  return {
    id: debt.id,
    personName: debt.personName,
    direction: debt.direction,
    amountCents: debt.amountCents,
    amountFormatted: formatMoney(debt.amountCents, debt.currency),
    currency: debt.currency,
    dueDate: debt.dueDate,
    note: debt.note,
    isSettled: debt.isSettled,
    settledDate: debt.settledDate,
  };
}

export function debtListRoutes(db: DB) {
  const router = new Hono();

  // GET / — list debts with summary
  router.get('/', (c) => {
    const includeSettled = c.req.query('includeSettled') === 'true';

    let allDebts;
    if (includeSettled) {
      allDebts = db.select().from(personalDebts).all();
    } else {
      allDebts = db.select().from(personalDebts).where(eq(personalDebts.isSettled, false)).all();
    }

    const debts = allDebts.map(formatDebt);

    // Compute summary from unsettled only
    const unsettled = allDebts.filter((d) => !d.isSettled);
    const oweAmounts = unsettled.filter((d) => d.direction === 'owe').map((d) => d.amountCents);
    const owedAmounts = unsettled.filter((d) => d.direction === 'owed').map((d) => d.amountCents);
    const totalOweCents = sumCents(oweAmounts);
    const totalOwedCents = sumCents(owedAmounts);
    const netCents = totalOwedCents - totalOweCents;

    return c.json({
      debts,
      summary: {
        totalOweCents,
        totalOweFormatted: formatMoney(totalOweCents),
        totalOwedCents,
        totalOwedFormatted: formatMoney(totalOwedCents),
        netCents,
        netFormatted: formatMoney(netCents),
      },
    });
  });

  // POST / — create debt
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createDebtSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const created = db
      .insert(personalDebts)
      .values({
        personName: data.personName,
        direction: data.direction,
        amountCents: data.amountCents,
        currency: data.currency ?? 'KZT',
        dueDate: data.dueDate ?? null,
        note: data.note ?? null,
      })
      .returning()
      .get();

    return c.json(formatDebt(created), 201);
  });

  // GET /:id — single debt
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const debt = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get();
    if (!debt) throw notFound('Debt', id);
    return c.json(formatDebt(debt));
  });

  // PATCH /:id — update debt
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const debt = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get();
    if (!debt) throw notFound('Debt', id);

    const body = await c.req.json();
    const parsed = updateDebtSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(personalDebts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(personalDebts.id, id))
      .run();

    const updated = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get()!;
    return c.json(formatDebt(updated));
  });

  // POST /:id/settle — mark as settled
  router.post('/:id/settle', (c) => {
    const id = c.req.param('id');
    const debt = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get();
    if (!debt) throw notFound('Debt', id);

    if (debt.isSettled) {
      throw validationError('Debt is already settled');
    }

    db.update(personalDebts)
      .set({
        isSettled: true,
        settledDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
      })
      .where(eq(personalDebts.id, id))
      .run();

    const updated = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get()!;
    return c.json(formatDebt(updated));
  });

  // DELETE /:id — hard delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const debt = db.select().from(personalDebts).where(eq(personalDebts.id, id)).get();
    if (!debt) throw notFound('Debt', id);

    db.delete(personalDebts).where(eq(personalDebts.id, id)).run();
    return c.json({ success: true });
  });

  return router;
}
