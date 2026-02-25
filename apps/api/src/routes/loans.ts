import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  loans,
  formatMoney,
  getLoanCurrentDebt,
  generateAmortizationSchedule,
} from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createLoanSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['loan', 'installment', 'credit_line']),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  principalCents: z.number().int().positive(),
  aprBps: z.number().int().min(0).optional(),
  termMonths: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyPaymentCents: z.number().int().positive(),
  paymentDay: z.number().int().min(1).max(28),
  penaltyRateBps: z.number().int().min(0).optional(),
  earlyRepaymentFeeCents: z.number().int().min(0).optional(),
  paidOffCents: z.number().int().min(0).optional(),
  note: z.string().optional(),
});

const updateLoanSchema = z.object({
  name: z.string().min(1).optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  monthlyPaymentCents: z.number().int().positive().optional(),
  paymentDay: z.number().int().min(1).max(28).optional(),
  penaltyRateBps: z.number().int().min(0).optional(),
  earlyRepaymentFeeCents: z.number().int().min(0).optional(),
  paidOffCents: z.number().int().min(0).optional(),
  note: z.string().nullable().optional(),
});

function formatLoan(loan: typeof loans.$inferSelect, currentDebtCents: number) {
  return {
    id: loan.id,
    name: loan.name,
    type: loan.type,
    accountId: loan.accountId,
    categoryId: loan.categoryId,
    principalCents: loan.principalCents,
    principalFormatted: formatMoney(loan.principalCents),
    aprBps: loan.aprBps,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    monthlyPaymentCents: loan.monthlyPaymentCents,
    monthlyPaymentFormatted: formatMoney(loan.monthlyPaymentCents),
    paymentDay: loan.paymentDay,
    penaltyRateBps: loan.penaltyRateBps,
    earlyRepaymentFeeCents: loan.earlyRepaymentFeeCents,
    paidOffCents: loan.paidOffCents,
    paidOffFormatted: formatMoney(loan.paidOffCents),
    note: loan.note,
    isActive: loan.isActive,
    currentDebtCents,
    currentDebtFormatted: formatMoney(currentDebtCents),
  };
}

export function loanRoutes(db: DB) {
  const router = new Hono();

  // GET / — list all active loans
  router.get('/', (c) => {
    const allLoans = db.select().from(loans).where(eq(loans.isActive, true)).all();
    const result = allLoans.map((loan) => {
      const currentDebtCents = getLoanCurrentDebt(db, loan.id);
      return formatLoan(loan, currentDebtCents);
    });
    return c.json(result);
  });

  // POST / — create loan
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const created = db
      .insert(loans)
      .values({
        name: data.name,
        type: data.type,
        accountId: data.accountId ?? null,
        categoryId: data.categoryId ?? null,
        principalCents: data.principalCents,
        aprBps: data.aprBps ?? 0,
        termMonths: data.termMonths,
        startDate: data.startDate,
        monthlyPaymentCents: data.monthlyPaymentCents,
        paymentDay: data.paymentDay,
        penaltyRateBps: data.penaltyRateBps ?? 0,
        earlyRepaymentFeeCents: data.earlyRepaymentFeeCents ?? 0,
        paidOffCents: data.paidOffCents ?? 0,
        note: data.note ?? null,
      })
      .returning()
      .get();

    const currentDebtCents = getLoanCurrentDebt(db, created.id);
    return c.json(formatLoan(created, currentDebtCents), 201);
  });

  // GET /:id — single loan
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan || !loan.isActive) throw notFound('Loan', id);

    const currentDebtCents = getLoanCurrentDebt(db, loan.id);
    return c.json(formatLoan(loan, currentDebtCents));
  });

  // PATCH /:id — update loan
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan || !loan.isActive) throw notFound('Loan', id);

    const body = await c.req.json();
    const parsed = updateLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(loans)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(loans.id, id))
      .run();

    const updated = db.select().from(loans).where(eq(loans.id, id)).get()!;
    const currentDebtCents = getLoanCurrentDebt(db, updated.id);
    return c.json(formatLoan(updated, currentDebtCents));
  });

  // DELETE /:id — soft delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan || !loan.isActive) throw notFound('Loan', id);

    db.update(loans)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(loans.id, id))
      .run();

    return c.json({ success: true });
  });

  // GET /:id/schedule — amortization schedule
  router.get('/:id/schedule', (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan || !loan.isActive) throw notFound('Loan', id);

    const schedule = generateAmortizationSchedule(db, id);
    const formatted = schedule.map((entry) => ({
      ...entry,
      startBalanceFormatted: formatMoney(entry.startBalanceCents),
      principalFormatted: formatMoney(entry.principalCents),
      interestFormatted: formatMoney(entry.interestCents),
      paymentFormatted: formatMoney(entry.paymentCents),
      endBalanceFormatted: formatMoney(entry.endBalanceCents),
    }));

    return c.json({
      loanId: id,
      loanName: loan.name,
      schedule: formatted,
    });
  });

  return router;
}
