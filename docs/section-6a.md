# Секция 6A: Debt Payoff Engine

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6a-debt-engine.md.

Add debt payoff simulation to packages/engine and API routes to apps/api.

1. Create packages/engine/src/debt/types.ts — ALL types below
2. Create packages/engine/src/debt/simulator.ts — simulatePayoff()
3. Create packages/engine/src/debt/analyzer.ts — compareStrategies(), debtVsInvest()
4. Re-export from packages/engine/src/index.ts

5. Create apps/api/src/routes/debt.ts — 3 endpoints
6. Mount under /api/v1/simulate in apps/api/src/app.ts

7. Write packages/engine/tests/debt.test.ts with ALL scenarios below
8. Write apps/api/tests/debt-api.test.ts

9. Update packages/skill/SKILL.md with new curl examples

Run pnpm test from root, fix all failures.
```

---

## Types: packages/engine/src/debt/types.ts

```typescript
export interface DebtSnapshot {
  id: string;                        // cuid2 or user-provided
  name: string;                      // "Kaspi Red — iPhone", "Халық кредит"
  type: 'credit_card' | 'loan' | 'installment';
  balanceCents: number;              // Current outstanding (positive = owed)
  aprBps: number;                    // Annual rate in basis points (0 for Kaspi Red 0%)
  minPaymentCents: number;           // Minimum monthly payment
  remainingInstallments?: number;    // For installments (Kaspi Red): how many months left
  latePenaltyCents?: number;         // Flat penalty per missed/late payment (Kaspi Red: 200000 = 2000₸)
}

export type PayoffStrategy = 'snowball' | 'avalanche' | 'highest_monthly_interest' | 'cash_flow_index';

export interface MonthlySnapshot {
  month: number;                     // 1-based month counter
  date: string;                      // YYYY-MM
  debtStates: DebtMonthState[];
  totalPaidCents: number;            // Total paid this month
  totalRemainingCents: number;       // Sum of all remaining balances
}

export interface DebtMonthState {
  debtId: string;
  name: string;
  startBalanceCents: number;         // Balance at start of month
  interestCents: number;             // Interest accrued this month
  paymentCents: number;              // Amount paid this month
  endBalanceCents: number;           // Balance after payment
  isPaidOff: boolean;
}

export interface PayoffSimulationResult {
  strategy: PayoffStrategy;
  strategyDescription: string;
  monthsToPayoff: number;
  totalPaidCents: number;            // Sum of all payments
  totalInterestCents: number;        // Sum of all interest
  totalPenaltiesCents: number;       // Sum of all late penalties
  debtFreeDate: string;              // YYYY-MM
  schedule: MonthlySnapshot[];       // Month-by-month breakdown
  payoffOrder: string[];             // Debt IDs in order they were paid off
}

export interface StrategyComparison {
  strategies: PayoffSimulationResult[];
  recommended: PayoffStrategy;       // Lowest total cost
  savingsVsWorstCents: number;       // How much best saves vs worst
}

export interface DebtVsInvestResult {
  debtFirstNetWorthCents: number;    // Net worth if extra goes to debt
  investFirstNetWorthCents: number;  // Net worth if extra goes to investing
  recommendation: 'pay_debt' | 'invest' | 'split';
  breakEvenReturnBps: number;        // Investment return needed to match debt payoff
  explanation: string;
}
```

---

## Simulator: packages/engine/src/debt/simulator.ts

### simulatePayoff(debts, strategy, extraMonthlyCents, startDate?) → PayoffSimulationResult

Месяц-за-месяцем симуляция.

```
INPUTS:
  debts: DebtSnapshot[]           — текущие долги
  strategy: PayoffStrategy        — как сортировать (куда направлять extra)
  extraMonthlyCents: number       — дополнительно к минимальным платежам
  startDate?: string              — YYYY-MM, default: current month

ALGORITHM:

1. Clone debts into mutable state: { ...debt, currentBalance }
2. Set month = 0, date = startDate

