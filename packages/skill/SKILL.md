---
name: pfm-budget
description: >
  Zero-based envelope budgeting (YNAB-style) via REST API. Track accounts,
  transactions, categories, budget assignments. Use when user asks about
  budgeting, expense tracking, "сколько осталось", "куда ушли деньги",
  account balances, financial planning, debt tracking, Kaspi, transfers,
  loans, кредиты, рассрочка, личные долги, "кому должен", "кто должен",
  вклады, депозиты, проценты, КГСС, капитализация.
version: 0.4.0
metadata:
  openclaw:
    emoji: "💰"
    requires:
      bins: [curl, jq]
      env: [PFM_API_URL, PFM_API_KEY]
    primaryEnv: PFM_API_URL
---

# PFM Budget Engine

Zero-based (envelope) budgeting via REST API. Every tenge of income is
assigned to a category. Budget balanced when Ready to Assign = 0.

**API Base**: `$PFM_API_URL` (e.g. `http://localhost:3000`)

**Auth Header** (required when `PFM_API_KEY` is set):
```bash
AUTH="Authorization: Bearer $PFM_API_KEY"
```

---

## Health Check

```bash
curl -s "$PFM_API_URL/health" | jq
```

---

## Accounts

### List all accounts with balances

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/accounts" | jq
```

Returns: `{ accounts: [{ id, name, type, onBudget, currency, isActive, balanceCents, balanceFormatted, ... }] }`

Deactivated accounts are hidden by default, yet their transactions still move
Ready to Assign. If the totals do not add up, look for one here:

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/accounts?includeInactive=true" | jq
```

### Reconcile an account to its real balance

When the computed balance has drifted from what the bank shows, write **one**
adjustment transaction — never a set of hand-made offsetting entries. On
on-budget accounts the adjustment lands in Ready to Assign.

```bash
curl -s -X POST "$PFM_API_URL/api/v1/accounts/{id}/reconcile" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{ "actualBalanceCents": 49665414, "date": "2026-08-07" }' | jq
```

### Create account

```bash
curl -s -X POST "$PFM_API_URL/api/v1/accounts" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Kaspi Gold",
    "type": "checking",
    "currency": "KZT"
  }' | jq
```

Types: `checking`, `savings`, `credit_card`, `cash`, `line_of_credit`, `tracking`

Optional metadata: `bankName`, `last4Digits` (4 digits), `cardType` (`visa`, `mastercard`, `amex`, `unionpay`, `mir`, `other`)

### Get single account

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/accounts/{id}" | jq
```

---

## Categories

### List all category groups with categories

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/categories" | jq
```

Returns nested structure: `{ categoryGroups: [{ id, name, categories: [...] }] }`

### Create category group

```bash
curl -s -X POST "$PFM_API_URL/api/v1/categories/groups" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name": "Постоянные расходы"}' | jq
```

### Create category

```bash
curl -s -X POST "$PFM_API_URL/api/v1/categories" \
  -H "$AUTH" -H "Content-Type: application/json" \
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
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/transactions" | jq

# Filter by account
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/transactions?accountId={id}" | jq

# Filter by date range
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/transactions?since=2026-02-01&until=2026-02-28" | jq

# Filter by category
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/transactions?categoryId={id}" | jq
```

### Create expense transaction

```bash
curl -s -X POST "$PFM_API_URL/api/v1/transactions" \
  -H "$AUTH" -H "Content-Type: application/json" \
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
  -H "$AUTH" -H "Content-Type: application/json" \
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
  -H "$AUTH" -H "Content-Type: application/json" \
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
curl -s -X DELETE -H "$AUTH" "$PFM_API_URL/api/v1/transactions/{id}" | jq
```

Soft-deletes. If part of a transfer, deletes both sides.

### Create many transactions at once (all-or-nothing)

```bash
curl -s -X POST "$PFM_API_URL/api/v1/transactions/bulk" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "skipDuplicates": true,
    "transactions": [
      { "accountId": "ACC", "date": "2026-08-01", "amountCents": -1500050, "payeeName": "Магнум", "categoryId": "CAT" },
      { "accountId": "ACC", "date": "2026-08-02", "amountCents": -230000, "payeeName": "Такси", "categoryId": "CAT" }
    ]
  }' | jq
```

