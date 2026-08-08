export interface CategoryBudget {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  targetAmountCents: number | null;
  targetType: string | null;
  targetDate: string | null;
  /**
   * Сколько ещё надо назначить в этом месяце, чтобы цель осталась на треке.
   * Ноль, если цели нет или она уже закрыта. Считается по-разному для каждого
   * `targetType` — см. `computeUnderfunded`.
   */
  underfundedCents: number;
  isUnderfunded: boolean;
  isOverspent: boolean;
}

export interface BudgetMonth {
  month: string;
  readyToAssignCents: number;
  totalAssignedCents: number;
  totalActivityCents: number;
  totalAvailableCents: number;
  categoryBudgets: CategoryBudget[];
  overspentCents: number;
  totalUnderfundedCents: number;
}

export interface AssignedTarget {
  categoryId: string;
  categoryName: string;
  /** Сколько добавлено сверх уже назначенного. */
  addedCents: number;
  /** Назначение месяца после раздачи. */
  assignedCents: number;
}

export interface AssignToTargetsResult {
  applied: AssignedTarget[];
  totalAddedCents: number;
  /** Ready to Assign после раздачи. */
  readyToAssignCents: number;
  /** Сколько цели просят сверх того, что удалось раздать. */
  remainingUnderfundedCents: number;
  /** Деньги кончились раньше целей — часть категорий осталась недофинансирована. */
  stoppedAtZeroRta: boolean;
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  type: string;
  balanceCents: number;
  clearedCents: number;
  unclearedCents: number;
}

export interface ReadyToAssignBreakdown {
  totalInflowCents: number;
  totalAssignedCents: number;
  readyToAssignCents: number;
  isOverAssigned: boolean;
}
