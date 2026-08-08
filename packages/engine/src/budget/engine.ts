import Decimal from 'decimal.js';
import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { categories, categoryGroups, monthlyBudgets } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type {
  CategoryBudget,
  BudgetMonth,
  AccountBalance,
  ReadyToAssignBreakdown,
  AssignToTargetsResult,
  CopyMonthResult,
} from './types.js';

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

/**
 * Сколько месяцев остаётся на цель, считая текущий: с `month` по месяц
 * `targetDate` включительно. Прошедшая дата и дата в текущем месяце дают 1 —
 * копить больше некогда, нужна вся сумма сразу.
 */
function monthsUntil(month: string, targetDate: string): number {
  const [fromYear, fromMonth] = month.split('-').map(Number);
  const [toYear, toMonth] = targetDate.split('-').map(Number);
  if (!toYear || !toMonth) return 1;

  const diff = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  return diff > 0 ? diff + 1 : 1;
}

/**
 * Сколько ещё надо назначить категории в `month`, чтобы её цель осталась на
 * треке. Каждый тип цели спрашивает своё:
 *
 * - `monthly_funding` — «отложить ещё N в этом месяце». Считается от
 *   назначенного ЗА ЭТОТ МЕСЯЦ: перекатившийся остаток цель не закрывает,
 *   иначе накопительная категория перестала бы просить деньги навсегда.
 * - `target_balance` — «дополнить до N». Считается от Available, то есть
 *   остаток с прошлых месяцев засчитывается, а перерасход увеличивает запрос.
 * - `target_by_date` — доля этого месяца: недостающее НА НАЧАЛО месяца делится
 *   на оставшиеся месяцы и округляется вверх, а из доли вычитается уже
 *   назначенное в этом месяце. Без вычитания категория продолжала бы просить
 *   деньги после того, как свою долю уже получила: остаток делился на то же
 *   число месяцев заново. Без даты вырождается в `target_balance`.
 */
function computeUnderfunded(
  targetAmountCents: number | null,
  targetType: string | null,
  targetDate: string | null,
  month: string,
  assignedThisMonthCents: number,
  availableCents: number,
): number {
  if (targetAmountCents == null || !targetType || targetType === 'none') return 0;

  if (targetType === 'monthly_funding') {
    const gap = new Decimal(targetAmountCents).minus(assignedThisMonthCents);
    return gap.greaterThan(0) ? gap.toNumber() : 0;
  }

  if (targetType === 'target_by_date' && targetDate) {
    // Available уже включает назначенное в этом месяце — для расчёта доли
    // нужен остаток, с которым месяц начинался.
    const carriedOver = new Decimal(availableCents).minus(assignedThisMonthCents);
    const needed = new Decimal(targetAmountCents).minus(carriedOver);
    if (!needed.greaterThan(0)) return 0;

    const share = needed.div(monthsUntil(month, targetDate)).ceil();
    const left = share.minus(assignedThisMonthCents);
    return left.greaterThan(0) ? left.toNumber() : 0;
  }

  const gap = new Decimal(targetAmountCents).minus(availableCents);
  return gap.greaterThan(0) ? gap.toNumber() : 0;
}

export function getCategoryAvailable(db: DB, categoryId: string, month: string): number {
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
    targetDate: categories.targetDate,
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
  let totalUnderfunded = new Decimal(0);

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
    const underfundedCents = computeUnderfunded(
      cat.targetAmountCents,
      cat.targetType,
      cat.targetDate,
      month,
      assigned,
      available,
    );
    totalUnderfunded = totalUnderfunded.plus(underfundedCents);

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
      targetDate: cat.targetDate ?? null,
      underfundedCents,
      isUnderfunded: underfundedCents > 0,
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
    totalUnderfundedCents: totalUnderfunded.toNumber(),
  };
}

/**
 * Раздаёт деньги по недофинансированным целям и **останавливается на нуле
 * Ready to Assign**.
 *
 * До этого раздачу собирал клиент: он брал все цели и назначал их полностью,
 * не глядя на RTA, — при пустом бюджете это молча уводило его глубоко в минус.
 * YNAB в этом месте прекращает раздачу, и это правило принадлежит движку, а не
 * кнопке: тем же поведением пользуется агент.
 *
 * Порядок раздачи — **подмножество** приоритета YNAB: сначала цели с датой
 * (ближайшая первая), потом остальные в порядке бюджета. Полного порядка из
 * шести уровней здесь нет: он требует запланированных транзакций и категорий
 * платежа по кредитке, которых в модели пока нет.
 *
 * Последняя категория финансируется частично — так каждый оставшийся тиын
 * попадает в дело, как и у YNAB.
 */