Every `accountId` and `categoryId` is checked before anything is stored.
Transfers are not supported here — create those one at a time.

### Import a bank statement (CSV)

Deduplicates against what is already stored, matching on date + amount + payee,
so a re-exported overlapping statement is safe to import twice. Columns are
detected from the header (English or Russian). Dates accept `YYYY-MM-DD`,
`DD.MM.YYYY` or `DD/MM/YYYY`; amounts accept spaced thousands, comma or dot
decimals, and parentheses for debits.

```bash
# Always preview first
curl -s -X POST "$PFM_API_URL/api/v1/transactions/import" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile csv statement.csv \
        '{accountId: "ACC", csv: $csv, dryRun: true}')" | jq

# Then import for real (drop dryRun)
```

Imported rows arrive **uncategorised** — assign categories so they reach the budget.

---

## Budget

> **RTA varies by month.** A single month's RTA does NOT account for
> future assignments. Always use `/rta-overview` to see the true available
> amount across all assigned months.

### Get RTA overview (across months)

Use this INSTEAD of checking a single month's RTA. Shows the real available
money considering future assignments.

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/budget/rta-overview" | jq
```

`minReadyToAssignCents` is the TRUE available amount — the lowest RTA across
all months with assignments.

### Get full budget state for a month

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/budget/2026-02" | jq
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
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "categoryId": "CATEGORY_ID",
    "amountCents": 8000000
  }' | jq
```

### Move money between categories

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/2026-02/move" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "fromCategoryId": "FROM_ID",
    "toCategoryId": "TO_ID",
    "amountCents": 1000000
  }' | jq
```

### Get Ready to Assign breakdown

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/budget/2026-02/ready-to-assign" | jq
```

### Assign to many categories at once (all-or-nothing)

Every `categoryId` is validated before anything is written, so a bad id cannot
leave the batch half-applied. Prefer this over a run of single assigns.

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/2026-02/bulk-assign?response=minimal" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "assignments": [
      { "categoryId": "CAT_RENT", "amountCents": 20000000 },
      { "categoryId": "CAT_FOOD", "amountCents": 15000000 }
    ]
  }' | jq
```

`?response=minimal` works on `assign`, `move`, `bulk-assign` and `set-available`.
It returns only the touched categories and the new RTA instead of the whole month.

### Clear Available inherited from earlier months

`assign` only sets the current month and refuses negatives, so it cannot clear
carryover. `set-available` solves for the month's assignment instead, and the
difference moves to or from Ready to Assign. No transactions are created.

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/2026-02/set-available?response=minimal" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{ "categoryId": "CATEGORY_ID", "amountCents": 0 }' | jq
```

Start budgeting again from a given month (destructive, needs confirmation):

```bash
curl -s -X POST "$PFM_API_URL/api/v1/budget/reset" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{ "fromMonth": "2026-02", "confirm": true }' | jq
```

### Reconcile the budget against the accounts

Explains the gap between the sum of account balances and RTA + everything in
categories: off-budget accounts, deactivated accounts, foreign currency,
uncategorised spending, transfers that left the budget. A non-zero
`unexplainedCents` is a real anomaly, not a modelling gap.

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/budget/2026-02/reconciliation" | jq
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

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | 400 — the body did not match the schema |
| `NOT_FOUND` | 404 — the thing you asked to read does not exist |
| `UNKNOWN_REFERENCE` | 404 — a **write** named an id that does not resolve |
| `UNAUTHORIZED` | 401 — missing or wrong API key |

`UNKNOWN_REFERENCE` is never returned as a success. If an id you are holding
stops resolving, re-read it: the id a `create` returns is canonical, and a
retried create returns the existing row with `alreadyExisted: true` rather than
making a second copy.

## Audit and undo

Every change to transactions, budget assignments and loans is journalled and
grouped by the request that made it — a bulk import is one entry, not three
hundred.

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/audit?limit=20" | jq

