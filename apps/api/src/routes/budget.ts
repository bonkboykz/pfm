import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  categories,
  getBudgetMonth,
  assignToCategory,
  assignToTargets,
  copyMonthAssignments,
  moveBetweenCategories,
  setCategoryAvailable,
  resetBudgetFrom,
  getReadyToAssignRange,
  getReadyToAssign,
  getRtaReconciliation,
  getBudgetForecast,
  formatMoney,
} from '@pfm/engine';
import { validationError, unknownReference } from '../errors.js';

const monthRegex = /^\d{4}-\d{2}$/;

const assignSchema = z.object({
  categoryId: z.string().min(1),
  amountCents: z.number().int().min(0),
});

const moveSchema = z.object({
  fromCategoryId: z.string().min(1),
  toCategoryId: z.string().min(1),
  amountCents: z.number().int().positive(),
});

const setAvailableSchema = z.object({
  categoryId: z.string().min(1),
  amountCents: z.number().int(),
});

const bulkAssignSchema = z.object({
  assignments: z.array(z.object({
    categoryId: z.string().min(1),
    amountCents: z.number().int().min(0),
  })).min(1).max(500),
});

const resetSchema = z.object({
  fromMonth: z.string().regex(monthRegex),
  confirm: z.literal(true),
});

/**
 * `allowNegativeRta` — сознательный перерасход бюджета. По умолчанию раздача
 * останавливается на нуле Ready to Assign, как в YNAB.
 */
const assignTargetsSchema = z.object({
  allowNegativeRta: z.boolean().optional(),
});

const copyMonthSchema = z.object({
  fromMonth: z.string().regex(monthRegex),
});

/**
 * Rejects a category id the caller only believes in.
 *
 * Assignment used to accept any string and report success against a budget the
 * category was not in, so a mistyped or stale id looked like it had worked.
 */