export function assignToTargets(
  db: DB,
  month: string,
  opts: { allowNegativeRta?: boolean } = {},
): AssignToTargetsResult {
  const budget = getBudgetMonth(db, month);

  const queue = budget.categoryBudgets
    .filter(c => c.underfundedCents > 0)
    .map((c, index) => ({ ...c, index }))
    .sort((a, b) => {
      // Дата — обещание конкретному сроку, поэтому она вперёд всего остального.
      if (a.targetDate && b.targetDate) {
        return a.targetDate === b.targetDate
          ? a.index - b.index
          : a.targetDate < b.targetDate ? -1 : 1;
      }
      if (a.targetDate) return -1;
      if (b.targetDate) return 1;
      return a.index - b.index;
    });

  let remaining = new Decimal(budget.readyToAssignCents);
  const unlimited = opts.allowNegativeRta === true;

  if (queue.length === 0) {
    return {
      applied: [],
      totalAddedCents: 0,
      readyToAssignCents: budget.readyToAssignCents,
      remainingUnderfundedCents: 0,
      stoppedAtZeroRta: false,
    };
  }

  const totalNeeded = queue.reduce(
    (acc, c) => acc.plus(c.underfundedCents),
    new Decimal(0),
  );

  if (!unlimited && remaining.lessThanOrEqualTo(0)) {
    return {
      applied: [],
      totalAddedCents: 0,
      readyToAssignCents: budget.readyToAssignCents,
      remainingUnderfundedCents: totalNeeded.toNumber(),
      stoppedAtZeroRta: true,
    };
  }

  const plan: { category: typeof queue[number]; addedCents: number }[] = [];
  for (const category of queue) {
    if (!unlimited && remaining.lessThanOrEqualTo(0)) break;

    const wanted = new Decimal(category.underfundedCents);
    const added = unlimited ? wanted : Decimal.min(wanted, remaining);
    if (added.lessThanOrEqualTo(0)) continue;

    plan.push({ category, addedCents: added.toNumber() });
    remaining = remaining.minus(added);
  }

  db.$client.transaction(() => {
    for (const { category, addedCents } of plan) {
      // `assignToCategory` ЗАДАЁТ назначение месяца, поэтому прибавляем сами.
      upsertMonthlyBudget(
        db,
        category.categoryId,
        month,
        new Decimal(category.assignedCents).plus(addedCents).toNumber(),
      );
    }
  })();

  const after = getBudgetMonth(db, month);
  const totalAdded = plan.reduce(
    (acc, p) => acc.plus(p.addedCents),
    new Decimal(0),
  );

  return {
    applied: plan.map(({ category, addedCents }) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      addedCents,
      assignedCents: new Decimal(category.assignedCents).plus(addedCents).toNumber(),
    })),
    totalAddedCents: totalAdded.toNumber(),
    readyToAssignCents: after.readyToAssignCents,
    remainingUnderfundedCents: after.totalUnderfundedCents,
    stoppedAtZeroRta: !unlimited && totalAdded.lessThan(totalNeeded),
  };
}

/**
 * Делает месяц копией другого: каждая категория получает ту сумму, что была
 * назначена ей в `fromMonth`, **включая ноль**.
 *
 * Раньше это собирал клиент и копировал только категории с ненулевой суммой в
 * источнике. Категория, которой назначили в текущем месяце, но не назначали в
 * прошлом, сохраняла своё значение — получался месяц, не похожий ни на
 * прошлый, ни на текущий, хотя диалог обещал замену.
 *
 * Пустой источник — не повод обнулить весь месяц: это почти наверняка промах
 * пользователя, поэтому такой вызов ничего не делает и говорит `sourceEmpty`.
 */
