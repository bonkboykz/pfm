# Секция 5: Сборочный промпт + OpenClaw Skill + Post-MVP

## Как использовать

### Вариант A: Пошагово (рекомендуется)

```
Сессия 1: Промпт из section-2 → monorepo init, packages/engine (schema, db, seed)
Сессия 2: Промпт из section-3 → packages/engine (budget engine, math, tests)
Сессия 3: Промпт из section-4 → apps/api (routes, tests, manual verify)
```

### Вариант B: Один проход

Используй единый промпт ниже.

---

## Подготовка

```bash
mkdir pfm && cd pfm
mkdir docs
# Скопируй section-1 через section-5 .md файлы в docs/
# Скопируй CLAUDE.md из секции 1 в корень
```

---

## Единый сборочный промпт

```
Read ALL files in docs/ directory in order: section-1 through section-5.

Build the PFM project — Turborepo monorepo, Node 22, pnpm.

### Phase 1: Monorepo Scaffolding

1. pnpm-workspace.yaml (packages/*, apps/*)
2. Root package.json (name: pfm, private, turbo scripts)
3. pnpm add -Dw turbo typescript
4. turbo.json (build, dev, test, db:migrate, db:seed tasks)
5. tsconfig.base.json (ES2022, bundler, strict, declaration)

### Phase 2: packages/engine

6. package.json: @pfm/engine, deps: drizzle-orm, better-sqlite3, decimal.js, zod, cuid2
   DevDeps: drizzle-kit, @types/better-sqlite3, tsx, vitest, typescript
7. tsconfig.json extending ../../tsconfig.base.json
8. vitest.config.ts
9. src/db/schema.ts — ALL tables from section-2
10. src/db/index.ts — better-sqlite3, WAL, FK, createDb() with :memory: support
11. src/db/migrate.ts
12. src/db/seed.ts — full KZ scenario from section-2
13. src/math/money.ts — all functions from section-3
14. src/budget/types.ts — all interfaces
15. src/budget/engine.ts — all functions with db injection
16. src/index.ts — re-export everything
17. tests/money.test.ts
18. tests/budget.test.ts (createDb(':memory:'))
19. pnpm install && pnpm db:migrate && pnpm db:seed
20. cd packages/engine && pnpm test — fix all failures

### Phase 3: apps/api

21. package.json: @pfm/api, deps: @pfm/engine workspace:*, hono, @hono/node-server
    DevDeps: tsx, vitest, typescript
22. tsconfig.json, vitest.config.ts
23. src/db.ts — createDb with env var
24. src/errors.ts — AppError
25. src/app.ts — Hono + CORS + logger + error handler + routes
26. src/routes/accounts.ts
27. src/routes/categories.ts
28. src/routes/transactions.ts — including transfer logic
29. src/routes/budget.ts — grouped + formatted
30. src/index.ts — serve() from @hono/node-server
31. tests/api.test.ts
32. pnpm test — fix all failures

### Phase 4: Verify

33. pnpm db:migrate && pnpm db:seed
34. pnpm test (all packages)
35. pnpm dev
36. curl http://localhost:3000/health
37. curl http://localhost:3000/api/v1/accounts
38. curl http://localhost:3000/api/v1/budget/2026-02
39. Fix ANY errors.

### Rules
- Node 22 + tsx (NOT Bun)
- better-sqlite3 (NOT bun:sqlite)
- Vitest (NOT bun test / jest)
- @hono/node-server serve() (NOT export default)
- Every engine function takes db: DB as first param
- Decimal.js for money math
- Transfers = paired transactions, categoryId null
- System categories: "inflow-group", "ready-to-assign" (hardcoded IDs)
```

---

## OpenClaw Skill: packages/skill/SKILL.md

Скилл учит OpenClaw-агента работать с **задеплоенным REST API** через curl.

### packages/skill/_meta.json

```json
{
  "name": "pfm-budget",
  "version": "0.1.0",
  "description": "Zero-based budgeting (YNAB-style) via REST API. Track accounts, transactions, envelope budgets."
}
```

### packages/skill/SKILL.md

```yaml
---
name: pfm-budget
description: >
  Zero-based envelope budgeting (YNAB-style) via REST API. Track accounts,
  transactions, categories, budget assignments. Use when user asks about
  budgeting, expense tracking, "сколько осталось", "куда ушли деньги",
  account balances, financial planning, debt tracking, Kaspi, transfers.
version: 0.1.0
metadata:
  openclaw:
    emoji: "💰"
    requires:
      bins: [curl, jq]
      env: [PFM_API_URL]
    primaryEnv: PFM_API_URL
---

# PFM Budget Engine

Zero-based (envelope) budgeting via REST API. Every tenge of income is
assigned to a category. Budget balanced when Ready to Assign = 0.

**API Base**: `$PFM_API_URL` (e.g. `http://localhost:3000`)

---

## Health Check

```bash
curl -s "$PFM_API_URL/health" | jq
```

---

## Accounts

### List all accounts with balances

