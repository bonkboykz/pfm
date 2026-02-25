# PFM — Personal Finance Manager

Turborepo monorepo. YNAB-style zero-based budgeting engine + REST API + MCP.

## Structure

- `packages/engine` — @pfm/engine: core library (budget, math, db)
- `apps/api` — Hono REST server, depends on @pfm/engine
- `apps/mcp` — MCP server for AI agents (post-MVP)
- `packages/skill` — OpenClaw skill (curl-based API wrapper)

## Tech Stack

- Monorepo: Turborepo + pnpm workspaces
- Runtime: Node.js 22
- TS execution: tsx
- ORM: Drizzle + better-sqlite3
- Validation: Zod
- Money math: Decimal.js
- Testing: Vitest
- API: Hono + @hono/node-server

## Key Conventions

### Money

- Storage: integer cents/tiyns (150,000₸ = 15000000)
- Calculations: always Decimal.js, never raw JS arithmetic
- Display: formatMoney() only at API response layer
- APR: basis points (550 = 5.50%)
- Currency: ISO 4217, default KZT

### IDs

- Generator: cuid2
- System IDs (hardcoded, never change):
  - Category group "Inflow": `"inflow-group"`
  - Category "Ready to Assign": `"ready-to-assign"`

### Dates

- Transaction dates: YYYY-MM-DD
- Budget months: YYYY-MM
- Month boundaries: `"${month}-01"` to `"${month}-31"` (string comparison)

### Data Model Rules

- Account balances: COMPUTED from `SUM(transactions.amount_cents)`, never stored
- Category available: COMPUTED cumulatively (all assigned + all activity since epoch)
- Category activity: COMPUTED as `SUM(transactions)` per category per month
- Ready to Assign: `total_inflows - total_assigned` (all time through target month)
- Transfers: two paired transactions with opposite amounts, `category_id = null`
- Credit card purchases: on-budget, DO appear in category activity
- Transfers: DO NOT appear in category activity (`transfer_account_id IS NULL` filter)
- Soft delete: `is_deleted = true` (never physical delete)

### Engine Pattern

Every engine function takes `db: DB` as first argument (dependency injection):

```typescript
export function getBudgetMonth(db: DB, month: string): BudgetMonth { ... }
export function assignToCategory(db: DB, categoryId: string, month: string, amountCents: number): void { ... }
```

This lets apps/api, apps/mcp, and tests each create their own db instance.

### API Response Format

- Errors: `{ error: { code, message, suggestion } }`
- Money fields: always include both `*Cents` and `*Formatted` variants
  - `balanceCents: 15000000` + `balanceFormatted: "150 000 ₸"`
- Budget response: flat `categoryBudgets[]` from engine → grouped by `groupId` in route

### Testing

- Framework: Vitest
- DB in tests: `createDb(':memory:')` for isolation
- API tests: `app.request()` (no HTTP server needed)
- Seed test data in `beforeAll` block

## Commands (from root)

```bash
pnpm install          # Install all deps
pnpm dev              # Start API with tsx watch (via turbo)
pnpm test             # Run all tests (via turbo)
pnpm build            # Build all packages
pnpm db:migrate       # Create tables (packages/engine)
pnpm db:seed          # Populate test data (packages/engine)
```

## Spec Files (read these before implementing)

- `docs/section-1-spec.md` — Architecture, zero-based rules, tech stack
- `docs/section-2-schema.md` — Database schema, seed data
- `docs/section-3-budget-engine.md` — Budget computation algorithms
- `docs/section-4-rest-api.md` — REST API routes, Zod schemas
- `docs/section-5-assembly.md` — Build prompts, OpenClaw skill, deploy
- `docs/section-6a-debt-engine.md` — Debt payoff simulator (post-MVP)
- `docs/section-6b-mcp-server.md` — MCP server for AI agents (post-MVP)
- `docs/section-6c-csv-import.md` — Bank CSV import (post-MVP)
- `docs/section-6d-recurring.md` — Recurring transactions (post-MVP)
- `docs/section-6e-auth.md` — API key authentication (post-MVP)

## File Naming

- Schema: `packages/engine/src/db/schema.ts`
- DB connection: `packages/engine/src/db/index.ts` (exports `createDb`, `db`, `schema`)
- Engine: `packages/engine/src/budget/engine.ts`
- Money: `packages/engine/src/math/money.ts`
- API routes: `apps/api/src/routes/{resource}.ts`
- Tests: `{package}/tests/{module}.test.ts`