function requireCategory(db: DB, categoryId: string) {
  const cat = db.select({ id: categories.id, isSystem: categories.isSystem, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (!cat) throw unknownReference('categoryId', categoryId, 'GET /api/v1/categories');
  if (cat.isSystem) {
    throw validationError(`Category '${cat.name}' is a system category and cannot be budgeted directly`);
  }
  return cat;
}

function formatCategory(cb: ReturnType<typeof getBudgetMonth>['categoryBudgets'][number]) {
  return {
    categoryId: cb.categoryId,
    categoryName: cb.categoryName,
    assignedCents: cb.assignedCents,
    assignedFormatted: formatMoney(cb.assignedCents),
    activityCents: cb.activityCents,
    activityFormatted: formatMoney(cb.activityCents),
    availableCents: cb.availableCents,
    availableFormatted: formatMoney(cb.availableCents),
    targetAmountCents: cb.targetAmountCents,
    targetType: cb.targetType,
    targetDate: cb.targetDate,
    underfundedCents: cb.underfundedCents,
    underfundedFormatted: formatMoney(cb.underfundedCents),
    isUnderfunded: cb.isUnderfunded,
    isOverspent: cb.isOverspent,
  };
}

/**
 * The reply a mutation owes its caller: what changed, and what is left to
 * assign. The full month is 22 categories of unchanged rows — nine assignments
 * in a row returned nine near-identical copies of it.
 */
function formatMinimalResponse(
  budget: ReturnType<typeof getBudgetMonth>,
  touchedIds: string[],
) {
  const touched = new Set(touchedIds);
  return {
    month: budget.month,
    readyToAssignCents: budget.readyToAssignCents,
    readyToAssignFormatted: formatMoney(budget.readyToAssignCents),
    totalAssignedCents: budget.totalAssignedCents,
    totalAssignedFormatted: formatMoney(budget.totalAssignedCents),
    categories: budget.categoryBudgets
      .filter((cb) => touched.has(cb.categoryId))
      .map(formatCategory),
  };
}

/** `?response=minimal` on any budget mutation. Full month stays the default. */
function wantsMinimal(c: { req: { query: (k: string) => string | undefined } }) {
  return c.req.query('response') === 'minimal';
}

function formatBudgetResponse(budget: ReturnType<typeof getBudgetMonth>) {
  // Group flat categoryBudgets by groupId
  const groupMap = new Map<string, {
    groupId: string;
    groupName: string;
    categories: any[];
  }>();

  for (const cb of budget.categoryBudgets) {
    if (!groupMap.has(cb.groupId)) {
      groupMap.set(cb.groupId, {
        groupId: cb.groupId,
        groupName: cb.groupName,
        categories: [],
      });
    }

    groupMap.get(cb.groupId)!.categories.push(formatCategory(cb));
  }

  return {
    month: budget.month,
    readyToAssignCents: budget.readyToAssignCents,
    readyToAssignFormatted: formatMoney(budget.readyToAssignCents),
    totalAssignedCents: budget.totalAssignedCents,
    totalAssignedFormatted: formatMoney(budget.totalAssignedCents),
    totalActivityCents: budget.totalActivityCents,
    totalActivityFormatted: formatMoney(budget.totalActivityCents),
    totalAvailableCents: budget.totalAvailableCents,
    totalAvailableFormatted: formatMoney(budget.totalAvailableCents),
    overspentCents: budget.overspentCents,
    overspentFormatted: formatMoney(budget.overspentCents),
    totalUnderfundedCents: budget.totalUnderfundedCents,
    totalUnderfundedFormatted: formatMoney(budget.totalUnderfundedCents),
    groups: Array.from(groupMap.values()),
  };
}

export function budgetRoutes(db: DB) {
  const router = new Hono();

  // GET /rta-overview — RTA across all assigned months
  router.get('/rta-overview', (c) => {
    const fromParam = c.req.query('from');
    const fromMonth = fromParam && monthRegex.test(fromParam)
      ? fromParam
      : new Date().toISOString().slice(0, 7);

    // Find furthest assigned month
    const maxRow = db.$client.prepare(
      `SELECT MAX(month) as maxMonth FROM monthly_budgets`
    ).get() as { maxMonth: string | null } | undefined;

    const furthestAssigned = maxRow?.maxMonth ?? fromMonth;
    const toMonth = furthestAssigned > fromMonth ? furthestAssigned : fromMonth;

    const result = getReadyToAssignRange(db, fromMonth, toMonth);

    return c.json({
      from: fromMonth,
      to: toMonth,
      months: result.months.map((m) => ({
        month: m.month,
        readyToAssignCents: m.readyToAssignCents,
        readyToAssignFormatted: formatMoney(m.readyToAssignCents),
      })),
      minReadyToAssignCents: result.minReadyToAssignCents,
      minReadyToAssignFormatted: formatMoney(result.minReadyToAssignCents),
      minMonth: result.minMonth,
    });
  });

  // GET /forecast — which category runs out, and when.
  // Registered before /:month so the literal segment is not swallowed by it.
  router.get('/forecast', (c) => {
    const daysParam = c.req.query('days');
    const days = daysParam === undefined ? 30 : parseInt(daysParam, 10);
    if (Number.isNaN(days) || days < 1 || days > 730) {
      throw validationError('days must be an integer between 1 and 730');
    }

    const asOf = c.req.query('asOf');
    if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw validationError('asOf must be YYYY-MM-DD');
    }

    const forecast = getBudgetForecast(db, days, asOf);
    const onlyShort = c.req.query('onlyShort') === 'true';

    return c.json({
      asOfDate: forecast.asOfDate,
      throughDate: forecast.throughDate,
      days: forecast.days,
      totalShortfallCents: forecast.totalShortfallCents,
      totalShortfallFormatted: formatMoney(forecast.totalShortfallCents),
      firstShortDate: forecast.firstShortDate,
      months: forecast.months.map((m) => ({
        month: m.month,
        totalScheduledCents: m.totalScheduledCents,
        totalScheduledFormatted: formatMoney(m.totalScheduledCents),
        totalShortfallCents: m.totalShortfallCents,
        totalShortfallFormatted: formatMoney(m.totalShortfallCents),
        shortCategoryCount: m.shortCategoryCount,
        categories: m.categories
          .filter((cat) => !onlyShort || cat.shortfallCents > 0)
          .map((cat) => ({
            categoryId: cat.categoryId,
            categoryName: cat.categoryName,
            groupName: cat.groupName,
            availableCents: cat.availableCents,
            availableFormatted: formatMoney(cat.availableCents),
            scheduledNetCents: cat.scheduledNetCents,
            scheduledNetFormatted: formatMoney(cat.scheduledNetCents),
            projectedAvailableCents: cat.projectedAvailableCents,
            projectedAvailableFormatted: formatMoney(cat.projectedAvailableCents),
            shortfallCents: cat.shortfallCents,
            shortfallFormatted: formatMoney(cat.shortfallCents),
            firstShortDate: cat.firstShortDate,
            occurrences: cat.occurrences.map((o) => ({
              ...o,
              amountFormatted: formatMoney(o.amountCents),
            })),
          })),
      })),
      // Scheduled money that reaches no category never shows up in the budget,
      // so it can never be reported as a shortfall — it has to be named.
      uncategorizedUpcoming: forecast.uncategorizedUpcoming.map((o) => ({
        ...o,
        amountFormatted: formatMoney(o.amountCents),
      })),
    });
  });

  // GET /:month — full budget state
  router.get('/:month', (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const budget = getBudgetMonth(db, month);
    return c.json(formatBudgetResponse(budget));
  });

  // POST /:month/assign — assign to category
  router.post('/:month/assign', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const body = await c.req.json();
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    requireCategory(db, parsed.data.categoryId);
    assignToCategory(db, parsed.data.categoryId, month, parsed.data.amountCents);

    const budget = getBudgetMonth(db, month);
    return c.json(
      wantsMinimal(c)
        ? formatMinimalResponse(budget, [parsed.data.categoryId])
        : formatBudgetResponse(budget),
    );
  });

  // POST /:month/bulk-assign — many assignments, all-or-nothing
  router.post('/:month/bulk-assign', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const body = await c.req.json();
    const parsed = bulkAssignSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const { assignments } = parsed.data;

    const duplicates = assignments
      .map((a) => a.categoryId)
      .filter((id, i, all) => all.indexOf(id) !== i);
    if (duplicates.length) {
      throw validationError(`Duplicate categoryId in batch: ${[...new Set(duplicates)].join(', ')}`);
    }

    // Validate every id before writing anything, so a bad id at position 40
    // cannot leave the first 39 applied.
    for (const a of assignments) requireCategory(db, a.categoryId);

    db.$client.transaction(() => {
      for (const a of assignments) {
        assignToCategory(db, a.categoryId, month, a.amountCents);
      }
    })();

    const budget = getBudgetMonth(db, month);
    const touched = assignments.map((a) => a.categoryId);
    return c.json({
      applied: assignments.length,
      ...(wantsMinimal(c)
        ? formatMinimalResponse(budget, touched)
        : formatBudgetResponse(budget)),
    });
  });

  // POST /:month/set-available — force Available to an exact figure
  router.post('/:month/set-available', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const body = await c.req.json();
    const parsed = setAvailableSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    requireCategory(db, parsed.data.categoryId);
    const result = setCategoryAvailable(db, parsed.data.categoryId, month, parsed.data.amountCents);

    const budget = getBudgetMonth(db, month);
    return c.json({
      categoryId: parsed.data.categoryId,
      deltaCents: result.deltaCents,
      deltaFormatted: formatMoney(result.deltaCents),
      ...(wantsMinimal(c)
        ? formatMinimalResponse(budget, [parsed.data.categoryId])
        : formatBudgetResponse(budget)),
    });
  });

  // POST /:month/assign-targets — fund underfunded targets, stop at zero RTA
  router.post('/:month/assign-targets', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    // Тело необязательное: без него раздача ограничена деньгами в RTA.
    let allowNegativeRta = false;
    try {
      const body = await c.req.json();
      const parsed = assignTargetsSchema.safeParse(body);
      if (!parsed.success) {
        throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      allowNegativeRta = parsed.data.allowNegativeRta ?? false;
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiError') throw e;
      // Пустое или неразобранное тело — оставляем безопасное поведение.
    }

    const result = assignToTargets(db, month, { allowNegativeRta });

    return c.json({
      month,
      applied: result.applied.map((a) => ({
        ...a,
        addedFormatted: formatMoney(a.addedCents),
        assignedFormatted: formatMoney(a.assignedCents),
      })),
      totalAddedCents: result.totalAddedCents,
      totalAddedFormatted: formatMoney(result.totalAddedCents),
      readyToAssignCents: result.readyToAssignCents,
      readyToAssignFormatted: formatMoney(result.readyToAssignCents),
      remainingUnderfundedCents: result.remainingUnderfundedCents,
      remainingUnderfundedFormatted: formatMoney(result.remainingUnderfundedCents),
      stoppedAtZeroRta: result.stoppedAtZeroRta,
      budget: formatBudgetResponse(getBudgetMonth(db, month)),
    });
  });

  // POST /:month/copy-from — make this month a copy of another
  router.post('/:month/copy-from', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const body = await c.req.json();
    const parsed = copyMonthSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError('Requires fromMonth in YYYY-MM format');
    }
    if (parsed.data.fromMonth === month) {
      throw validationError('fromMonth and the target month must differ');
    }

    const result = copyMonthAssignments(db, parsed.data.fromMonth, month);

    return c.json({
      month,
      fromMonth: parsed.data.fromMonth,
      applied: result.applied.map((a) => ({
        ...a,
        fromFormatted: formatMoney(a.fromCents),
        toFormatted: formatMoney(a.toCents),
      })),
      clearedCount: result.clearedCount,
      sourceEmpty: result.sourceEmpty,
      totalAssignedCents: result.totalAssignedCents,
      totalAssignedFormatted: formatMoney(result.totalAssignedCents),
      readyToAssignCents: result.readyToAssignCents,
      readyToAssignFormatted: formatMoney(result.readyToAssignCents),
      budget: formatBudgetResponse(getBudgetMonth(db, month)),
    });
  });

  // POST /reset — clear assignments from a month onward
  router.post('/reset', async (c) => {
    const body = await c.req.json();
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(
        'Requires fromMonth (YYYY-MM) and confirm: true — this deletes every assignment from that month onward',
      );
    }

    const result = resetBudgetFrom(db, parsed.data.fromMonth);
    const budget = getBudgetMonth(db, parsed.data.fromMonth);

    return c.json({
      fromMonth: parsed.data.fromMonth,
      clearedRows: result.clearedRows,
      clearedCents: result.clearedCents,
      clearedFormatted: formatMoney(result.clearedCents),
      readyToAssignCents: budget.readyToAssignCents,
      readyToAssignFormatted: formatMoney(budget.readyToAssignCents),
    });
  });

  // GET /:month/reconciliation — why accounts and budget disagree
  router.get('/:month/reconciliation', (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const r = getRtaReconciliation(db, month);
    return c.json({
      ...r,
      readyToAssignFormatted: formatMoney(r.readyToAssignCents),
      totalAvailableFormatted: formatMoney(r.totalAvailableCents),
      totalBalanceFormatted: formatMoney(r.totalBalanceCents),
      onBudgetBalanceFormatted: formatMoney(r.onBudgetBalanceCents),
      offBudgetBalanceFormatted: formatMoney(r.offBudgetBalanceCents),
      accounts: r.accounts.map((a) => ({
        ...a,
        balanceFormatted: formatMoney(a.balanceCents, a.currency),
      })),
      reconciliation: {
        ...r.reconciliation,
        gapFormatted: formatMoney(r.reconciliation.gapCents),
        unexplainedFormatted: formatMoney(r.reconciliation.unexplainedCents),
      },
    });
  });

  // POST /:month/move — move between categories
  router.post('/:month/move', async (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const body = await c.req.json();
    const parsed = moveSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    requireCategory(db, parsed.data.fromCategoryId);
    requireCategory(db, parsed.data.toCategoryId);

    moveBetweenCategories(
      db,
      parsed.data.fromCategoryId,
      parsed.data.toCategoryId,
      month,
      parsed.data.amountCents,
    );

    const budget = getBudgetMonth(db, month);
    return c.json(
      wantsMinimal(c)
        ? formatMinimalResponse(budget, [parsed.data.fromCategoryId, parsed.data.toCategoryId])
        : formatBudgetResponse(budget),
    );
  });

  // GET /:month/ready-to-assign — breakdown
  router.get('/:month/ready-to-assign', (c) => {
    const month = c.req.param('month');
    if (!monthRegex.test(month)) {
      throw validationError('Month must be YYYY-MM format');
    }

    const breakdown = getReadyToAssign(db, month);
    return c.json({
      ...breakdown,
      totalInflowFormatted: formatMoney(breakdown.totalInflowCents),
      totalAssignedFormatted: formatMoney(breakdown.totalAssignedCents),
      readyToAssignFormatted: formatMoney(breakdown.readyToAssignCents),
    });
  });

  return router;
}
