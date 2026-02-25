import { Hono } from 'hono';
import { z } from 'zod';
import {
  type DB,
  getBudgetMonth,
  assignToCategory,
  moveBetweenCategories,
  getReadyToAssign,
  formatMoney,
} from '@pfm/engine';
import { validationError } from '../errors.js';

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

    groupMap.get(cb.groupId)!.categories.push({
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
      isUnderfunded: cb.isUnderfunded,
      isOverspent: cb.isOverspent,
    });
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
    groups: Array.from(groupMap.values()),
  };
}

export function budgetRoutes(db: DB) {
  const router = new Hono();

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

    assignToCategory(db, parsed.data.categoryId, month, parsed.data.amountCents);

    const budget = getBudgetMonth(db, month);
    return c.json(formatBudgetResponse(budget));
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

    moveBetweenCategories(
      db,
      parsed.data.fromCategoryId,
      parsed.data.toCategoryId,
      month,
      parsed.data.amountCents,
    );

    const budget = getBudgetMonth(db, month);
    return c.json(formatBudgetResponse(budget));
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
