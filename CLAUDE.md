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
`comment_html` **и `description_html`** принимают **сырой HTML** — экранировать теги не надо,
иначе в интерфейсе будут видны `&lt;p&gt;` вместо форматирования (лечится
`update_work_item_comment` / `update_work_item`). Сервер сам оборачивает содержимое
в `<div>`, свой корневой контейнер добавлять не нужно.

## Structure

- `packages/engine` — @pfm/engine: core library (budget, math, db)
- `apps/api` — Hono REST server, depends on @pfm/engine
- `apps/mcp` — @pfm/mcp: MCP tool table + server, dispatched into the API routes
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
- Transfers within one side of the budget: DO NOT appear in category activity —
  they carry no category, and the `category_id IS NOT NULL` filter drops them
- Transfers crossing the budget boundary: DO carry a category on the on-budget
  side and DO count as activity. Without it the money leaves the accounts while
  the budget still promises it, and `RTA + available = on-budget balances`
  breaks by the size of the transfer
- Soft delete: `is_deleted = true` (never physical delete)

### Engine Pattern

Every engine function takes `db: DB` as first argument (dependency injection):

```typescript
export function getBudgetMonth(db: DB, month: string): BudgetMonth { ... }
export function assignToCategory(db: DB, categoryId: string, month: string, amountCents: number): void { ... }
```

This lets apps/api, apps/mcp, and tests each create their own db instance.

### Age of Money

Четвёртое правило YNAB живёт в `packages/engine/src/budget/age.ts`, отдельно от
`engine.ts`: это метрика по денежному потоку, а не по бюджету, и общих данных
у них нет. FIFO по бюджетным счетам, среднее по последним десяти списаниям.
Перевод между двумя своими бюджетными счетами — не приход и не расход: деньги
переложились и стареть не перестали. `null` вместо нуля, когда мерить нечего —
ноль означал бы «трачу с колёс», то есть утверждение о финансах.

### Recovery & Data Integrity

Rules learned from a real restore-after-five-months session:

- **Unknown ids are 404 `UNKNOWN_REFERENCE`, never a silent no-op.** `assign_budget`
  used to accept any string and return the whole budget with `assignedCents: 0`.
  Routes validate references before writing; bulk routes validate the entire
  batch first, so nothing is half-applied.
- **`create_category` / `create_category_group` are idempotent.** A retry returns the
  existing row with `alreadyExisted: true` instead of minting a duplicate with a
  new id.
- **Платёж по кредиту проводится через `POST /loans/:id/payment`, а не обычной
  операцией.** Проценты считаются от фактического остатка за фактическое число
  дней с прошлого платежа (actual/365), остальное уменьшает тело: переплата
  сокращает срок сама. График амортизации для этого не годится — он верен лишь
  пока платят ровно по расписанию. Разнесение хранится на самой операции
  (`loan_id`, `loan_principal_cents`, `loan_interest_cents`), поэтому удаление
  платежа возвращает долг на место. Привязка к кредиту явная: по категории её
  не вывести — три рассрочки делят одну категорию, две карты другую, а у
  кредита наличными категории нет вовсе.
- **Остаток долга — это `principalCents − paidOffCents` минус тело проведённых
  платежей.** `paidOffCents` — то, что погашено до появления кредита в системе.
  Раньше из остатка вычиталась активность привязанной категории: платёж уходил
  в минус дважды, а при ставке выше нуля вычиталась вся сумма списания, хотя
  тело уменьшается лишь на свою долю. Потом считали по категории с `startDate`
  — тоже негодно: категория ничего не доказывает. `paymentsObservedCents`
  теперь считает **только платежи, привязанные к этому кредиту** через
  `loan_id`; трата, просто попавшая в его категорию, платежом не является.
- **`close_loan` ≠ `delete_loan`.** Closing settles the balance so the loan leaves the
  debt totals; deleting only hides it and leaves the balance in every aggregate.
- **Never correct a balance with offsetting transactions.** `POST /accounts/:id/reconcile`
  writes one adjustment. `set_available` sets a category's Available exactly
  (negatives allowed) without touching transactions at all.
- **Every mutation is journalled** by SQLite triggers on `transactions`,
  `monthly_budgets` and `loans`; the audit middleware groups a request's rows into
  one batch that `POST /audit/undo` can replay backwards.
