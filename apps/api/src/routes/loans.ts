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
  // A bank statement shows what is left, not what was borrowed. Supplying
  // currentBalanceCents lets the caller quote the statement directly instead of
  // inventing a principal and a paid-off figure that reconstruct it.
  principalCents: z.number().int().positive().optional(),
  currentBalanceCents: z.number().int().min(0).optional(),
  aprBps: z.number().int().min(0).optional(),
  termMonths: z.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyPaymentCents: z.number().int().positive(),
  paymentDay: z.number().int().min(1).max(28),
  penaltyRateBps: z.number().int().min(0).optional(),
  earlyRepaymentFeeCents: z.number().int().min(0).optional(),
  paidOffCents: z.number().int().min(0).optional(),
  note: z.string().optional(),
}).refine(
  (d) => d.principalCents !== undefined || d.currentBalanceCents !== undefined,
  { message: 'Provide either principalCents or currentBalanceCents' },
);

const updateLoanSchema = z.object({
  name: z.string().min(1).optional(),
  // Условия кредита тоже меняются: банк пересматривает ставку, срок
  // продлевают, а при вводе ошибаются. Без этих полей опечатка в ставке
  // лечилась удалением кредита — вместе с привязанной историей платежей.
  type: z.enum(['loan', 'installment', 'credit_line']).optional(),
  principalCents: z.number().int().positive().optional(),
  aprBps: z.number().int().min(0).optional(),
  termMonths: z.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  monthlyPaymentCents: z.number().int().positive().optional(),
  paymentDay: z.number().int().min(1).max(28).optional(),
  penaltyRateBps: z.number().int().min(0).optional(),
  earlyRepaymentFeeCents: z.number().int().min(0).optional(),
  paidOffCents: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

const closeLoanSchema = z.object({
  closedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().optional(),
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
    closedDate: loan.closedDate,
    closureReason: loan.closureReason,
    currentDebtCents,
    currentDebtFormatted: formatMoney(currentDebtCents),
  };
}

export function loanRoutes(db: DB) {
  const router = new Hono();

  // GET / — list loans (?includeInactive=true also returns closed ones)
  router.get('/', (c) => {
    const includeInactive = c.req.query('includeInactive') === 'true';

    const allLoans = includeInactive
      ? db.select().from(loans).all()
      : db.select().from(loans).where(eq(loans.isActive, true)).all();

    const result = allLoans.map((loan) => {
      const currentDebtCents = getLoanCurrentDebt(db, loan.id);
      return formatLoan(loan, currentDebtCents);
    });

    const activeDebt = result
      .filter((l) => l.isActive)
      .reduce((sum, l) => sum + l.currentDebtCents, 0);

    return c.json(
      c.req.query('withTotals') === 'true'
        ? {
            loans: result,
            activeCount: result.filter((l) => l.isActive).length,
            totalActiveDebtCents: activeDebt,
            totalActiveDebtFormatted: formatMoney(activeDebt),
          }
        : result,
    );
  });

  // POST / — create loan
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;

    // currentBalanceCents is stored as principal-minus-paid-off, the pair the
    // rest of the engine works in. Quoting only the balance means nothing is
    // yet repaid against it.
    const principalCents = data.principalCents ?? data.currentBalanceCents!;
    const paidOffCents = data.principalCents !== undefined
      ? (data.paidOffCents ?? 0)
      : 0;

    if (paidOffCents > principalCents) {
      throw validationError(
        `paidOffCents (${paidOffCents}) cannot exceed principalCents (${principalCents})`,
      );
    }

    const created = db
      .insert(loans)
      .values({
        name: data.name,
        type: data.type,
        accountId: data.accountId ?? null,
        categoryId: data.categoryId ?? null,
        principalCents,
        aprBps: data.aprBps ?? 0,
        termMonths: data.termMonths,
        startDate: data.startDate,
        monthlyPaymentCents: data.monthlyPaymentCents,
        paymentDay: data.paymentDay,
        penaltyRateBps: data.penaltyRateBps ?? 0,
        earlyRepaymentFeeCents: data.earlyRepaymentFeeCents ?? 0,
        paidOffCents,
        note: data.note ?? null,
      })
      .returning()
      .get();

    const currentDebtCents = getLoanCurrentDebt(db, created.id);
    return c.json(formatLoan(created, currentDebtCents), 201);
  });

  // GET /:id — single loan. A closed loan is still readable; isActive says so.
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) throw notFound('Loan', id);

    const currentDebtCents = getLoanCurrentDebt(db, loan.id);
    return c.json(formatLoan(loan, currentDebtCents));
  });

  // POST /:id/close — settle a loan, keeping it on the books
  router.post('/:id/close', async (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) throw notFound('Loan', id);

    let body: Record<string, unknown> = {};
    try {
      body = await c.req.json();
    } catch {
      // Closing with no explanation is allowed.
    }

    const parsed = closeLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    // Marking it paid off is what takes it out of the debt totals; isActive
    // alone would leave the balance in every aggregate that ignores the flag.
    db.update(loans)
      .set({
        isActive: false,
        paidOffCents: loan.principalCents,
        closedDate: parsed.data.closedDate ?? new Date().toISOString().slice(0, 10),
        closureReason: parsed.data.reason ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(loans.id, id))
      .run();

    const updated = db.select().from(loans).where(eq(loans.id, id)).get()!;
    return c.json(formatLoan(updated, getLoanCurrentDebt(db, updated.id)));
  });

  // PATCH /:id — update loan, including reactivating a closed one
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const loan = db.select().from(loans).where(eq(loans.id, id)).get();
    if (!loan) throw notFound('Loan', id);

    const body = await c.req.json();
    const parsed = updateLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    // Тело и погашенное проверяются друг против друга в обе стороны: менять
    // можно любое из них, но кредит, погашенный больше чем на всю сумму,
    // сломал бы и график, и долговые итоги.
    const principal = data.principalCents ?? loan.principalCents;
    const paidOff = data.paidOffCents ?? loan.paidOffCents;
    if (paidOff > principal) {
      throw validationError(
        `paidOffCents (${paidOff}) cannot exceed principalCents (${principal})`,
      );
    }

    db.update(loans)
      .set({
        ...data,
        // Reopening a loan clears the closure record rather than leaving a
        // stale closedDate on an active loan.
        ...(data.isActive === true ? { closedDate: null, closureReason: null } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(loans.id, id))
      .run();

    const updated = db.select().from(loans).where(eq(loans.id, id)).get()!;
    const currentDebtCents = getLoanCurrentDebt(db, updated.id);
    return c.json(formatLoan(updated, currentDebtCents));
  });

  // DELETE /:id — deactivate. Prefer POST /:id/close, which also settles the
  // balance; this leaves currentDebt intact for a loan that was entered wrongly.
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
    if (!loan) throw notFound('Loan', id);

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
