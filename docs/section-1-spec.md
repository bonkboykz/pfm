# Секция 1: Спецификация и архитектура

## Что строим

**PFM** (Personal Finance Manager) — Turborepo монорепо с YNAB-подобным zero-based budgeting engine, REST API, MCP сервером и OpenClaw skill.

### Zero-Based Budgeting (как в YNAB)

Каждый тенге дохода назначается в категорию. Пока "Ready to Assign" ≠ 0, бюджет не сбалансирован.

```
Зарплата 500,000₸ →  Ready to Assign = 500,000₸

Назначаю:
  Аренда:        150,000₸
  Продукты:       80,000₸
  Транспорт:      30,000₸
  Kaspi Red:     150,000₸
  Накопления:     90,000₸
                 ─────────
  Ready to Assign = 0₸  ✅
```

### Ключевые сущности

```
Account          — банковский счёт / карта / кредитка / наличные
  ↓ has many
Transaction      — операция (inflow/outflow), привязана к категории
  ↓ categorized by
Category         — конверт ("Продукты", "Аренда", "Kaspi Red")
  ↓ grouped by
CategoryGroup    — группа конвертов ("Постоянные", "Переменные", "Долги")

MonthlyBudget    — назначение: сколько положено в конверт в данном месяце
Payee            — получатель платежа (авто-категоризация по последнему использованию)
```

### Что вычисляется, а не хранится

| Поле | Откуда |
|------|--------|
| Account balance | `SUM(transactions.amount)` для данного счёта |
| Category activity | `SUM(transactions.amount)` для категории за месяц |
| Category available | Кумулятивно: все assigned + все activity с начала времён |
| Ready to Assign | Total inflows - Total assigned |

### Трансферы

Два связанных transaction:
- Source account: -100,000₸, Target account: +100,000₸
- Оба имеют `transferAccountId` и `transferTransactionId`
- Категория = null (не расходует бюджет)

### Кредитные карты

Кредитка — on-budget account с отрицательным балансом.
Покупка по кредитке: transaction на кредитном счёте + category activity.
Погашение = трансфер (не расходует бюджет).

---

## Tech Stack

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Monorepo | **Turborepo + pnpm workspaces** | Кэширование, параллельные билды |
| Runtime | **Node.js 22** | LTS, стабильный, широкая совместимость |
| Package manager | **pnpm** | Быстрый, strict, workspace protocol |
| TS execution | **tsx** | Запуск TypeScript без компиляции |
| Framework | **Hono + @hono/node-server** | Минималистичный, type-safe |
| ORM | **Drizzle + better-sqlite3** | Type-safe SQL, SQLite→PostgreSQL миграция |
| Database | **SQLite (better-sqlite3)** | Zero ops, проверенная native библиотека |
| Validation | **Zod** | Единая схема для API + types |
| Money math | **Decimal.js** | Точные вычисления |
| IDs | **cuid2** | URL-safe, sortable |
| Testing | **Vitest** | Быстрый, Jest-совместимый, watch mode |

---

## Monorepo Structure

```
pfm/
├── apps/
│   ├── api/                        # Hono REST server
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── accounts.ts
│   │   │   │   ├── categories.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   └── budget.ts
│   │   │   ├── errors.ts
│   │   │   ├── app.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── api.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp/                        # MCP server (post-MVP)
│       └── ...
│
├── packages/
│   ├── engine/                     # @pfm/engine — core library
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   └── seed.ts
│   │   │   ├── budget/
│   │   │   │   ├── engine.ts
│   │   │   │   └── types.ts
│   │   │   ├── math/
│   │   │   │   └── money.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── budget.test.ts
│   │   │   └── money.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── skill/                      # OpenClaw skill (curl-based)
│       ├── SKILL.md
│       └── _meta.json
│
├── docs/                           # These spec files
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── CLAUDE.md
└── .gitignore
```

### Зависимости

```
@pfm/engine (packages/engine)
  ├── drizzle-orm + better-sqlite3
  ├── decimal.js, zod, @paralleldrive/cuid2

@pfm/api (apps/api)
  ├── @pfm/engine (workspace:*)
  ├── hono + @hono/node-server

@pfm/mcp (apps/mcp) [post-MVP]
  ├── @pfm/engine (workspace:*)
  └── @modelcontextprotocol/sdk
```

---

## CLAUDE.md

```markdown
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
- Money: integer cents/tiyns (150,000₸ = 15000000). Use Decimal.js for math.
- APR: basis points (550 = 5.50%)
- IDs: cuid2
- Transaction dates: YYYY-MM-DD. Budget months: YYYY-MM
- Currency: ISO 4217, default KZT
- Account balances: COMPUTED from SUM(transactions), never stored
- Category available: COMPUTED cumulatively, never stored
- Transfers: two paired transactions, categoryId = null
- Errors: { code, message, suggestion }

## System IDs (hardcoded)
- Category group "Inflow": id = "inflow-group"
- Category "Ready to Assign": id = "ready-to-assign"

## Commands (from root)
- `pnpm install` — Install all deps
- `pnpm dev` — Start API with watch (via turbo)
- `pnpm test` — Run all tests (via turbo)
- `pnpm db:migrate` — Create tables
- `pnpm db:seed` — Populate test data
- `pnpm build` — Build all packages

## Spec Files
- docs/section-1-spec.md — Architecture, zero-based rules
- docs/section-2-schema.md — Database schema, seed data
- docs/section-3-budget-engine.md — Budget computation algorithms
- docs/section-4-rest-api.md — REST API routes, Zod schemas
- docs/section-5-assembly.md — Build prompts, OpenClaw skill
```