# Roll a whole batch back
curl -s -X POST "$PFM_API_URL/api/v1/audit/undo" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{ "batchId": "BATCH_ID" }' | jq
```

## Debt Payoff Simulator

### Simulate Debt Payoff

```bash
curl -s -X POST "$PFM_API_URL/api/v1/simulate/payoff" \
  -H "$AUTH" -H "Content-Type: application/json" \
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
  -H "$AUTH" -H "Content-Type: application/json" \
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
  -H "$AUTH" -H "Content-Type: application/json" \
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
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/scheduled?upcoming=7" | jq
```

### List all active scheduled transactions

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/scheduled" | jq
```

### Create monthly expense

```bash
curl -s -X POST "$PFM_API_URL/api/v1/scheduled" \
  -H "$AUTH" -H "Content-Type: application/json" \
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
curl -s -X POST -H "$AUTH" "$PFM_API_URL/api/v1/scheduled/process" | jq
```

### Process with specific date

```bash
curl -s -X POST "$PFM_API_URL/api/v1/scheduled/process" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-03-01"}' | jq
```

---

## Loans (Кредиты)

### List all loans

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/loans" | jq
```

Returns active loans with computed `currentDebtCents` (opening balance minus
payments made in the linked category **since the loan's `startDate`**).

```bash
# Closed loans too, plus the summed active debt
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/loans?includeInactive=true&withTotals=true" | jq
```

### Create a loan

```bash
curl -s -X POST "$PFM_API_URL/api/v1/loans" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Халық кредит",
    "type": "loan",
    "accountId": "ACCOUNT_ID",
    "categoryId": "CATEGORY_ID",
    "principalCents": 200000000,
    "aprBps": 1850,
    "termMonths": 24,
    "startDate": "2025-06-01",
    "monthlyPaymentCents": 8500000,
    "paymentDay": 25
  }' | jq
```

Types: `loan`, `installment` (0% APR like Kaspi Red), `credit_line`

A bank statement shows what is **left**, not what was borrowed. Quote it directly
with `currentBalanceCents` instead of reconstructing a principal by arithmetic:

```bash
curl -s -X POST "$PFM_API_URL/api/v1/loans" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Kaspi рассрочка",
    "type": "installment",
    "currentBalanceCents": 10051500,
    "termMonths": 3,
    "startDate": "2026-08-03",
    "monthlyPaymentCents": 3350500,
    "paymentDay": 3
  }' | jq
```

### Get amortization schedule

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/loans/{id}/schedule" | jq
```

Returns month-by-month breakdown: principal, interest, payment, remaining balance.

### Close a repaid loan

Use this, not `DELETE`. Closing settles the outstanding balance to zero so the
loan leaves the debt totals; deleting only hides it and leaves its balance in
every aggregate — which is how repaid loans end up inflating what you owe.

```bash
curl -s -X POST "$PFM_API_URL/api/v1/loans/{id}/close" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{ "closedDate": "2026-08-01", "reason": "Погашен досрочно" }' | jq
```

### Update / delete loan

```bash
curl -s -X PATCH "$PFM_API_URL/api/v1/loans/{id}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"note": "Досрочное погашение планируется"}' | jq

# Retire without settling the balance (loan was entered wrongly)
curl -s -X PATCH "$PFM_API_URL/api/v1/loans/{id}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"isActive": false}' | jq

curl -s -X DELETE -H "$AUTH" "$PFM_API_URL/api/v1/loans/{id}" | jq
```

---

## Personal Debts (Личные долги)

### List debts with summary

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/debts" | jq

# Include settled debts
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/debts?includeSettled=true" | jq
```

Returns `{ debts: [...], summary: { totalOweCents, totalOwedCents, netCents, ... } }`

### Create a debt

```bash
# I owe someone
curl -s -X POST "$PFM_API_URL/api/v1/debts" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "personName": "Ансар С.",
    "direction": "owe",
    "amountCents": 5000000,
    "dueDate": "2026-03-15",
    "note": "За обед"
  }' | jq

# Someone owes me
curl -s -X POST "$PFM_API_URL/api/v1/debts" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "personName": "Марат К.",
    "direction": "owed",
    "amountCents": 3000000
  }' | jq