export function copyMonthAssignments(
  db: DB,
  fromMonth: string,
  toMonth: string,
): CopyMonthResult {
  if (fromMonth === toMonth) {
    throw new Error('Cannot copy a month onto itself');
  }

  const source = getBudgetMonth(db, fromMonth);
  const target = getBudgetMonth(db, toMonth);

  const sourceAssigned = new Map(
    source.categoryBudgets.map(c => [c.categoryId, c.assignedCents]),
  );
  const sourceEmpty = source.categoryBudgets.every(c => c.assignedCents === 0);

  if (sourceEmpty) {
    return {
      applied: [],
      clearedCount: 0,
      sourceEmpty: true,
      totalAssignedCents: target.totalAssignedCents,
      readyToAssignCents: target.readyToAssignCents,
    };
  }

  const changes = target.categoryBudgets
    .map(c => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      fromCents: c.assignedCents,
      toCents: sourceAssigned.get(c.categoryId) ?? 0,
    }))
    .filter(c => c.fromCents !== c.toCents);

  if (changes.length > 0) {
    db.$client.transaction(() => {
      for (const change of changes) {
        upsertMonthlyBudget(db, change.categoryId, toMonth, change.toCents);
      }
    })();
  }

  const after = getBudgetMonth(db, toMonth);
  return {
    applied: changes,
    clearedCount: changes.filter(c => c.toCents === 0).length,
    sourceEmpty: false,
    totalAssignedCents: after.totalAssignedCents,
    readyToAssignCents: after.readyToAssignCents,
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

/**
 * Forces a category's Available to an exact figure for `month`.
 *
 * `assignToCategory` only ever sets the current month's assignment and refuses
 * negatives, so Available inherited from earlier months could not be cleared —
 * the documented workaround was a pile of mutually-cancelling transactions.
 * This solves for the month's assignment instead, which is allowed to go
 * negative; the difference flows back to Ready to Assign.
 *
 * It moves money between the category and RTA. It does not destroy money: if
 * the budget as a whole holds more than the accounts do, the recorded inflows
 * are wrong and `reconcileAccount` is the tool for that.
 */
export function setCategoryAvailable(
  db: DB,
  categoryId: string,
  month: string,
  targetAvailableCents: number,
): { assignedCents: number; availableCents: number; deltaCents: number } {
  const cat = db.select({ id: categories.id, isSystem: categories.isSystem })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (!cat) {
    throw new Error(`Category not found: ${categoryId}`);
  }
  if (cat.isSystem) {
    throw new Error('Cannot set available on system category');
  }

  const currentAvailable = getCategoryAvailable(db, categoryId, month);
  const delta = new Decimal(targetAvailableCents).minus(currentAvailable);

  const thisMonth = db.select({ assignedCents: monthlyBudgets.assignedCents })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.categoryId, categoryId), eq(monthlyBudgets.month, month)))
    .get();

  const newAssigned = new Decimal(thisMonth?.assignedCents ?? 0).plus(delta).toNumber();
  upsertMonthlyBudget(db, categoryId, month, newAssigned);

  return {
    assignedCents: newAssigned,
    availableCents: targetAvailableCents,
    deltaCents: delta.toNumber(),
  };
}

/**
 * Clears every assignment from `fromMonth` onward — "start budgeting again from
 * here". Carryover from earlier months survives; use `setCategoryAvailable` to
 * flatten that too.
 */
