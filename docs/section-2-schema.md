# Секция 2: Database Schema

## Промпт для Claude Code

```
Read docs/section-1-spec.md and docs/section-2-schema.md.

Set up the Turborepo monorepo and implement the database layer in packages/engine.

### Step 1: Monorepo scaffolding

1. Create pnpm-workspace.yaml:
   packages:
     - 'packages/*'
     - 'apps/*'

2. Create root package.json:
   {
     "name": "pfm",
     "private": true,
     "scripts": {
       "dev": "turbo dev",
       "build": "turbo build",
       "test": "turbo test",
       "db:migrate": "pnpm --filter @pfm/engine db:migrate",
       "db:seed": "pnpm --filter @pfm/engine db:seed"
     },
     "devDependencies": {
       "turbo": "latest",
       "typescript": "latest"
     }
   }

3. Create turbo.json:
   {
     "$schema": "https://turbo.build/schema.json",
     "tasks": {
       "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
       "dev": { "cache": false, "persistent": true },
       "test": { "dependsOn": ["^build"] },
       "db:migrate": { "cache": false },
       "db:seed": { "cache": false }
     }
   }

4. Create tsconfig.base.json:
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ES2022",
       "moduleResolution": "bundler",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true
     }
   }

5. Run `pnpm install` from root.

### Step 2: packages/engine

6. Create packages/engine/package.json:
   {
     "name": "@pfm/engine",
     "version": "0.1.0",
     "type": "module",
     "main": "src/index.ts",
     "types": "src/index.ts",
     "scripts": {
       "build": "tsc",
       "test": "vitest run",
       "test:watch": "vitest",
       "db:migrate": "tsx src/db/migrate.ts",
       "db:seed": "tsx src/db/seed.ts"
     },
     "dependencies": {
       "drizzle-orm": "latest",
       "better-sqlite3": "latest",
       "decimal.js": "latest",
       "zod": "latest",
       "@paralleldrive/cuid2": "latest"
     },
     "devDependencies": {
       "drizzle-kit": "latest",
       "@types/better-sqlite3": "latest",
       "tsx": "latest",
       "vitest": "latest",
       "typescript": "latest"
     }
   }

7. Create packages/engine/tsconfig.json:
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "dist",
       "rootDir": "src"
     },
     "include": ["src/**/*.ts"],
     "exclude": ["node_modules", "dist", "tests"]
   }

8. Implement packages/engine/src/db/schema.ts — ALL tables as specified
9. Create packages/engine/src/db/index.ts — better-sqlite3 + drizzle
10. Create packages/engine/src/db/migrate.ts
11. Create packages/engine/src/db/seed.ts — full KZ data
12. Create packages/engine/src/index.ts — re-export everything

13. Run: pnpm db:migrate && pnpm db:seed
    Verify no errors.
```

---

## Schema: packages/engine/src/db/schema.ts

### accounts

```typescript
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking']
  }).notNull(),
  onBudget: integer('on_budget', { mode: 'boolean' }).notNull().default(true),
  currency: text('currency').notNull().default('KZT'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

### categoryGroups + categories

```typescript
export const categoryGroups = sqliteTable('category_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  groupId: text('group_id').notNull().references(() => categoryGroups.id),
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  targetAmountCents: integer('target_amount_cents'),
  targetType: text('target_type', {
    enum: ['none', 'monthly_funding', 'target_balance', 'target_by_date']
  }).default('none'),
  targetDate: text('target_date'),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

Системные записи (hardcoded IDs):
- CategoryGroup: `{ id: "inflow-group", name: "Inflow", isSystem: true }`
- Category: `{ id: "ready-to-assign", groupId: "inflow-group", name: "Ready to Assign", isSystem: true }`

### payees

```typescript
export const payees = sqliteTable('payees', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull().unique(),
  lastCategoryId: text('last_category_id').references(() => categories.id),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
```

### transactions

```typescript
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  accountId: text('account_id').notNull().references(() => accounts.id),
  date: text('date').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payeeId: text('payee_id').references(() => payees.id),
  payeeName: text('payee_name'),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  transferTransactionId: text('transfer_transaction_id'),
  memo: text('memo'),
  cleared: text('cleared', {
    enum: ['uncleared', 'cleared', 'reconciled']
  }).notNull().default('uncleared'),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(true),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_tx_account_date').on(table.accountId, table.date),
  index('idx_tx_category').on(table.categoryId),
  index('idx_tx_date').on(table.date),
  index('idx_tx_transfer').on(table.transferTransactionId),
]);
```

### monthlyBudgets

```typescript
export const monthlyBudgets = sqliteTable('monthly_budgets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  categoryId: text('category_id').notNull().references(() => categories.id),
  month: text('month').notNull(),
  assignedCents: integer('assigned_cents').notNull().default(0),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_budget_cat_month').on(table.categoryId, table.month),
]);
```

---

## DB Connection: packages/engine/src/db/index.ts

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

export function createDb(dbPath = './data/pfm.db') {
  // ':memory:' для тестов — не нужен mkdir
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export const db = createDb();
export type DB = ReturnType<typeof createDb>;
export { schema };
```

---

## Seed

```
ACCOUNTS (4): Kaspi Gold, Halyk Текущий, Kaspi Red (credit_card), Наличные
CATEGORIES (12): Аренда, Коммунальные, Интернет, Продукты, Транспорт, Кафе, Развлечения, Kaspi Red iPhone, Халық кредит, Подушка безопасности, Отпуск
TRANSACTIONS (8): salary +500k, rent -150k, groceries -8.5k/-12k, eating -4.5k, transfer -150k pair, loan -85k, Glovo via credit -5k
BUDGET (585k assigned): over-assigned by 85k (intentional)
```

Важно:
- Системные категории с фиксированными ID
- Трансфер = два tx, opposite amounts, `categoryId: null`
- Idempotent: DELETE FROM в правильном порядке перед INSERT
- Суммы в тийынах: 150,000₸ = `15000000`