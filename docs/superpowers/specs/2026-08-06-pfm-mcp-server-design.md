# PFM MCP Server — дизайн

Дата: 2026-08-06
Статус: утверждён, готов к планированию реализации

## Задача

Подключить PFM к Claude Desktop как MCP-сервер, чтобы вести бюджет разговором:
смотреть остатки и Ready to Assign, записывать транзакции, распределять деньги,
проверять кредиты и депозиты, гонять симуляции погашения.

## Принятые решения

| Вопрос | Решение |
|---|---|
| Транспорт | Remote streamable-http, смонтированный в сервис `api` |
| Источник данных | Прод-БД на Railway-томе — та же, что у мобильного приложения |
| Поверхность | Полное покрытие REST API, 48 инструментов |
| Удаление | `delete_*` включены для всех сущностей |
| Авторизация | `PFM_MCP_TOKEN` с фоллбэком на `PFM_API_KEY` |
| Реализация инструментов | Диспатч во внутренний Hono-роутер |

Локальный stdio-режим не делается: реальные данные лежат на Railway, локальные
`data/pfm.db` датируются 25 февраля. OAuth вне объёма.

## Почему диспатч, а не вызовы engine

В PFM бизнес-логика живёт в маршрутах `apps/api/src/routes/*.ts`: drizzle-запросы,
парные транзакции для переводов, резолв payee, дефолты вроде `onBudget = false`
для tracking-счетов. Engine содержит только вычисления — бюджет, долги, кредиты,
депозиты, планировщик.

Это отличается от соседнего проекта HTR, где engine содержал всё и MCP звал его
напрямую. Повторить здесь тот же приём означало бы продублировать логику маршрутов
в инструментах и держать две копии синхронно. Первое расхождение приводит к тому,
что Claude пишет в БД не то, что пишет мобилка.

Рассмотренные альтернативы:

- **Сервисный слой**, общий для REST и MCP. Архитектурно чище, но это переписывание
  9 файлов маршрутов и 48 эндпоинтов работающего прода ради фичи, которая этого не
  требует.
- **Дублирование логики поверх engine + drizzle.** Отвергнуто по причине выше.

Выбран диспатч: инструмент отображает аргументы в `метод + путь + тело` и вызывает
`app.request()` по тому же роутеру, что обслуживает REST. Дублирования нет, паритет
с API держится сам. Паттерн уже обкатан — тесты PFM устроены так же (CLAUDE.md).

## Структура

```
apps/mcp/                    пакет @pfm/mcp
  src/
    dispatch.ts   тип Dispatch = (method, path, body?) => Promise<{status, body}>
    tools.ts      декларативная таблица инструментов
    server.ts     createMcpServer(dispatch): McpServer
  tests/tools.test.ts

apps/api/src/
    mcp.ts        внутренний роутер без auth + маршрут POST /mcp/:token
    app.ts        + app.route('/mcp', mcpRoutes(db))   ← единственная правка
```

`@pfm/mcp` не зависит от `@pfm/api` — иначе цикл, поскольку api импортирует mcp.
Вместо этого `createMcpServer` принимает `dispatch` первым аргументом, по конвенции
репозитория, где engine-функции первым аргументом берут `db`. В тестах подставляется
фиктивный dispatch, в проде — настоящий роутер.

Внутренний роутер — отдельный экземпляр Hono из тех же фабрик (`accountRoutes(db)`
и прочих), но без `apiKeyAuth`, cors и logger: авторизация уже произошла на входе
в `/mcp/:token`. Обработчик `onError` повторяет тот, что в `createApp`, чтобы
ошибки приходили в формате `{error:{code,message,suggestion}}`.

## Инструменты (48)

Имена snake_case.

| Группа | Инструменты |
|---|---|
| Счета (5) | `list_accounts` `get_account` `create_account` `update_account` `delete_account` |
| Категории (5) | `list_categories` `create_category_group` `create_category` `update_category` `delete_category` |
| Бюджет (5) | `get_budget` `get_rta_overview` `get_ready_to_assign` `assign_budget` `move_budget` |
| Транзакции (5) | `list_transactions` `get_transaction` `create_transaction` `update_transaction` `delete_transaction` |
| Симуляции (4) | `simulate_payoff` `compare_strategies` `debt_vs_invest` `compare_deposits` |
| Регулярные (5) | `list_scheduled` `create_scheduled` `update_scheduled` `delete_scheduled` `process_scheduled` |
| Кредиты (6) | `list_loans` `get_loan` `create_loan` `update_loan` `delete_loan` `get_loan_schedule` |
| Долги людям (6) | `list_debts` `get_debt` `create_debt` `update_debt` `settle_debt` `delete_debt` |
| Депозиты (7) | `list_deposits` `get_deposit` `create_deposit` `update_deposit` `delete_deposit` `get_deposit_schedule` `get_kdif_exposure` |

