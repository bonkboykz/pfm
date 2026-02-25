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

## Debt Payoff Simulator

### Simulate Debt Payoff

```bash
curl -s -X POST "$PFM_API_URL/api/v1/simulate/payoff" \
  -H "Content-Type: application/json" \
  -d '{
    "debts": [
      {"name":"Kaspi Red","type":"installment","balanceCents":45000000,"aprBps":0,"minPaymentCents":15000000,"remainingInstallments":3,"latePenaltyCents":200000},
      {"name":"Халық кредит","type":"loan","balanceCents":120000000,"aprBps":1850,"minPaymentCents":8500000}
    ],
    "strategy": "avalanche",
    "extraMonthlyCents": 5000000
  }' | jq
```

Strategies: `snowball`, `avalanche`, `highest_monthly_interest`, `cash_flow_index`

### Compare All Strategies

```bash
curl -s -X POST "$PFM_API_URL/api/v1/simulate/compare" \
  -H "Content-Type: application/json" \
  -d '{
    "debts": [
      {"name":"Kaspi Red","type":"installment","balanceCents":45000000,"aprBps":0,"minPaymentCents":15000000,"remainingInstallments":3,"latePenaltyCents":200000},
      {"name":"Халық кредит","type":"loan","balanceCents":120000000,"aprBps":1850,"minPaymentCents":8500000}
    ],
    "extraMonthlyCents": 5000000
  }' | jq '.recommended, .savingsVsWorstFormatted'
```

### Debt vs Invest

```bash
curl -s -X POST "$PFM_API_URL/api/v1/simulate/debt-vs-invest" \
  -H "Content-Type: application/json" \
  -d '{
    "extraMonthlyCents":5000000,
    "debt":{"name":"Халық","type":"loan","balanceCents":120000000,"aprBps":1850,"minPaymentCents":8500000},
    "expectedReturnBps":1200,
    "horizonMonths":24
  }' | jq '.recommendation, .explanation'
```

---

## Recurring Transactions

### List upcoming (next 7 days)

```bash
curl -s "$PFM_API_URL/api/v1/scheduled?upcoming=7" | jq
```

### List all active scheduled transactions

```bash
curl -s "$PFM_API_URL/api/v1/scheduled" | jq
```

### Create monthly expense

```bash
curl -s -X POST "$PFM_API_URL/api/v1/scheduled" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "ACCOUNT_ID",
    "frequency": "monthly",
    "nextDate": "2026-03-01",
    "amountCents": -15000000,
    "payeeName": "Арендодатель",
    "categoryId": "CATEGORY_ID",
    "memo": "Аренда квартиры"
  }' | jq
```

### Process all due transactions

```bash
curl -s -X POST "$PFM_API_URL/api/v1/scheduled/process" | jq
```

### Process with specific date

```bash
curl -s -X POST "$PFM_API_URL/api/v1/scheduled/process" \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-03-01"}' | jq
```

---

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
