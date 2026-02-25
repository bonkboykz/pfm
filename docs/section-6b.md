# Секция 6B: MCP Server

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6b-mcp-server.md.

Create apps/mcp — MCP server that wraps @pfm/engine for AI agents.

1. Create apps/mcp/package.json:
   {
     "name": "@pfm/mcp",
     "version": "0.1.0",
     "type": "module",
     "scripts": {
       "start": "tsx src/server.ts",
       "dev": "tsx watch src/server.ts"
     },
     "dependencies": {
       "@pfm/engine": "workspace:*",
       "@modelcontextprotocol/sdk": "latest"
     },
     "devDependencies": {
       "tsx": "latest",
       "typescript": "latest"
     }
   }

2. Create apps/mcp/tsconfig.json
3. Create apps/mcp/src/server.ts — stdio transport, all tools below
4. Add to root package.json: "mcp": "pnpm --filter @pfm/mcp start"
5. Create mcp-config.json example for Claude Desktop / OpenClaw

Test: echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | pnpm mcp
Verify all tools listed with correct schemas.
```

---

## Server: apps/mcp/src/server.ts

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDb } from '@pfm/engine';

const db = createDb(process.env.PFM_DB_PATH ?? './data/pfm.db');

const server = new Server({
  name: 'pfm-budget',
  version: '0.1.0',
}, {
  capabilities: { tools: {} }
});

// Register all tools...

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Tools (11)

Каждый tool = одна функция engine или один API-эквивалент.

### 1. list_accounts

```json
{
  "name": "list_accounts",
  "description": "List all bank accounts with computed balances. Shows checking, savings, credit cards, cash accounts. Returns balance in cents and formatted string.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

→ Calls `getAccountBalances(db)`, enriches with account metadata.

### 2. get_account

```json
{
  "name": "get_account",
  "description": "Get a single account by ID with its computed balance.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "accountId": { "type": "string", "description": "Account ID" }
    },
    "required": ["accountId"]
  }
}
```

### 3. list_categories

```json
{
  "name": "list_categories",
  "description": "List all budget category groups with their categories. Shows target amounts and types.",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

### 4. get_budget

```json
{
  "name": "get_budget",
  "description": "Get full budget state for a month. Shows Ready to Assign, all category assignments, activity (spending), and available balances. Month format: YYYY-MM.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "month": { "type": "string", "description": "Budget month in YYYY-MM format, e.g. 2026-02" }
    },
    "required": ["month"]
  }
}
```

→ Calls `getBudgetMonth(db, month)`, formats with `formatMoney()`.

### 5. get_ready_to_assign

```json
{
  "name": "get_ready_to_assign",
  "description": "Get detailed Ready to Assign breakdown: total income, total assigned, and whether over-assigned. Helps user understand where their money went.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "month": { "type": "string", "description": "YYYY-MM" }
    },
    "required": ["month"]
  }
}
```

### 6. assign_budget

```json
{
  "name": "assign_budget",
  "description": "Assign money to a budget category for a specific month. This is how income gets allocated to envelopes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "categoryId": { "type": "string", "description": "Target category ID" },
      "month": { "type": "string", "description": "YYYY-MM" },
      "amountCents": { "type": "number", "description": "Amount in cents (150000₸ = 15000000)" }
    },
    "required": ["categoryId", "month", "amountCents"]
  }
}
```

### 7. move_budget

```json
{
  "name": "move_budget",
  "description": "Move money between two budget categories within a month. Use when user wants to cover overspending in one category from another.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "fromCategoryId": { "type": "string" },
      "toCategoryId": { "type": "string" },
      "month": { "type": "string", "description": "YYYY-MM" },
      "amountCents": { "type": "number", "description": "Amount to move in cents" }
    },
    "required": ["fromCategoryId", "toCategoryId", "month", "amountCents"]
  }
}
```

### 8. add_transaction

```json
{
  "name": "add_transaction",
  "description": "Record a financial transaction. For expenses: negative amountCents. For income: positive amountCents with categoryId='ready-to-assign'. For transfers between accounts: include transferAccountId (no category needed).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "accountId": { "type": "string", "description": "Source account ID" },
      "date": { "type": "string", "description": "YYYY-MM-DD" },
      "amountCents": { "type": "number", "description": "Negative for expense, positive for income" },
      "payeeName": { "type": "string", "description": "Who received/sent the money" },
      "categoryId": { "type": "string", "description": "Budget category. Use 'ready-to-assign' for income." },
      "transferAccountId": { "type": "string", "description": "Target account for transfers. Omit for regular transactions." },
      "memo": { "type": "string" }
    },
    "required": ["accountId", "date", "amountCents"]
  }
}
```

### 9. list_transactions

```json
{
  "name": "list_transactions",
  "description": "List transactions with optional filters. Use to check recent spending, find transactions by account or category.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "accountId": { "type": "string", "description": "Filter by account" },
      "categoryId": { "type": "string", "description": "Filter by category" },
      "since": { "type": "string", "description": "Start date YYYY-MM-DD" },
      "until": { "type": "string", "description": "End date YYYY-MM-DD" },
      "limit": { "type": "number", "description": "Max results (default 20)" }
    }
  }
}
```

### 10. simulate_debt_payoff (requires 6A)

```json
{
  "name": "simulate_debt_payoff",
  "description": "Simulate paying off debts with a given strategy (snowball, avalanche, etc.). Shows month-by-month schedule, total interest, and debt-free date.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "debts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "type": { "type": "string", "enum": ["credit_card", "loan", "installment"] },
            "balanceCents": { "type": "number" },
            "aprBps": { "type": "number" },
            "minPaymentCents": { "type": "number" },
            "remainingInstallments": { "type": "number" },
            "latePenaltyCents": { "type": "number" }
          },
          "required": ["name", "type", "balanceCents", "aprBps", "minPaymentCents"]
        }
      },
      "strategy": { "type": "string", "enum": ["snowball", "avalanche", "highest_monthly_interest", "cash_flow_index"] },
      "extraMonthlyCents": { "type": "number" }
    },
    "required": ["debts", "strategy"]
  }
}
```

### 11. compare_debt_strategies (requires 6A)

```json
{
  "name": "compare_debt_strategies",
  "description": "Compare all 4 debt payoff strategies side by side. Shows which saves the most money and time.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "debts": { "type": "array", "items": { "type": "object" } },
      "extraMonthlyCents": { "type": "number" }
    },
    "required": ["debts"]
  }
}
```

---

## Config Examples

### Claude Desktop: mcp-config.json

```json
{
  "mcpServers": {
    "pfm-budget": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/server.ts"],
      "cwd": "/path/to/pfm",
      "env": {
        "PFM_DB_PATH": "./data/pfm.db"
      }
    }
  }
}
```

### OpenClaw: ~/.openclaw/openclaw.json

```json
{
  "mcpServers": {
    "pfm-budget": {
      "command": "npx",
      "args": ["tsx", "apps/mcp/src/server.ts"],
      "cwd": "/path/to/pfm",
      "env": {
        "PFM_DB_PATH": "./data/pfm.db"
      }
    }
  }
}
```

---

## Response Format

Все tool responses должны включать human-readable текст:

```typescript
// Good: agent can display this to user
return {
  content: [{
    type: 'text',
    text: `Budget for February 2026:\n\nReady to Assign: -85 000 ₸ (over-assigned)\n\nПостоянные расходы:\n  Аренда: 150 000 ₸ assigned, 0 ₸ available\n  ...`
  }]
};

// Also include structured data for programmatic use
```