```

Directions: `owe` (я должен), `owed` (мне должны)

### Settle a debt

```bash
curl -s -X POST -H "$AUTH" "$PFM_API_URL/api/v1/debts/{id}/settle" | jq
```

### Update / delete debt

```bash
curl -s -X PATCH "$PFM_API_URL/api/v1/debts/{id}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"amountCents": 3000000}' | jq

curl -s -X DELETE -H "$AUTH" "$PFM_API_URL/api/v1/debts/{id}" | jq
```

---

## Bank Deposits (Вклады)

### List all deposits

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/deposits" | jq
```

Returns deposits with `currentBalanceCents`, `projectedInterestCents`, and formatted versions.

### Create a term deposit

```bash
curl -s -X POST "$PFM_API_URL/api/v1/deposits" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "name": "Halyk Срочный 14.5%",
    "bankName": "Halyk Bank",
    "type": "term",
    "initialAmountCents": 100000000,
    "annualRateBps": 1450,
    "termMonths": 12,
    "startDate": "2025-06-01",
    "endDate": "2026-06-01",
    "capitalization": "monthly"
  }' | jq
```

Types: `term` (срочный), `savings` (накопительный), `demand` (до востребования)

Capitalization: `monthly`, `quarterly`, `at_end`, `none` (simple interest)

Optional fields: `accountId`, `categoryId`, `isWithdrawable`, `isReplenishable`, `minBalanceCents`, `topUpCents`, `earlyWithdrawalRateBps`, `note`

### Get interest schedule

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/deposits/{id}/schedule" | jq
```

For perpetual deposits (termMonths=0), pass `?months=N` (default 12):

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/deposits/{id}/schedule?months=24" | jq
```

Returns month-by-month: startBalance, interest, capitalized, endBalance, cumulativeInterest.

### KDIF exposure (КГСС)

```bash
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/deposits/kdif" | jq
```

Groups deposits by bank, shows total vs 15M₸ guarantee limit, flags `isOverInsured`.

### Compare deposits

```bash
curl -s -X POST "$PFM_API_URL/api/v1/simulate/deposit-compare" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
    "deposits": [
      {"name":"Halyk 14.5%","initialAmountCents":100000000,"annualRateBps":1450,"termMonths":12,"capitalization":"monthly"},
      {"name":"Kaspi 12%","initialAmountCents":100000000,"annualRateBps":1200,"termMonths":12,"capitalization":"quarterly"}
    ]
  }' | jq '.recommended, .explanation'
```

### Update / delete deposit

```bash
curl -s -X PATCH "$PFM_API_URL/api/v1/deposits/{id}" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"topUpCents": 50000000}' | jq

curl -s -X DELETE -H "$AUTH" "$PFM_API_URL/api/v1/deposits/{id}" | jq
```

---

## Typical Workflows

### "Сколько свободных денег / сколько можно назначить?"
1. `GET /api/v1/budget/rta-overview` → use `minReadyToAssignFormatted` as the answer
   - If `minMonth` != current month, warn: "в текущем месяце RTA = X, но в {minMonth} уже только Y"

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

### "Сколько я должен по кредитам?"
1. `GET /api/v1/loans` → show currentDebtFormatted for each loan

### "Покажи график платежей по кредиту"
1. `GET /api/v1/loans` → find loan ID
2. `GET /api/v1/loans/{id}/schedule` → amortization table

### "Кому я должен?"
1. `GET /api/v1/debts` → show debts with direction=owe
2. Summary shows totalOweCents and totalOwedCents

### "Марат вернул долг"
1. `GET /api/v1/debts` → find Марат's debt ID
2. `POST /api/v1/debts/{id}/settle` → mark as settled

### "Какие у меня вклады?"
1. `GET /api/v1/deposits` → show deposits with projected interest

### "Покажи график процентов по вкладу"
1. `GET /api/v1/deposits` → find deposit ID
2. `GET /api/v1/deposits/{id}/schedule` → interest schedule

### "Безопасны ли мои вклады по КГСС?"
1. `GET /api/v1/deposits/kdif` → check isOverInsured per bank

### "Какой вклад выгоднее — Halyk или Kaspi?"
1. `POST /api/v1/simulate/deposit-compare` → compare with schedules
