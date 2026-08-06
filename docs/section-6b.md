# Секция 6B: MCP Server

Реализовано. Дизайн: `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md`,
план: `docs/superpowers/plans/2026-08-06-pfm-mcp-server.md`.

## Что это

`@pfm/mcp` — таблица из 48 инструментов поверх REST API. Инструмент отображает
аргументы в `метод + путь + тело`, а `dispatch` выполняет вызов по внутреннему
Hono-роутеру, собранному из тех же фабрик маршрутов, что обслуживают REST.
Бизнес-логика не дублируется: маршруты остаются единственным источником правды.

`createMcpServer(dispatch)` принимает диспатч первым аргументом — по той же
конвенции внедрения зависимостей, по которой engine-функции принимают `db`.
`@pfm/mcp` не зависит ни от `@pfm/api`, ни от `@pfm/engine`.

## Транспорт

Remote streamable-http, смонтирован в сервис `api`: `POST /mcp/:token`.
Отдельного stdio-режима нет — данные живут на Railway-томе, локальная база пуста.

Используется `WebStandardStreamableHTTPServerTransport` из SDK: принимает
`Request`, возвращает `Response`, поэтому вставляется в Hono напрямую. Режим
stateless (`sessionIdGenerator: undefined`) плюс `enableJsonResponse: true`, так
что ответ собирается целиком и сервер с транспортом закрываются сразу.

Токен: `PFM_MCP_TOKEN`, при отсутствии `PFM_API_KEY`, при отсутствии обоих
авторизация выключена (локальная разработка). Принимается и как сегмент пути,
и как `Authorization: Bearer`; сравнение через `timingSafeEqual`.

## Инструменты (48)

Счета (5), категории (5), бюджет (5), транзакции (5), симуляции (4),
регулярные платежи (5), кредиты (6), долги людям (6), депозиты (7).
Актуальный список — `apps/mcp/src/tools.ts`.

Отображение 1:1 с эндпоинтами REST: новый маршрут = новая запись в таблице.

## Формат ответа

Тело маршрута отдаётся как есть. API уже возвращает деньги парами
(`balanceCents` + `balanceFormatted`), поэтому второго рендерера нет — иначе
пришлось бы держать 48 форматтеров, расходящихся с API при изменении полей.

Не-2xx → `isError: true` с телом `{error:{code,message,suggestion}}` без
изменений. Исключение внутри диспатча → тот же формат с кодом `INTERNAL_ERROR`.

## Подключение Claude Desktop

Settings → Connectors → Add custom connector → URL:

    https://<railway-host>/mcp/<PFM_MCP_TOKEN>

Проверка, что эндпоинт жив и закрыт:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<railway-host>/mcp/wrong \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

Ожидается `401`; с настоящим токеном — `200`.