```bash
curl -s "$PFM_API_URL/api/v1/accounts" | jq
```

Returns: `{ accounts: [{ id, name, type, balanceCents, balanceFormatted, ... }] }`

### Create account

```bash
curl -s -X POST "$PFM_API_URL/api/v1/accounts" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kaspi Gold",
    "type": "checking",
    "currency": "KZT"
  }' | jq
```

Types: `checking`, `savings`, `credit_card`, `cash`, `line_of_credit`, `tracking`

### Get single account

```bash
curl -s "$PFM_API_URL/api/v1/accounts/{id}" | jq
```

---

## Categories

### List all category groups with categories

```bash
curl -s "$PFM_API_URL/api/v1/categories" | jq
```

Returns nested structure: `{ categoryGroups: [{ id, name, categories: [...] }] }`

### Create category group

```bash
curl -s -X POST "$PFM_API_URL/api/v1/categories/groups" \
  -H "Content-Type: application/json" \
  -d '{"name": "Постоянные расходы"}' | jq
```

### Create category

```bash
curl -s -X POST "$PFM_API_URL/api/v1/categories" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "GROUP_ID",
    "name": "Продукты",
    "targetType": "monthly_funding",
    "targetAmountCents": 8000000
  }' | jq
```

Target types:
- `none` — no goal
- `monthly_funding` — assign X every month (rent, utilities)
- `target_balance` — save up to X total (emergency fund)
- `target_by_date` — save X by YYYY-MM (vacation)

---

## Transactions

### List transactions

```bash
# All transactions
curl -s "$PFM_API_URL/api/v1/transactions" | jq

# Filter by account
curl -s "$PFM_API_URL/api/v1/transactions?accountId={id}" | jq

# Filter by date range
curl -s "$PFM_API_URL/api/v1/transactions?since=2026-02-01&until=2026-02-28" | jq

# Filter by category
curl -s "$PFM_API_URL/api/v1/transactions?categoryId={id}" | jq
```

### Create expense transaction

```bash
curl -s -X POST "$PFM_API_URL/api/v1/transactions" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "ACCOUNT_ID",
    "date": "2026-02-24",
    "amountCents": -850000,
    "payeeName": "Magnum",
    "categoryId": "CATEGORY_ID",
    "memo": "Продукты на неделю"
  }' | jq
```

- Positive amountCents = income (inflow)
- Negative amountCents = expense (outflow)

### Create income transaction

Income goes to "Ready to Assign" category:

```bash
curl -s -X POST "$PFM_API_URL/api/v1/transactions" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "ACCOUNT_ID",
    "date": "2026-02-01",
    "amountCents": 50000000,
    "payeeName": "ТОО Работодатель",
    "categoryId": "ready-to-assign",
    "memo": "Зарплата февраль"
  }' | jq
```

### Create transfer between accounts

```bash
curl -s -X POST "$PFM_API_URL/api/v1/transactions" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "SOURCE_ACCOUNT_ID",
    "date": "2026-02-15",
    "amountCents": -15000000,
    "transferAccountId": "TARGET_ACCOUNT_ID",
    "memo": "Погашение Kaspi Red"
  }' | jq
```

Note: transfers automatically create TWO paired transactions. No category needed.

### Delete transaction

```bash
curl -s -X DELETE "$PFM_API_URL/api/v1/transactions/{id}" | jq
```

Soft-deletes. If part of a transfer, deletes both sides.

---

## Budget

### Get full budget state for a month

```bash
curl -s "$PFM_API_URL/api/v1/budget/2026-02" | jq
```

Returns:
```json
{
  "month": "2026-02",
  "readyToAssignCents": -8500000,
  "readyToAssignFormatted": "-85 000 ₸",
  "isOverAssigned": true,
  "categoryGroups": [
    {
      "groupName": "Постоянные расходы",
      "categories": [
        {
          "categoryName": "Аренда",
          "assignedCents": 15000000,
          "assignedFormatted": "150 000 ₸",
          "activityCents": -15000000,
          "activityFormatted": "-150 000 ₸",
          "availableCents": 0,
          "availableFormatted": "0 ₸",
          "isOverspent": false
        }
      ]
    }
  ]
}
```

### Assign money to a category

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/2026-02/assign" \
  -H "Content-Type: application/json" \
  -d '{
    "categoryId": "CATEGORY_ID",
    "amountCents": 8000000
  }' | jq
```

### Move money between categories

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/2026-02/move" \
  -H "Content-Type: application/json" \
  -d '{
    "fromCategoryId": "FROM_ID",
    "toCategoryId": "TO_ID",
    "amountCents": 1000000
  }' | jq
```

### Get Ready to Assign breakdown

```bash
curl -s "$PFM_API_URL/api/v1/budget/2026-02/ready-to-assign" | jq
```

---

## Money Convention

All amounts are in **integer cents** (tiyns for KZT):
- 150,000₸ = `15000000` cents
- 8,500₸ = `850000` cents
- $10.50 = `1050` cents

