# Секция 6D: Recurring Transactions

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6d-recurring.md.

Add scheduled/recurring transactions to packages/engine and apps/api.

1. Add scheduledTransactions table to packages/engine/src/db/schema.ts
2. Create packages/engine/src/db/migrate.ts update (add new table)
3. Create packages/engine/src/scheduler/types.ts
4. Create packages/engine/src/scheduler/engine.ts
5. Re-export from packages/engine/src/index.ts

6. Create apps/api/src/routes/scheduled.ts — CRUD + process
7. Mount under /api/v1/scheduled

8. Write packages/engine/tests/scheduler.test.ts
9. Update packages/skill/SKILL.md
10. Update seed with example recurring transactions

Run pnpm test, fix all failures.
```

---

## Schema Addition

```typescript
export const scheduledTransactions = sqliteTable('scheduled_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  accountId: text('account_id').notNull().references(() => accounts.id),
  frequency: text('frequency', {
    enum: ['weekly', 'biweekly', 'monthly', 'yearly']
  }).notNull(),
  nextDate: text('next_date').notNull(),           // YYYY-MM-DD
  amountCents: integer('amount_cents').notNull(),
  payeeName: text('payee_name'),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  memo: text('memo'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_sched_next_date').on(table.nextDate),
  index('idx_sched_active').on(table.isActive),
]);
```

---

## Types: packages/engine/src/scheduler/types.ts

```typescript
export interface ScheduledTransaction {
  id: string;
  accountId: string;
  accountName: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  nextDate: string;
  amountCents: number;
  amountFormatted: string;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferAccountId: string | null;
  transferAccountName: string | null;
  memo: string | null;
  isActive: boolean;
}

export interface ProcessResult {
  created: number;
  transactions: { id: string; scheduledId: string; date: string }[];
  errors: { scheduledId: string; message: string }[];
}
```

---

## Engine: packages/engine/src/scheduler/engine.ts

### getUpcoming(db, daysAhead = 7) → ScheduledTransaction[]

```sql
SELECT st.*, a.name as account_name, c.name as category_name,
       ta.name as transfer_account_name
FROM scheduled_transactions st
JOIN accounts a ON a.id = st.account_id
LEFT JOIN categories c ON c.id = st.category_id
LEFT JOIN accounts ta ON ta.id = st.transfer_account_id
WHERE st.is_active = 1
  AND st.next_date <= date(:today, '+' || :daysAhead || ' days')
ORDER BY st.next_date
```

### processDue(db, asOfDate?) → ProcessResult

```
1. Get all active scheduled where nextDate <= asOfDate (default: today)
2. For each:
   a. Create transaction (or transfer pair if transferAccountId present)
      - date = scheduled.nextDate
      - cleared = 'uncleared'
      - memo = scheduled.memo + " (auto)"
   b. Advance nextDate:
      weekly:     +7 days
      biweekly:   +14 days
      monthly:    same day next month (handle month-end: 31→28)
      yearly:     same date next year (handle Feb 29)
   c. Update scheduled.nextDate
3. Return { created, transactions, errors }
```

### advanceDate(currentDate, frequency) → string

```typescript
function advanceDate(current: string, freq: Frequency): string {
  const d = new Date(current + 'T00:00:00');
  switch (freq) {
    case 'weekly':   d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly':
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      // If overflowed (e.g., Jan 31 → Mar 3), go to last day of intended month
      if (d.getDate() < day) d.setDate(0);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      if (d.getDate() !== new Date(current + 'T00:00:00').getDate()) d.setDate(0);
      break;
  }
  return d.toISOString().split('T')[0];
}
```

---

## API Routes: apps/api/src/routes/scheduled.ts

### GET /api/v1/scheduled

```typescript
// Query: ?upcoming=7 (days ahead, default: show all active)
// Response
{
  "scheduled": [
    {
      "id": "...",
      "accountName": "Kaspi Gold",
      "frequency": "monthly",
      "nextDate": "2026-03-01",
      "amountCents": -15000000,
      "amountFormatted": "-150 000 ₸",
      "payeeName": "Арендодатель",
      "categoryName": "Аренда",
      "isActive": true
    }
  ]
}
```

### POST /api/v1/scheduled

```typescript
// Request
{
  "accountId": "...",
  "frequency": "monthly",
  "nextDate": "2026-03-01",
  "amountCents": -15000000,
  "payeeName": "Арендодатель",
  "categoryId": "cat-rent",
  "memo": "Аренда квартиры"
}
```

Zod:
```typescript
z.object({
  accountId: z.string(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
  payeeName: z.string().optional(),
  categoryId: z.string().optional(),
  transferAccountId: z.string().optional(),
  memo: z.string().optional(),
})
```

### PATCH /api/v1/scheduled/:id

Update any field.

### DELETE /api/v1/scheduled/:id

Set `isActive = false`.

### POST /api/v1/scheduled/process

Trigger: create all due transactions.

```typescript
// Request (optional)
{ "asOfDate": "2026-02-25" }   // default: today

// Response
{
  "created": 3,
  "transactions": [
    { "id": "tx-1", "scheduledId": "sched-1", "date": "2026-02-25" }
  ],
  "errors": []
}
```

---

## Seed Data (add to existing seed)

```
SCHEDULED TRANSACTIONS:
  1. Зарплата: +500k, monthly, 1st of month, Kaspi Gold → ready-to-assign
  2. Аренда: -150k, monthly, 5th, Kaspi Gold → Аренда
  3. Интернет: -5k, monthly, 15th, Kaspi Gold → Интернет
  4. Kaspi Red: -150k, monthly, 20th, Kaspi Gold → transfer to Kaspi Red
  5. Халық кредит: -85k, monthly, 25th, Halyk → Халық кредит
```

---

## Test Scenarios

1. **Process creates transactions**: schedule monthly -150k, process on due date → tx created
2. **Advance date monthly**: Jan 31 → Feb 28 (not Mar 3)
3. **Advance date yearly**: Feb 29 2028 → Feb 28 2029
4. **Transfer scheduled**: creates paired transactions
5. **Already advanced**: processing same day twice doesn't duplicate
6. **Inactive skipped**: deactivated schedule not processed
7. **Upcoming filter**: daysAhead=7 only shows next week's

---

## SKILL.md Addition

```bash
## Recurring Transactions

# List upcoming (next 7 days)
curl -s "$PFM_API_URL/api/v1/scheduled?upcoming=7" | jq

# Create monthly expense
curl -s -X POST "$PFM_API_URL/api/v1/scheduled" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId":"ACCOUNT_ID",
    "frequency":"monthly",
    "nextDate":"2026-03-01",
    "amountCents":-15000000,
    "payeeName":"Арендодатель",
    "categoryId":"CATEGORY_ID"
  }' | jq

# Process all due transactions
curl -s -X POST "$PFM_API_URL/api/v1/scheduled/process" | jq
```