export function resetBudgetFrom(db: DB, fromMonth: string): { clearedRows: number; clearedCents: number } {
  const affected = db.$client.prepare(`
    SELECT COUNT(*) as rows, COALESCE(SUM(assigned_cents), 0) as total
    FROM monthly_budgets WHERE month >= ?
  `).get(fromMonth) as { rows: number; total: number };

  db.$client.prepare(`DELETE FROM monthly_budgets WHERE month >= ?`).run(fromMonth);

  return { clearedRows: affected.rows, clearedCents: affected.total };
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

/**
 * Writes a single adjustment transaction so an account's computed balance
 * matches what the bank actually shows.
 *
 * This is the supported answer to "the app thinks I have more money than I do".
 * The adjustment lands in Ready to Assign for on-budget accounts, so the
 * correction propagates into the budget instead of hiding in a category.
 */
export function reconcileAccount(
  db: DB,
  accountId: string,
  actualBalanceCents: number,
  date: string,
  memo?: string,
): { adjustmentCents: number; previousBalanceCents: number; transactionId: string | null } {
  const acct = db.$client.prepare(
    `SELECT id, name, on_budget FROM accounts WHERE id = ?`
  ).get(accountId) as { id: string; name: string; on_budget: number } | undefined;

  if (!acct) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const row = db.$client.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as balance
    FROM transactions WHERE account_id = ? AND is_deleted = 0
  `).get(accountId) as { balance: number };

  const delta = new Decimal(actualBalanceCents).minus(row.balance).toNumber();
  if (delta === 0) {
    return { adjustmentCents: 0, previousBalanceCents: row.balance, transactionId: null };
  }

  const id = createId();
  const now = new Date().toISOString();

  db.$client.prepare(`
    INSERT INTO transactions
      (id, account_id, date, amount_cents, payee_name, category_id,
       memo, cleared, approved, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'reconciled', 1, 0, ?, ?)
  `).run(
    id,
    accountId,
    date,
    delta,
    'Reconciliation adjustment',
    acct.on_budget ? 'ready-to-assign' : null,
    memo ?? `Balance corrected to ${actualBalanceCents}`,
    now,
    now,
  );

  return { adjustmentCents: delta, previousBalanceCents: row.balance, transactionId: id };
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

interface RtaAccountRow {
  id: string;
  name: string;
  type: string;
  on_budget: number;
  is_active: number;
  currency: string;
  balance: number;
}

/**
 * Explains, account by account, why the money in the accounts does not equal
 * Ready to Assign plus everything sitting in categories.
 *
 * The identity the budget maintains is
 *   RTA + Σ Available = on-budget inflow + on-budget activity
 * while the accounts hold
 *   Σ balance = on-budget money + off-budget money.
 * Everything that separates the two is itemised in `reconciliation` rather than
 * left for the caller to guess at: off-budget accounts, balances on accounts
 * that were deactivated but whose transactions still count, uncategorised
 * spending, and money parked in foreign currency.
 */
export function getRtaReconciliation(db: DB, month: string) {
  const monthEnd = `${month}-31`;

  const accountRows = db.$client.prepare(`
    SELECT a.id, a.name, a.type, a.on_budget, a.is_active, a.currency,
      COALESCE(SUM(CASE WHEN t.is_deleted = 0 AND t.date <= ? THEN t.amount_cents ELSE 0 END), 0) as balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id
    ORDER BY a.on_budget DESC, a.sort_order
  `).all(monthEnd) as RtaAccountRow[];

  const { totalInflowCents, totalAssignedCents, readyToAssignCents } = getReadyToAssign(db, month);

  // Categorised, non-transfer spending on on-budget accounts — the other half
  // of what the budget accounts for.
  const activityRow = db.$client.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) as total
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id IS NOT NULL AND t.category_id != 'ready-to-assign'
      AND t.transfer_account_id IS NULL
      AND t.date <= ?
  `).get(monthEnd) as { total: number };

  // Money that moved on an on-budget account but landed in no category at all.
  // This is invisible in the budget yet fully visible in the balance.
  const uncategorizedRow = db.$client.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) as total, COUNT(*) as count
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.category_id IS NULL
      AND t.transfer_account_id IS NULL
      AND t.date <= ?
  `).get(monthEnd) as { total: number; count: number };

  // Transfers that crossed the on-budget boundary drain budgeted money into
  // accounts the budget does not track.
  const crossBoundaryRow = db.$client.prepare(`
    SELECT COALESCE(SUM(t.amount_cents), 0) as total
    FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN accounts b ON b.id = t.transfer_account_id
    WHERE a.on_budget = 1 AND b.on_budget = 0
      AND t.is_deleted = 0 AND t.date <= ?
  `).get(monthEnd) as { total: number };

  const accounts = accountRows.map((r) => ({
    accountId: r.id,
    accountName: r.name,
    type: r.type,
    onBudget: Boolean(r.on_budget),
    isActive: Boolean(r.is_active),
    currency: r.currency,
    balanceCents: r.balance,
    /** Only on-budget, active-or-not accounts feed Ready to Assign. */
    countsTowardBudget: Boolean(r.on_budget),
  }));

  const sum = (pred: (a: typeof accounts[number]) => boolean) =>
    accounts.filter(pred).reduce((acc, a) => new Decimal(acc).plus(a.balanceCents).toNumber(), 0);

  const totalBalanceCents = sum(() => true);
  const onBudgetBalanceCents = sum((a) => a.onBudget);
  const offBudgetBalanceCents = sum((a) => !a.onBudget);
  const inactiveBalanceCents = sum((a) => !a.isActive);
  const foreignCurrencyBalanceCents = sum((a) => a.currency !== 'KZT');

  const totalAvailableCents = new Decimal(totalInflowCents)
    .plus(activityRow.total)
    .minus(readyToAssignCents)
    .toNumber();

  const budgetedTotalCents = new Decimal(readyToAssignCents).plus(totalAvailableCents).toNumber();
  // On-budget balance decomposes exactly into inflow + activity (which is
  // budgetedTotal), plus spending that never reached a category, plus the
  // on-budget leg of transfers that left the budget. Anything left over is a
  // genuine anomaly.
  const unexplainedCents = new Decimal(onBudgetBalanceCents)
    .minus(budgetedTotalCents)
    .minus(uncategorizedRow.total)
    .minus(crossBoundaryRow.total)
    .toNumber();

  return {
    month,
    readyToAssignCents,
    totalAvailableCents,
    budgetedTotalCents,
    totalInflowCents,
    totalAssignedCents,
    totalBalanceCents,
    onBudgetBalanceCents,
    offBudgetBalanceCents,
    accounts,
    reconciliation: {
      /** Σ balance − (RTA + Σ Available). Each line below explains part of it. */
      gapCents: new Decimal(totalBalanceCents).minus(budgetedTotalCents).toNumber(),
      offBudgetBalanceCents,
      inactiveAccountBalanceCents: inactiveBalanceCents,
      foreignCurrencyBalanceCents,
      uncategorizedCents: uncategorizedRow.total,
      uncategorizedCount: uncategorizedRow.count,
      transfersToOffBudgetCents: crossBoundaryRow.total,
      /** Non-zero here means a bug or hand-edited data, not a modelling gap. */
      unexplainedCents,
    },
  };
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