Response fields include both raw cents and formatted strings:
- `balanceCents: 15000000` + `balanceFormatted: "150 000 ₸"`

## Error Responses

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Account 'abc123' not found",
    "suggestion": "Use GET /api/v1/accounts to list available IDs"
  }
}
```

## Typical Workflows

### "Сколько у меня денег?"
1. `GET /api/v1/accounts` → show balances

### "Сколько осталось в бюджете на продукты?"
1. `GET /api/v1/budget/2026-02` → find "Продукты" → show availableFormatted

### "Записать расход 4500 на кафе"
1. `GET /api/v1/accounts` → find the right account
2. `GET /api/v1/categories` → find "Кафе" category
3. `POST /api/v1/transactions` → create expense

### "Перевести 50k на подушку безопасности с Kaspi"
Two options:
a) Transfer between accounts: `POST /transactions` with `transferAccountId`
b) Move budget: `POST /budget/2026-02/move` between categories
```

---

## Deploy (для работы скилла)

API нужно задеплоить, чтобы `PFM_API_URL` был доступен агенту.

### Вариант 1: Локально

```bash
cd pfm
pnpm install && pnpm db:migrate && pnpm db:seed
pnpm dev
# PFM_API_URL=http://localhost:3000
```

### Вариант 2: Railway / Fly.io

```bash
# Railway
railway init
railway up
# PFM_API_URL=https://pfm-production-xxx.up.railway.app

# Fly.io
fly launch
fly deploy
# PFM_API_URL=https://pfm.fly.dev
```

### Вариант 3: VPS

```bash
git clone ... && cd pfm
pnpm install && pnpm db:migrate && pnpm db:seed
PORT=3000 pnpm start
# Reverse proxy через nginx/caddy
```

### OpenClaw configuration

```json
// ~/.openclaw/openclaw.json
{
  "skills": {
    "entries": {
      "pfm-budget": {
        "enabled": true,
        "env": {
          "PFM_API_URL": "http://localhost:3000"
        }
      }
    }
  }
}
```

---

## Post-MVP Промпты

### 6A: Debt Payoff Engine

```
Add debt simulation to packages/engine.

src/debt/types.ts: DebtSnapshot, PayoffStrategy, PayoffSimulationResult
src/debt/simulator.ts: simulatePayoff(debts, strategy, extraMonthly)
  Strategies: snowball, avalanche, highest_monthly_interest, cash_flow_index
  Handle 0% installments (Kaspi Red), credit card minimums
src/debt/analyzer.ts: compareStrategies(), debtVsInvest()

Add routes to apps/api:
  POST /api/v1/simulate/payoff
  POST /api/v1/simulate/compare
  POST /api/v1/simulate/debt-vs-invest

Update SKILL.md with new curl examples.
Tests with vitest.
```

### 6B: MCP Server

```
Create apps/mcp — MCP server for AI agents.

pnpm add @modelcontextprotocol/sdk --filter @pfm/mcp

9 tools: list_accounts, list_categories, get_budget, assign_budget,
add_transaction, list_transactions, get_ready_to_assign,
simulate_debt_payoff, compare_debt_strategies

Entry: stdio transport.
"mcp": "tsx apps/mcp/src/server.ts" in root scripts.
```

### 6C: CSV Import

```
Add bank CSV import to packages/engine.
src/import/csv.ts: parseCSV(), auto-detect Kaspi/Halyk formats, Windows-1251
src/import/duplicates.ts: detectDuplicates()

Routes: POST /api/v1/import/csv, POST /api/v1/import/confirm
Update SKILL.md.
```

### 6D: Recurring Transactions

```
Add scheduled_transactions table to schema.
src/scheduler/engine.ts: getUpcoming(), processDue()

Routes: CRUD /api/v1/scheduled + POST /api/v1/scheduled/process
Update SKILL.md.
```

### 6E: Auth (если деплоим публично)

```
Add API key authentication middleware.
apps/api/src/middleware/auth.ts: Bearer token from PFM_API_KEY env var
Apply to all /api/v1/* routes.
Update SKILL.md: requires env PFM_API_KEY.
```

---

## Полная структура

```
pfm/
├── CLAUDE.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
├── .gitignore
│
├── docs/
│   └── section-*.md
│
├── packages/
│   ├── engine/                   # @pfm/engine
│   │   ├── src/
│   │   │   ├── db/               # schema, index, migrate, seed
│   │   │   ├── budget/           # types, engine
│   │   │   ├── math/             # money
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── vitest.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── skill/                    # OpenClaw skill
│       ├── SKILL.md              # curl-based instructions
│       └── _meta.json
│
├── apps/
│   ├── api/                      # @pfm/api
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── errors.ts
│   │   │   ├── app.ts
│   │   │   ├── db.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── vitest.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp/                      # post-MVP
│       └── ...
│
└── data/                         # gitignored
    └── pfm.db
```

## .gitignore

```
node_modules/
dist/
data/
*.db
*.db-wal
*.db-shm
.env
.turbo/
```