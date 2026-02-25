import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  deposits,
  formatMoney,
  getDepositCurrentBalance,
  getDepositSummary,
  generateInterestSchedule,
  getKdifExposure,
} from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createDepositSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().min(1),
  type: z.enum(['term', 'savings', 'demand']),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  initialAmountCents: z.number().int().positive(),
  currency: z.string().default('KZT'),
  annualRateBps: z.number().int().min(0),
  earlyWithdrawalRateBps: z.number().int().min(0).optional(),
  termMonths: z.number().int().min(0),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  capitalization: z.enum(['monthly', 'quarterly', 'at_end', 'none']).optional(),
  isWithdrawable: z.boolean().optional(),
  isReplenishable: z.boolean().optional(),
  minBalanceCents: z.number().int().min(0).optional(),
  topUpCents: z.number().int().min(0).optional(),
  note: z.string().optional(),
});

const updateDepositSchema = z.object({
  name: z.string().min(1).optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  topUpCents: z.number().int().min(0).optional(),
  note: z.string().nullable().optional(),
});

function formatDeposit(
  deposit: typeof deposits.$inferSelect,
  currentBalanceCents: number,
  projectedInterestCents: number,
) {
  return {
    id: deposit.id,
    name: deposit.name,
    bankName: deposit.bankName,
    type: deposit.type,
    accountId: deposit.accountId,
    categoryId: deposit.categoryId,
    initialAmountCents: deposit.initialAmountCents,
    initialAmountFormatted: formatMoney(deposit.initialAmountCents),
    currency: deposit.currency,
    annualRateBps: deposit.annualRateBps,
    earlyWithdrawalRateBps: deposit.earlyWithdrawalRateBps,
    termMonths: deposit.termMonths,
    startDate: deposit.startDate,
    endDate: deposit.endDate,
    capitalization: deposit.capitalization,
    isWithdrawable: deposit.isWithdrawable,
    isReplenishable: deposit.isReplenishable,
    minBalanceCents: deposit.minBalanceCents,
    minBalanceFormatted: formatMoney(deposit.minBalanceCents),
    topUpCents: deposit.topUpCents,
    topUpFormatted: formatMoney(deposit.topUpCents),
    note: deposit.note,
    isActive: deposit.isActive,
    currentBalanceCents,
    currentBalanceFormatted: formatMoney(currentBalanceCents),
    projectedInterestCents,
    projectedInterestFormatted: formatMoney(projectedInterestCents),
  };
}

export function depositRoutes(db: DB) {
  const router = new Hono();

  // GET / — list active deposits
  router.get('/', (c) => {
    const allDeposits = db.select().from(deposits).where(eq(deposits.isActive, true)).all();
    const result = allDeposits.map((dep) => {
      const summary = getDepositSummary(db, dep.id);
      return formatDeposit(
        dep,
        summary?.currentBalanceCents ?? 0,
        summary?.projectedInterestCents ?? 0,
      );
    });
    return c.json(result);
  });

  // POST / — create deposit
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createDepositSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const created = db
      .insert(deposits)
      .values({
        name: data.name,
        bankName: data.bankName,
        type: data.type,
        accountId: data.accountId ?? null,
        categoryId: data.categoryId ?? null,
        initialAmountCents: data.initialAmountCents,
        currency: data.currency,
        annualRateBps: data.annualRateBps,
        earlyWithdrawalRateBps: data.earlyWithdrawalRateBps ?? 0,
        termMonths: data.termMonths,
        startDate: data.startDate,
        endDate: data.endDate ?? null,
        capitalization: data.capitalization ?? 'monthly',
        isWithdrawable: data.isWithdrawable ?? false,
        isReplenishable: data.isReplenishable ?? false,
        minBalanceCents: data.minBalanceCents ?? 0,
        topUpCents: data.topUpCents ?? 0,
        note: data.note ?? null,
      })
      .returning()
      .get();

    const summary = getDepositSummary(db, created.id);
    return c.json(
      formatDeposit(
        created,
        summary?.currentBalanceCents ?? 0,
        summary?.projectedInterestCents ?? 0,
      ),
      201,
    );
  });

  // GET /kdif — KDIF exposure report
  router.get('/kdif', (c) => {
    const exposures = getKdifExposure(db);
    return c.json(
      exposures.map((e) => ({
        ...e,
        totalDepositsFormatted: formatMoney(e.totalDepositsCents),
        guaranteeLimitFormatted: formatMoney(e.guaranteeLimitCents),
        excessFormatted: formatMoney(e.excessCents),
      })),
    );
  });

  // GET /:id — deposit details
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const deposit = db.select().from(deposits).where(eq(deposits.id, id)).get();
    if (!deposit || !deposit.isActive) throw notFound('Deposit', id);

    const summary = getDepositSummary(db, deposit.id);
    return c.json(
      formatDeposit(
        deposit,
        summary?.currentBalanceCents ?? 0,
        summary?.projectedInterestCents ?? 0,
      ),
    );
  });

  // PATCH /:id — update deposit
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const deposit = db.select().from(deposits).where(eq(deposits.id, id)).get();
    if (!deposit || !deposit.isActive) throw notFound('Deposit', id);

    const body = await c.req.json();
    const parsed = updateDepositSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(deposits)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(deposits.id, id))
      .run();

    const updated = db.select().from(deposits).where(eq(deposits.id, id)).get()!;
    const summary = getDepositSummary(db, updated.id);
    return c.json(
      formatDeposit(
        updated,
        summary?.currentBalanceCents ?? 0,
        summary?.projectedInterestCents ?? 0,
      ),
    );
  });

  // DELETE /:id — soft delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const deposit = db.select().from(deposits).where(eq(deposits.id, id)).get();
    if (!deposit || !deposit.isActive) throw notFound('Deposit', id);

    db.update(deposits)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(deposits.id, id))
      .run();

    return c.json({ success: true });
  });

  // GET /:id/schedule — interest schedule
  router.get('/:id/schedule', (c) => {
    const id = c.req.param('id');
    const deposit = db.select().from(deposits).where(eq(deposits.id, id)).get();
    if (!deposit || !deposit.isActive) throw notFound('Deposit', id);

    const monthsParam = c.req.query('months');
    const months = monthsParam ? parseInt(monthsParam, 10) : undefined;

    const schedule = generateInterestSchedule(db, id, months);
    const formatted = schedule.map((entry) => ({
      ...entry,
      startBalanceFormatted: formatMoney(entry.startBalanceCents),
      interestFormatted: formatMoney(entry.interestCents),
      capitalizedFormatted: formatMoney(entry.capitalizedCents),
      endBalanceFormatted: formatMoney(entry.endBalanceCents),
      cumulativeInterestFormatted: formatMoney(entry.cumulativeInterestCents),
    }));

    return c.json({
      depositId: id,
      depositName: deposit.name,
      schedule: formatted,
    });
  });

  return router;
}
