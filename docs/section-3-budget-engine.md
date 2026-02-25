# Секция 3: Budget Engine

## Промпт для Claude Code

```
Read docs/section-1-spec.md, docs/section-2-schema.md, and docs/section-3-budget-engine.md.

Implement the budget engine and money math in packages/engine.

1. Create packages/engine/src/math/money.ts — ALL functions from spec
2. Create packages/engine/src/budget/types.ts — all interfaces
3. Create packages/engine/src/budget/engine.ts — ALL functions with db injection
4. Update packages/engine/src/index.ts — re-export everything

5. Write packages/engine/tests/money.test.ts (vitest)
6. Write packages/engine/tests/budget.test.ts:
   - Use createDb(':memory:') for isolated tests
   - Seed test data in beforeAll
   - Test all scenarios from spec

7. Create packages/engine/vitest.config.ts:
   import { defineConfig } from 'vitest/config';
   export default defineConfig({ test: { globals: true } });

Run `pnpm test` from packages/engine, fix ALL failures.
```

---

## Types: packages/engine/src/budget/types.ts

```typescript
export interface CategoryBudget {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  assignedCents: number;       // This month
  activityCents: number;       // This month (negative = spending)
  availableCents: number;      // Cumulative all time
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
```

---

## Engine: packages/engine/src/budget/engine.ts

Every function takes `db: DB` as first argument (DI pattern).

### getBudgetMonth(db, month) → BudgetMonth

**Step 1**: Load non-system, non-hidden categories with groups
```sql
SELECT c.id, c.name, c.group_id, cg.name as group_name,
       c.target_amount_cents, c.target_type
FROM categories c JOIN category_groups cg ON c.group_id = cg.id
WHERE c.is_system = 0 AND c.is_hidden = 0
ORDER BY cg.sort_order, c.sort_order
```

**Step 2**: Assigned THIS month
```sql
SELECT category_id, assigned_cents FROM monthly_budgets WHERE month = :month
```

**Step 3**: Activity THIS month (on-budget, not deleted, not transfers, not system)
```sql
SELECT t.category_id, SUM(t.amount_cents) as activity
FROM transactions t JOIN accounts a ON a.id = t.account_id
WHERE a.on_budget = 1 AND t.is_deleted = 0
  AND t.category_id IS NOT NULL AND t.category_id != 'ready-to-assign'
  AND t.transfer_account_id IS NULL
  AND t.date >= :monthStart AND t.date <= :monthEnd
GROUP BY t.category_id
```

**Step 4**: Available (cumulative assigned + cumulative activity through this month)
```sql
-- Cumulative assigned
SELECT category_id, SUM(assigned_cents) FROM monthly_budgets WHERE month <= :month GROUP BY category_id

-- Cumulative activity
SELECT t.category_id, SUM(t.amount_cents)
FROM transactions t JOIN accounts a ON a.id = t.account_id
WHERE a.on_budget = 1 AND t.is_deleted = 0
  AND t.category_id IS NOT NULL AND t.category_id != 'ready-to-assign'
  AND t.transfer_account_id IS NULL AND t.date <= :monthEnd
GROUP BY t.category_id
```

`availableCents = cumulativeAssigned + cumulativeActivity`

**Step 5**: Ready to Assign = total inflows - total assigned (all time through this month)

**Step 6**: Assemble result

### assignToCategory(db, categoryId, month, amountCents)

Upsert monthly_budget: SELECT → UPDATE or INSERT. Validate: exists, not system, amount >= 0.

### moveBetweenCategories(db, fromId, toId, month, amountCents)

Check from.available >= amount, then adjust both assigned values.

### getAccountBalances(db) → AccountBalance[]

```sql
SELECT a.id, a.name, a.type,
  SUM(CASE WHEN t.cleared IN ('cleared','reconciled') THEN t.amount_cents ELSE 0 END) as cleared,
  SUM(CASE WHEN t.cleared = 'uncleared' THEN t.amount_cents ELSE 0 END) as uncleared
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.is_deleted = 0
WHERE a.is_active = 1 GROUP BY a.id
```

### getReadyToAssign(db, month) → ReadyToAssignBreakdown

---

## Key Rules

- **Decimal.js** for all intermediate sums, `.toNumber()` at the end
- **Month boundaries**: `monthStart = "${month}-01"`, `monthEnd = "${month}-31"`
- **Transfers excluded**: `WHERE t.transfer_account_id IS NULL`
- **Credit card purchases counted**: they have categoryId → appear in activity
- **db injection**: every function takes `db` so apps can pass their own instance

---

## Test Scenarios (Vitest)

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createDb } from '../src/db/index.js';
// ... import engine functions, seed helpers
```

1. **Seed data**: `getBudgetMonth("2026-02")` → readyToAssign = -8500000
2. **Assign upsert**: create then update same category/month
3. **Move**: groceries→eating, verify both assigned changed
4. **Balances**: Kaspi Gold positive, Halyk negative, Kaspi Red positive, Cash 0
5. **Transfers invisible**: 150k transfer not in any category activity
6. **Multi-month rollover**: Jan available carries to Feb