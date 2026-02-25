# Секция 4: REST API

## Промпт для Claude Code

```
Read all docs in the docs/ directory (section-1 through section-4).

Implement the REST API in apps/api using Hono + @hono/node-server.

### Step 1: apps/api setup

1. Create apps/api/package.json:
   {
     "name": "@pfm/api",
     "version": "0.1.0",
     "type": "module",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "start": "tsx src/index.ts",
       "build": "tsc",
       "test": "vitest run"
     },
     "dependencies": {
       "@pfm/engine": "workspace:*",
       "hono": "latest",
       "@hono/node-server": "latest"
     },
     "devDependencies": {
       "tsx": "latest",
       "vitest": "latest",
       "typescript": "latest"
     }
   }

2. Create apps/api/tsconfig.json extending ../../tsconfig.base.json
3. Create apps/api/vitest.config.ts
4. pnpm install from root

### Step 2: Implementation

5. Create apps/api/src/db.ts (import createDb from @pfm/engine)
6. Create apps/api/src/errors.ts (AppError class)
7. Create apps/api/src/app.ts (Hono + middleware + routes)
8. Create all route files in apps/api/src/routes/
9. Create apps/api/src/index.ts (entry point with @hono/node-server)

10. Write apps/api/tests/api.test.ts (use app.request())

11. pnpm db:migrate && pnpm db:seed
12. pnpm dev — start and test manually
13. Fix ALL errors.
```

---

## Entry Point: apps/api/src/index.ts

```typescript
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = parseInt(process.env.PORT ?? '3000');

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`
╔══════════════════════════════════╗
║       PFM API v0.1.0             ║
║  Zero-Based Budgeting Engine     ║
╚══════════════════════════════════╝
→ http://localhost:${info.port}
  `);
});
```

## DB: apps/api/src/db.ts

```typescript
import { createDb } from '@pfm/engine';
const dbPath = process.env.PFM_DB_PATH ?? './data/pfm.db';
export const db = createDb(dbPath);
```

## Errors: apps/api/src/errors.ts

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public suggestion = ''
  ) { super(message); }
}

export const notFound = (entity: string, id: string) =>
  new AppError('NOT_FOUND', `${entity} '${id}' not found`, 404,
    `Use GET /api/v1/${entity.toLowerCase()}s to list available IDs`);

export const validationError = (message: string) =>
  new AppError('VALIDATION_ERROR', message, 400, 'Check request body');
```

## App: apps/api/src/app.ts

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

export const app = new Hono();
app.use('*', cors());
app.use('*', logger());

app.onError((err, c) => {
  console.error(err);
  return c.json({
    error: {
      code: (err as any).code ?? 'INTERNAL_ERROR',
      message: err.message,
      suggestion: (err as any).suggestion ?? 'Check server logs'
    }
  }, (err as any).status ?? 500);
});

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Mount: accountRoutes, categoryRoutes, transactionRoutes, budgetRoutes
```

---

## Routes

All routes import from `@pfm/engine` and `../db.js`.

### accounts.ts

```
GET  /              → list with computed balances
POST /              → create (Zod validated)
GET  /:id           → single with balance
PATCH /:id          → update
DELETE /:id         → soft delete (isActive = false)
```

Zod: `{ name, type, onBudget?, currency?, note? }`
Auto-rule: `tracking` → `onBudget = false`
Response includes `balanceCents`, `clearedCents`, `unclearedCents`, `balanceFormatted`

### categories.ts

```
GET  /              → groups with nested categories (exclude hidden)
POST /groups        → create group
POST /              → create category
PATCH /:id          → update
DELETE /:id         → hide (isHidden = true)
```

### transactions.ts

```
GET  /              → list with filters (accountId, categoryId, since, until, limit)
POST /              → create regular or transfer (auto-detect)
GET  /:id           → single
PATCH /:id          → update (sync paired transfer)
DELETE /:id         → soft delete (+paired)
```

**Transfer** (when `transferAccountId` present):
1. Validate both accounts
2. Generate txId1, txId2
3. Insert tx1: source, `amountCents`, transfer fields, `categoryId: null`
4. Insert tx2: target, `-amountCents`, reverse transfer fields, `categoryId: null`
5. Return both

**Payee auto-create**: find/create by name, update `lastCategoryId`

### budget.ts

```
GET  /:month              → full state (getBudgetMonth), grouped by categoryGroup
POST /:month/assign       → { categoryId, amountCents }
POST /:month/move         → { fromCategoryId, toCategoryId, amountCents }
GET  /:month/ready-to-assign → breakdown
```

Response grouping: engine returns flat `categoryBudgets[]` → route groups by `groupId`.
All money fields include `*Formatted` via `formatMoney()`.

---

## Tests: apps/api/tests/api.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';

async function api(method: string, path: string, body?: any) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}
```

Test: health, accounts CRUD, transfer creation, budget state, error cases.