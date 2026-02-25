import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { categories, categoryGroups, monthlyBudgets } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { CategoryBudget, BudgetMonth, AccountBalance, ReadyToAssignBreakdown } from './types.js';

// --- Raw SQL row types ---

interface CategoryAggRow {
  category_id: string;
  total: number;
}

interface AccountRow {
  id: string;
  name: string;
  type: string;
  cleared: number;
  uncleared: number;
}

// --- Private helpers ---

function getCategoryAvailable(db: DB, categoryId: string, month: string): number {
  const monthEnd = `${month}-31`;

  const assignedRow = db.$client.prepare(`
    SELECT SUM(assigned_cents) as total FROM monthly_budgets
    WHERE category_id = ? AND month <= ?
  `).get(categoryId, month) as { total: number | null } | undefined;

  const activityRow = db.$client.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id = ?
      AND t.transfer_account_id IS NULL
      AND t.date <= ?
  `).get(categoryId, monthEnd) as { total: number | null } | undefined;

  const cumAssigned = assignedRow?.total ?? 0;
  const cumActivity = activityRow?.total ?? 0;

  return new Decimal(cumAssigned).plus(cumActivity).toNumber();
}

function upsertMonthlyBudget(db: DB, categoryId: string, month: string, assignedCents: number): void {
  const existing = db.select({ id: monthlyBudgets.id, assignedCents: monthlyBudgets.assignedCents })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.categoryId, categoryId), eq(monthlyBudgets.month, month)))
    .get();

  const now = new Date().toISOString();
  if (existing) {
    db.update(monthlyBudgets)
      .set({ assignedCents, updatedAt: now })
      .where(eq(monthlyBudgets.id, existing.id))
      .run();
  } else {
    db.insert(monthlyBudgets)
      .values({ categoryId, month, assignedCents, createdAt: now, updatedAt: now })
      .run();
  }
}

// --- Public API ---

export function getBudgetMonth(db: DB, month: string): BudgetMonth {
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;

  // Step 1: Load non-system, non-hidden categories with their groups
  const cats = db.select({
    id: categories.id,
    name: categories.name,
    groupId: categories.groupId,
    groupName: categoryGroups.name,
    targetAmountCents: categories.targetAmountCents,
    targetType: categories.targetType,
  }).from(categories)
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(categories.isSystem, false), eq(categories.isHidden, false)))
    .orderBy(categoryGroups.sortOrder, categories.sortOrder)
    .all();

  // Step 2: Assigned THIS month
  const assignedRows = db.select({
    categoryId: monthlyBudgets.categoryId,
    assignedCents: monthlyBudgets.assignedCents,
  }).from(monthlyBudgets)
    .where(eq(monthlyBudgets.month, month))
    .all();

  const assignedMap = new Map<string, number>();
  for (const row of assignedRows) {
    assignedMap.set(row.categoryId, row.assignedCents);
  }

  // Step 3: Activity THIS month (on-budget, not deleted, not transfers, not system)
  const activityRows = db.$client.prepare(`
    SELECT t.category_id, SUM(t.amount_cents) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id IS NOT NULL AND t.category_id != 'ready-to-assign'
      AND t.transfer_account_id IS NULL
      AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
  `).all(monthStart, monthEnd) as CategoryAggRow[];

  const activityMap = new Map<string, number>();
  for (const row of activityRows) {
    activityMap.set(row.category_id, row.total);
  }

  // Step 4: Cumulative available (all time through this month)
  const cumAssignedRows = db.$client.prepare(`
    SELECT category_id, SUM(assigned_cents) as total
    FROM monthly_budgets WHERE month <= ?
    GROUP BY category_id
  `).all(month) as CategoryAggRow[];

  const cumAssignedMap = new Map<string, number>();
  for (const row of cumAssignedRows) {
    cumAssignedMap.set(row.category_id, row.total);
  }

  const cumActivityRows = db.$client.prepare(`
    SELECT t.category_id, SUM(t.amount_cents) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id IS NOT NULL AND t.category_id != 'ready-to-assign'
      AND t.transfer_account_id IS NULL
      AND t.date <= ?
    GROUP BY t.category_id
  `).all(monthEnd) as CategoryAggRow[];

  const cumActivityMap = new Map<string, number>();
  for (const row of cumActivityRows) {
    cumActivityMap.set(row.category_id, row.total);
  }

  // Step 5: Ready to Assign = total inflows - total assigned (all time through this month)
  const inflowRow = db.$client.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id = 'ready-to-assign'
      AND t.date <= ?
  `).get(monthEnd) as { total: number | null } | undefined;

  const totalInflowCents = inflowRow?.total ?? 0;

  const totalAssignedRow = db.$client.prepare(`
    SELECT SUM(assigned_cents) as total FROM monthly_budgets WHERE month <= ?
  `).get(month) as { total: number | null } | undefined;

  const totalAllAssignedCents = totalAssignedRow?.total ?? 0;
  const readyToAssignCents = new Decimal(totalInflowCents).minus(totalAllAssignedCents).toNumber();

  // Step 6: Assemble
  let totalActivity = new Decimal(0);
  let totalAvailable = new Decimal(0);
  let overspent = new Decimal(0);
  let totalAssignedThisMonth = new Decimal(0);

  const categoryBudgets: CategoryBudget[] = cats.map(cat => {
    const assigned = assignedMap.get(cat.id) ?? 0;
    const activity = activityMap.get(cat.id) ?? 0;
    const cumAssigned = cumAssignedMap.get(cat.id) ?? 0;
    const cumActivity = cumActivityMap.get(cat.id) ?? 0;
    const available = new Decimal(cumAssigned).plus(cumActivity).toNumber();

    totalAssignedThisMonth = totalAssignedThisMonth.plus(assigned);
    totalActivity = totalActivity.plus(activity);
    totalAvailable = totalAvailable.plus(available);

    if (available < 0) {
      overspent = overspent.plus(new Decimal(available).abs());
    }

    const isOverspent = available < 0;
    const isUnderfunded =
      cat.targetAmountCents != null &&
      cat.targetType !== 'none' &&
      available < cat.targetAmountCents;

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      groupId: cat.groupId,
      groupName: cat.groupName,
      assignedCents: assigned,
      activityCents: activity,
      availableCents: available,
      targetAmountCents: cat.targetAmountCents,
      targetType: cat.targetType ?? null,
      isUnderfunded,
      isOverspent,
    };
  });

  return {
    month,
    readyToAssignCents,
    totalAssignedCents: totalAssignedThisMonth.toNumber(),
    totalActivityCents: totalActivity.toNumber(),
    totalAvailableCents: totalAvailable.toNumber(),
    categoryBudgets,
    overspentCents: overspent.toNumber(),
  };
}

