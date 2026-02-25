import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import {
  simulatePayoff,
  compareStrategies,
  debtVsInvest,
  formatMoney,
} from '@pfm/engine';
import { validationError } from '../errors.js';

const debtSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.enum(['credit_card', 'loan', 'installment']),
  balanceCents: z.number().int().positive(),
  aprBps: z.number().int().min(0),
  minPaymentCents: z.number().int().positive(),
  remainingInstallments: z.number().int().positive().optional(),
  latePenaltyCents: z.number().int().min(0).optional(),
});

const payoffRequestSchema = z.object({
  debts: z.array(debtSchema).min(1).max(20),
  strategy: z.enum(['snowball', 'avalanche', 'highest_monthly_interest', 'cash_flow_index']),
  extraMonthlyCents: z.number().int().min(0).default(0),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const compareRequestSchema = z.object({
  debts: z.array(debtSchema).min(1).max(20),
  extraMonthlyCents: z.number().int().min(0).default(0),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const debtVsInvestRequestSchema = z.object({
  extraMonthlyCents: z.number().int().min(0),
  debt: debtSchema,
  expectedReturnBps: z.number().int().min(0),
  horizonMonths: z.number().int().positive().max(600),
});

function normalizeDebts(debts: z.infer<typeof debtSchema>[]) {
  return debts.map((d) => ({
    ...d,
    id: d.id ?? createId(),
  }));
}

function formatSimulationResult(result: ReturnType<typeof simulatePayoff>) {
  return {
    ...result,
    totalPaidFormatted: formatMoney(result.totalPaidCents),
    totalInterestFormatted: formatMoney(result.totalInterestCents),
    totalPenaltiesFormatted: formatMoney(result.totalPenaltiesCents),
    schedule: result.schedule.map((snap) => ({
      ...snap,
      totalPaidFormatted: formatMoney(snap.totalPaidCents),
      totalRemainingFormatted: formatMoney(snap.totalRemainingCents),
      debtStates: snap.debtStates.map((ds) => ({
        ...ds,
        startBalanceFormatted: formatMoney(ds.startBalanceCents),
        interestFormatted: formatMoney(ds.interestCents),
        paymentFormatted: formatMoney(ds.paymentCents),
        endBalanceFormatted: formatMoney(ds.endBalanceCents),
      })),
    })),
  };
}

export function debtRoutes() {
  const router = new Hono();

  // POST /payoff
  router.post('/payoff', async (c) => {
    const body = await c.req.json();
    const parsed = payoffRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const debts = normalizeDebts(parsed.data.debts);
    const result = simulatePayoff(debts, parsed.data.strategy, parsed.data.extraMonthlyCents, parsed.data.startDate);

    return c.json(formatSimulationResult(result));
  });

  // POST /compare
  router.post('/compare', async (c) => {
    const body = await c.req.json();
    const parsed = compareRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const debts = normalizeDebts(parsed.data.debts);
    const result = compareStrategies(debts, parsed.data.extraMonthlyCents, parsed.data.startDate);

    return c.json({
      strategies: result.strategies.map(formatSimulationResult),
      recommended: result.recommended,
      savingsVsWorstCents: result.savingsVsWorstCents,
      savingsVsWorstFormatted: formatMoney(result.savingsVsWorstCents),
    });
  });

  // POST /debt-vs-invest
  router.post('/debt-vs-invest', async (c) => {
    const body = await c.req.json();
    const parsed = debtVsInvestRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const debt = { ...parsed.data.debt, id: parsed.data.debt.id ?? createId() };
    const result = debtVsInvest(
      parsed.data.extraMonthlyCents,
      debt,
      parsed.data.expectedReturnBps,
      parsed.data.horizonMonths,
    );

    return c.json({
      debtFirstNetWorthCents: result.debtFirstNetWorthCents,
      debtFirstFormatted: formatMoney(result.debtFirstNetWorthCents),
      investFirstNetWorthCents: result.investFirstNetWorthCents,
      investFirstFormatted: formatMoney(result.investFirstNetWorthCents),
      recommendation: result.recommendation,
      breakEvenReturnBps: result.breakEvenReturnBps,
      explanation: result.explanation,
    });
  });

  return router;
}