- **Заём человеку — трата из пополненной категории, его возврат — приход в неё
  же.** Модуль `personal_debts` ни во что бюджетное не входит: это напоминалка,
  кто кому должен. Провести заём по пустой категории не ошибка, но минус
  поглотится на границе месяца и вычтется из RTA недели спустя, когда связь с
  решением уже не видна. Возврат в `ready-to-assign` засчитал бы те же деньги
  доходом дважды. Обмен валюты — обратный случай: деньги заходят из-за периметра
  бюджета, и там `ready-to-assign` правильно.
- `pnpm db:audit` reports duplicate categories, repaid-but-active loans, offsetting
  transaction pairs, dangling category references and unfunded spending —
  categories that went negative in a closed month; `--apply` repairs them after
  taking a backup (`unfunded` is report-only: откуда взять деньги задним числом,
  решает человек).

### Матчинг: два разных правила, не путать

- **Импорт выписки** ищет ручную операцию по счёту, **точной сумме** и окну
  ±10 дней. Плательщик не участвует: банк пишет `WOLT.COM VIRTUAL POS` там, где
  человек написал `Wolt`. Совпавшей проставляется `import_id` и `cleared`;
  разметка остаётся человеческая. Кандидат только без `import_id` — иначе две
  покупки на одну сумму в одном окне склеились бы.
- **Регулярный платёж** ищет по счёту, **плательщику** и тому же окну, а сумму
  игнорирует: у счетов она плавает (часть гасится бонусами). Совпало — операция
  не создаётся, но `nextDate` двигается: платёж состоялся.

Правила зеркальны потому, что зеркальна неопределённость: правило знает, кому
платит, но не сколько выйдет; выписка знает сумму, но зовёт продавца по-своему.

### Schema changes

DDL lives **only** in `packages/engine/src/db/ddl.ts`. `migrate.ts` and every test
fixture call `initializeDatabase()`. Do not paste DDL into a test — it used to be
duplicated across ten files and every schema change broke them one suite at a time.

### MCP Pattern

`@pfm/mcp` owns a declarative table of 63 tools; each maps arguments to an HTTP
method, path and body. `createMcpServer(dispatch)` takes the dispatch function as
its first argument, the same dependency-injection shape engine functions use for
`db`. The API supplies a dispatch that routes into an internal Hono app built from
the same route factories as REST, so route handlers stay the single source of truth.

`@pfm/mcp` must not import `@pfm/api` or `@pfm/engine` — apps/api depends on it.

Remote endpoint: `POST /mcp/:token`, token = `PFM_MCP_TOKEN` (falls back to
`PFM_API_KEY`). Adding a REST endpoint means adding a tool to the table.

### API Response Format

- Errors: `{ error: { code, message, suggestion } }`
- Money fields: always include both `*Cents` and `*Formatted` variants
  - `balanceCents: 15000000` + `balanceFormatted: "150 000 ₸"`
- Budget response: flat `categoryBudgets[]` from engine → grouped by `groupId` in route

### Testing

- Framework: Vitest
- DB in tests: `createTestDb()` from `apps/api/tests/fixtures/db.ts`, which calls
  `initializeDatabase()` — the same function `migrate.ts` uses, so a test database
  cannot drift from production's. `createDb(':memory:')` only opens a connection and
  creates no tables; `packages/engine/src/db/migrate.ts` is a side-effecting script
  that writes to `./data`, so it cannot be reused from a test.
- `apps/api/tests/recovery-api.test.ts` pins the data-integrity guarantees above.
  Engine tests call `initializeDatabase(db.$client)` directly.
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

## Сборка на устройство

Для установки на Pixel собирать под его архитектуру:

```bash
flutter build apk --release --target-platform android-arm64
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

APK ужимается с 59 МБ до 21: универсальный несёт ещё armeabi-v7a и x86_64,
которые на устройстве лежат мёртвым грузом. Разница не в сборке — она
одинаковая, — а в доставке по USB: пять минут против одной. За одну сессию
установка срывалась трижды (`pm install` не находил протолкнутый файл,
устройство отваливалось посреди передачи), и каждый обрыв стоил полной
пересылки.

Универсальный APK нужен только для настоящей раздачи — там архитектура
устройства заранее неизвестна.

**Проверять установку сразу после деплоя API бесполезно.** Railway при выкатке
недолго держит старый и новый контейнер на одном томе SQLite, и старый читатель
отдаёт снимок до изменений: запись проходит, а чтение показывает прежнее.

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