Запись в таблице — данные, а не код:

```typescript
{
  name: 'create_transaction',
  description: 'Записать транзакцию или перевод между счетами. amountCents: отрицательное = расход.',
  schema: z.object({ accountId: z.string(), date: z.string(), amountCents: z.number().int(), /* … */ }),
  method: 'POST',
  path: () => '/api/v1/transactions',
  body: (a) => a,
}
```

Функция `path(args)` собирает path-параметры и query-строку.

Zod-схемы в таблице пишутся заново по образцу схем в маршрутах, а не импортируются:
схемы маршрутов объявлены модуль-приватными (`const createAccountSchema` без
`export`), и экспортировать их наружу означало бы расширить публичную поверхность
`@pfm/api` ради описаний. Дублирование здесь безопасно, потому что схема в таблице
не валидирует — она служит описанием инструмента для Claude, а фактическая проверка
остаётся в маршруте, который вернёт `VALIDATION_ERROR` при расхождении.

Описания пишутся содержательно. Claude выбирает инструмент по `description`, и от
его текста зависит, поймёт ли модель знак суммы, формат даты `YYYY-MM-DD` и месяца
`YYYY-MM`. Это единственное место, где многословность оправдана.

## Формат ответа

Тело ответа маршрута отдаётся как есть:
`content: [{ type: 'text', text: JSON.stringify(body) }]`.

Отдельный человекочитаемый рендер не делается, вопреки спеке `docs/section-6b.md`.
API уже возвращает деньги парами (`balanceCents` + `balanceFormatted: "150 000 ₸"`),
поэтому форматирование в ответе присутствует. Второй рендерер означал бы 48
форматтеров, расходящихся с API при первом же изменении полей.

## Авторизация

Токен: `PFM_MCP_TOKEN`, при отсутствии — `PFM_API_KEY`, при отсутствии обоих
авторизация выключена. Последнее повторяет поведение `apiKeyAuth()`, так что
правило в проекте остаётся одно.

Принимаются обе формы:

- `POST /mcp/:token` — её понимает Claude Desktop
- `POST /mcp` с заголовком `Authorization: Bearer <token>`

Сравнение через `crypto.timingSafeEqual` с предварительной сверкой длины.

Транспорт stateless: на каждый запрос создаются свежие `McpServer` и
`StreamableHTTPServerTransport` с `sessionIdGenerator: undefined`, оба закрываются
по `outgoing.on('close')`. Маршрут типизируется `Hono<{ Bindings: HttpBindings }>`
и возвращает `RESPONSE_ALREADY_SENT`.

## Ошибки

Не-2xx от маршрута → `isError: true`, тело `{error:{code,message,suggestion}}` без
изменений. Поле `suggestion` в PFM осмысленное, и Claude по нему часто исправляется
со второй попытки. Исключение внутри диспатча заворачивается в тот же формат с кодом
`INTERNAL_ERROR`.

## Тестирование

`apps/mcp/tests/tools.test.ts` — на подставном dispatch, записывающем
`(method, path, body)`:

- имена инструментов уникальны
- у каждого непустое описание
- схема принимает валидный пример
- `path()` собирает корректный URL, включая path-параметры и query

`apps/api/tests/mcp.test.ts` — сквозной через `app.request()` на `createDb(':memory:')`:

- `initialize` отвечает
- `tools/list` отдаёт 48 инструментов
- `list_accounts` возвращает данные
- неверный токен → 401, верный → 200

## Деплой

`railway.json` не меняется: MCP едет внутри сервиса `api` и делит с ним том.
Требуется добавить `PFM_MCP_TOKEN` в переменные сервиса.

Подключение: Claude Desktop → Settings → Connectors → Add custom connector →
`https://api-production-a69c.up.railway.app/mcp/<PFM_MCP_TOKEN>`

## Сопутствующие правки документации

- `.env.example` — добавить `PFM_MCP_TOKEN`
- `CLAUDE.md` — строка про `apps/mcp` помечена «post-MVP», станет фактом
- `docs/section-6b.md` — описывает stdio-сервер на 11 инструментов, переписать под
  фактическую реализацию