export function assignToCategory(db: DB, categoryId: string, month: string, amountCents: number): void {
  if (amountCents < 0) {
    throw new Error('Amount must be non-negative');
  }

  const cat = db.select({ id: categories.id, isSystem: categories.isSystem })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (!cat) {
    throw new Error(`Category not found: ${categoryId}`);
  }
  if (cat.isSystem) {
    throw new Error('Cannot assign to system category');
  }

  upsertMonthlyBudget(db, categoryId, month, amountCents);
}

export function moveBetweenCategories(
  db: DB,
  fromId: string,
  toId: string,
  month: string,
  amountCents: number,
): void {
  if (amountCents <= 0) {
    throw new Error('Amount must be positive');
  }

  // Validate both categories exist and are not system
  for (const catId of [fromId, toId]) {
    const cat = db.select({ id: categories.id, isSystem: categories.isSystem })
      .from(categories)
      .where(eq(categories.id, catId))
      .get();

    if (!cat) {
      throw new Error(`Category not found: ${catId}`);
    }
    if (cat.isSystem) {
      throw new Error('Cannot move from/to system category');
    }
  }

  // Check from available
  const fromAvailable = getCategoryAvailable(db, fromId, month);
  if (fromAvailable < amountCents) {
    throw new Error(`Insufficient available: ${fromAvailable} < ${amountCents}`);
  }

  // Get current assigned values for this month
  const fromBudget = db.select({ assignedCents: monthlyBudgets.assignedCents })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.categoryId, fromId), eq(monthlyBudgets.month, month)))
    .get();

  const toBudget = db.select({ assignedCents: monthlyBudgets.assignedCents })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.categoryId, toId), eq(monthlyBudgets.month, month)))
    .get();

  const fromAssigned = new Decimal(fromBudget?.assignedCents ?? 0).minus(amountCents).toNumber();
  const toAssigned = new Decimal(toBudget?.assignedCents ?? 0).plus(amountCents).toNumber();

  upsertMonthlyBudget(db, fromId, month, fromAssigned);
  upsertMonthlyBudget(db, toId, month, toAssigned);
}

