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