3. LOOP while any debt has currentBalance > 0 AND month < 600:
   a. month++, advance date

   b. ACCRUE INTEREST for each active debt:
      For credit_card / loan:
        monthlyInterest = currentBalance * (aprBps / 10000) / 12
        Use Decimal.js, round to integer
      For installment (aprBps = 0):
        monthlyInterest = 0

   c. COMPUTE MINIMUM PAYMENTS:
      For credit_card:
        min = max(250000, floor(currentBalance * 0.01) + monthlyInterest)
        // max(2,500₸, 1% of balance + interest)
        Cap at currentBalance + interest (don't overpay)
      For loan:
        min = debt.minPaymentCents (fixed, from input)
        Cap at currentBalance + interest
      For installment:
        min = debt.minPaymentCents (fixed monthly installment)
        Cap at currentBalance (no interest to add)

   d. PAY MINIMUMS on all debts
      totalMinPaid = sum of all minimums

   e. COMPUTE EXTRA available:
      extra = extraMonthlyCents
      (all freed-up minimums from paid-off debts also become extra — snowball effect)
      extra += sum of minPayments of debts that were paid off in previous months

   f. SORT active debts by strategy:
      snowball:                    ascending currentBalance
      avalanche:                   descending aprBps
      highest_monthly_interest:    descending (currentBalance * aprBps / 12)
      cash_flow_index:             ascending (currentBalance / minPaymentCents)

      RE-SORT EVERY MONTH (balances change)

   g. DISTRIBUTE EXTRA to sorted debts:
      for each debt in sorted order:
        maxPayable = currentBalance + interest - alreadyPaid
        payment = min(extra, maxPayable)
        extra -= payment
        debt gets additional payment

   h. UPDATE BALANCES:
      For each debt:
        endBalance = startBalance + interest - totalPayment
        If endBalance <= 0: mark as paid off, record payoff order

   i. RECORD MonthlySnapshot

4. RETURN PayoffSimulationResult with totals and schedule
```

### Kaspi Red 0% Installment Special Rules

```
- aprBps = 0 (no interest)
- minPaymentCents = totalPrice / numberOfInstallments
- If missed (balance > 0 after scheduled payment period):
  latePenaltyCents applied per month (2,000₸ = 200000 cents)
- remainingInstallments tracks how many months left
- After remainingInstallments months, if balance > 0, penalty kicks in
```

### Strategy Descriptions

```typescript
const STRATEGY_DESCRIPTIONS: Record<PayoffStrategy, string> = {
  snowball: 'Smallest balance first. Fast psychological wins.',
  avalanche: 'Highest interest rate first. Lowest total cost.',
  highest_monthly_interest: 'Highest monthly interest charge first. Aggressive on expensive debt.',
  cash_flow_index: 'Lowest balance-to-payment ratio first. Frees cash flow fastest.',
};
```

---

## Analyzer: packages/engine/src/debt/analyzer.ts

### compareStrategies(debts, extraMonthlyCents, startDate?) → StrategyComparison

```
1. Run simulatePayoff for each of 4 strategies
2. Sort by totalPaidCents ascending
3. recommended = strategy with lowest totalPaidCents
4. savingsVsWorst = worst.totalPaid - best.totalPaid
```

### debtVsInvest(extraMonthlyCents, debt, expectedReturnBps, horizonMonths) → DebtVsInvestResult

Сравнение: платить долг extra или инвестировать.

```
Scenario A (debt first):
  1. Simulate payoff with extra
  2. After debt paid off, invest freed money for remaining months
  3. Investment growth: compound monthly at expectedReturnBps / 12
  4. Net worth = investment balance (debt is 0)

Scenario B (invest first):
  1. Pay only minimums on debt
  2. Invest extra every month
  3. After horizonMonths:
     Net worth = investment balance - remaining debt balance

Compare net worths.

breakEvenReturnBps: binary search for return rate where both scenarios equal.

recommendation:
  if debtFirst > investFirst by >5%: 'pay_debt'
  if investFirst > debtFirst by >5%: 'invest'
  else: 'split'
```

---

## API Routes: apps/api/src/routes/debt.ts

### POST /api/v1/simulate/payoff

```typescript
// Request
{
  "debts": [
    {
      "id": "kaspi-red",
      "name": "Kaspi Red — iPhone 16",
      "type": "installment",
      "balanceCents": 45000000,     // 450,000₸ remaining
      "aprBps": 0,
      "minPaymentCents": 15000000,  // 150,000₸/month
      "remainingInstallments": 3,
      "latePenaltyCents": 200000    // 2,000₸
    },
    {
      "id": "halyk-loan",
      "name": "Халық банк кредит",
      "type": "loan",
      "balanceCents": 120000000,    // 1,200,000₸
      "aprBps": 1850,               // 18.5%
      "minPaymentCents": 8500000    // 85,000₸/month
    }
  ],
  "strategy": "avalanche",
  "extraMonthlyCents": 5000000      // 50,000₸ extra/month
}

// Response
{
  "strategy": "avalanche",
  "strategyDescription": "Highest interest rate first. Lowest total cost.",
  "monthsToPayoff": 14,
  "totalPaidCents": 170500000,
  "totalPaidFormatted": "1 705 000 ₸",
  "totalInterestCents": 12300000,
  "totalInterestFormatted": "123 000 ₸",
  "debtFreeDate": "2027-04",
  "payoffOrder": ["kaspi-red", "halyk-loan"],
  "schedule": [ ... ]               // MonthlySnapshot[]
}
```

Zod schema:
```typescript
const debtSchema = z.object({
  id: z.string().optional(),          // auto-generate if missing
  name: z.string(),
  type: z.enum(['credit_card', 'loan', 'installment']),
  balanceCents: z.number().int().positive(),
  aprBps: z.number().int().min(0),
  minPaymentCents: z.number().int().positive(),
  remainingInstallments: z.number().int().positive().optional(),
  latePenaltyCents: z.number().int().min(0).optional(),
});

const payoffRequestSchema = z.object({
  debts: z.array(debtSchema).min(1).max(20),
  strategy: z.enum(['snowball', 'avalanche', 'highest_monthly_interest', 'cash_flow_index']),
  extraMonthlyCents: z.number().int().min(0).default(0),
  startDate: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
```

### POST /api/v1/simulate/compare

```typescript
// Request
{
  "debts": [ ... ],                  // same as payoff
  "extraMonthlyCents": 5000000
}

// Response
{
  "strategies": [ ...4 results... ],
  "recommended": "avalanche",
  "savingsVsWorstCents": 4500000,
  "savingsVsWorstFormatted": "45 000 ₸"
}
```

### POST /api/v1/simulate/debt-vs-invest

```typescript
// Request
{
  "extraMonthlyCents": 5000000,
  "debt": { ... single DebtSnapshot },
  "expectedReturnBps": 1200,        // 12% annual
  "horizonMonths": 24
}

// Response
{
  "debtFirstNetWorthCents": 15000000,
  "debtFirstFormatted": "150 000 ₸",
  "investFirstNetWorthCents": 12500000,
  "investFirstFormatted": "125 000 ₸",
  "recommendation": "pay_debt",
  "breakEvenReturnBps": 2100,       // need 21% return to justify investing
  "explanation": "Paying off the 18.5% loan first yields 25,000₸ more than investing at 12%."
}
```

---

## Test Scenarios

### Test 1: Single 0% installment (Kaspi Red)

```
Debt: 450k₸, 0%, 150k/month, 3 installments
Extra: 0
Expected: 3 months, total paid = 450k, interest = 0
```

### Test 2: Single credit card

```
Debt: 500k₸, 24%, min = max(2500₸, 1% + interest)
Extra: 50k₸/month
Expected: pays off in ~9 months, total interest < 50k₸
```

### Test 3: Snowball vs Avalanche

```
Debts:
  A: 100k₸, 24% APR, 10k min
  B: 500k₸, 12% APR, 25k min
  C: 50k₸, 0%, 25k min (installment)
Extra: 20k/month

Snowball order: C, A, B (smallest balance first)
Avalanche order: A, B, C (highest rate first)
Avalanche should have lower total interest.
```

### Test 4: Late penalty on overdue installment

```
Kaspi Red: 150k₸, 0%, 50k/month, 2 installments remaining
Pay only 30k/month (less than min)
After 2 months installment period, 2000₸/month penalty kicks in
```

### Test 5: Debt vs Invest

```
Debt: 1M₸, 18.5%, 85k/month
Extra: 50k, Return: 12%, Horizon: 24 months
Expected: pay_debt (18.5% > 12%)

Same but Return: 25%
Expected: invest (25% > 18.5%)
```

### Test 6: All debts paid off = empty schedule

```
Debts: all with 0 balance
Expected: 0 months, empty schedule
```

---

## SKILL.md Addition

```bash
## Simulate Debt Payoff

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

## Compare All Strategies

curl -s -X POST "$PFM_API_URL/api/v1/simulate/compare" \
  -H "Content-Type: application/json" \
  -d '{
    "debts": [...],
    "extraMonthlyCents": 5000000
  }' | jq '.recommended, .savingsVsWorstFormatted'

## Debt vs Invest

curl -s -X POST "$PFM_API_URL/api/v1/simulate/debt-vs-invest" \
  -H "Content-Type: application/json" \
  -d '{
    "extraMonthlyCents":5000000,
    "debt":{"name":"Халық","type":"loan","balanceCents":120000000,"aprBps":1850,"minPaymentCents":8500000},
    "expectedReturnBps":1200,
    "horizonMonths":24
  }' | jq '.recommendation, .explanation'
```