export function getAccountBalances(db: DB): AccountBalance[] {
  const rows = db.$client.prepare(`
    SELECT a.id, a.name, a.type,
      COALESCE(SUM(CASE WHEN t.cleared IN ('cleared', 'reconciled') THEN t.amount_cents ELSE 0 END), 0) as cleared,
      COALESCE(SUM(CASE WHEN t.cleared = 'uncleared' THEN t.amount_cents ELSE 0 END), 0) as uncleared
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id AND t.is_deleted = 0
    WHERE a.is_active = 1
    GROUP BY a.id
    ORDER BY a.sort_order
  `).all() as AccountRow[];

  return rows.map(row => ({
    accountId: row.id,
    accountName: row.name,
    type: row.type,
    clearedCents: row.cleared,
    unclearedCents: row.uncleared,
    balanceCents: new Decimal(row.cleared).plus(row.uncleared).toNumber(),
  }));
}

export function getReadyToAssignRange(
  db: DB,
  fromMonth: string,
  toMonth: string,
): {
  months: Array<{ month: string; readyToAssignCents: number }>;
  minReadyToAssignCents: number;
  minMonth: string;
} {
  // Generate month range
  const months: Array<{ month: string; readyToAssignCents: number }> = [];
  let current = fromMonth;
  while (current <= toMonth) {
    const { readyToAssignCents } = getReadyToAssign(db, current);
    months.push({ month: current, readyToAssignCents });

    // Advance to next month
    const [y, m] = current.split('-').map(Number);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    current = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  }

  let minReadyToAssignCents = months[0]?.readyToAssignCents ?? 0;
  let minMonth = months[0]?.month ?? fromMonth;
  for (const entry of months) {
    if (entry.readyToAssignCents < minReadyToAssignCents) {
      minReadyToAssignCents = entry.readyToAssignCents;
      minMonth = entry.month;
    }
  }

  return { months, minReadyToAssignCents, minMonth };
}

export function getReadyToAssign(db: DB, month: string): ReadyToAssignBreakdown {
  const monthEnd = `${month}-31`;

  const inflowRow = db.$client.prepare(`
    SELECT SUM(t.amount_cents) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id = 'ready-to-assign'
      AND t.date <= ?
  `).get(monthEnd) as { total: number | null } | undefined;

  const totalInflowCents = inflowRow?.total ?? 0;

  const assignedRow = db.$client.prepare(`
    SELECT SUM(assigned_cents) as total FROM monthly_budgets WHERE month <= ?
  `).get(month) as { total: number | null } | undefined;

  const totalAssignedCents = assignedRow?.total ?? 0;
  const readyToAssignCents = new Decimal(totalInflowCents).minus(totalAssignedCents).toNumber();

  return {
    totalInflowCents,
    totalAssignedCents,
    readyToAssignCents,
    isOverAssigned: readyToAssignCents < 0,
  };
}
