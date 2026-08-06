# PFM — Personal Finance Manager

Turborepo monorepo. YNAB-style zero-based budgeting engine + REST API + MCP.

## Держать Plane актуальным (обязательно)

Проект ведётся в **self-hosted Plane** (`https://plane.team.rama.gg`), workspace `personal`,
проект **PFM** (identifier `PFM`, project_id `0ebd8a57-954d-4ed3-8e50-eac55980ea22`).
Синхронизируй через **Plane MCP** по ходу работы:

- **Начал** крупную задачу → переведи её в **In Progress** (`update_work_item`, поле `state`).
- **Завершил** (проверенная фича закоммичена и запушена в `main`) → переведи в
  **Ready to Deploy** и добавь короткий комментарий со ссылкой на коммит/суть
  (`create_work_item_comment`). В **Done** — только когда выкачено в прод и проверено там.
- **Новая** планируемая работа (из кода/обсуждения) → заведи через `create_work_item` в нужном
  статусе (Todo/Backlog) с подходящей меткой. **Приоритеты не проставляй** — решение пользователя.
- Перед созданием проверь `search_work_items`, чтобы не плодить дубликаты; ищи по заголовку.
- Если MCP-вызов падает — повтори; при иной ошибке честно сообщи и не выдавай за сделанное.

**Эпики — это МОДУЛИ Plane**: `Engine и данные` · `REST API` · `Mobile — каркас и бюджет` ·
`Mobile — счета и операции` · `Mobile — отчёты и домены` · `Mobile — релиз и иконка` ·
`MCP и скилл` · `Инфра и деплой`.
Метки: `engine` `api` `mobile` `design` `infra` `docs` `Bug` `Tech debt` `UX`.
Статусы (2026-08-06): `Backlog` / `Todo` / `In Progress` / `In Review` / `QA` /
`Ready to Deploy` / `Done` / `Cancelled` / `Duplicate`. Три средних — группа `started`,
поэтому в burndown они считаются незакрытыми: `Done` = выкачено в прод, не «смёржено».

**Циклы (Cycles)** двухнедельные. Модули = этапы продукта, циклы = спринты; задача может быть
одновременно в обоих. Закрывая цикл, незавершённое переносится через `transfer_cycle_work_items`.
`Cycle 1` — 2026-08-10 … 2026-08-23.

**Оценки (estimates).** Шкалы пока нет: в Community вся группа estimate-ручек отдаёт 404,
через API её не создать. Включи руками в **Settings → Estimates**, проставь пару задач,
после чего UUID точек вычитываются через `list_work_items(fields: "estimate_point")` и
таблица «оценка → UUID» дописывается сюда. Писать оценку надо строго в `estimate_point`
(FK на точку шкалы) — legacy-поле `point` API принимает молча, но UI и burndown его игнорируют.

⚠️ Ограничения инстанса (Community **v1.4.0**), не тратить на них попытки:
**PQL-фильтры не поддерживаются вообще** — фильтруй на клиенте, выкачивая страницы по 100.
`retrieve_work_item_by_identifier` работает **только с `expand: "labels"`**; фильтр
`external_id` в `list_work_items` не работает. **404 отдают**: `get_features`,
`update_project_features` (фичи включаются через `update_project`: `cycle_view`,
`module_view`, `issue_views_view`, `page_view`), вся группа estimate-ручек и вся группа
worklog-ручек — **time tracking это фича Plane Pro**, в Community её нет: флаг
`is_time_tracking_enabled` через API ставится, но кнопки «Log work» в интерфейсе не будет.
`create_state` **игнорирует `sequence`**, дописывая статус в конец группы.
`comment_html` принимает **сырой HTML** — экранировать теги не надо, иначе в интерфейсе
будут видны `&lt;p&gt;` вместо форматирования (лечится `update_work_item_comment`).

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
- `docs/section-6f-pdf-import.md` — Bank PDF import (post-MVP)

## File Naming

- Schema: `packages/engine/src/db/schema.ts`
- DB connection: `packages/engine/src/db/index.ts` (exports `createDb`, `db`, `schema`)
- Engine: `packages/engine/src/budget/engine.ts`
- Money: `packages/engine/src/math/money.ts`
- API routes: `apps/api/src/routes/{resource}.ts`
- Tests: `{package}/tests/{module}.test.ts`