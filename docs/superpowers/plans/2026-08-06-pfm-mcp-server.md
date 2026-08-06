# PFM MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose PFM to Claude Desktop as a remote MCP server with 48 tools, mounted inside the existing `api` service so it shares the production database.

**Architecture:** A new `@pfm/mcp` package holds a declarative tool table and `createMcpServer(dispatch)`. Each tool maps its arguments to an HTTP method + path + body; a `Dispatch` function performs the call. `apps/api` supplies the real dispatch by routing into an internal Hono app built from the same route factories that serve REST — so the route handlers stay the single source of truth and no business logic is duplicated. The MCP endpoint is `POST /mcp/:token` using the SDK's Web-standard streamable-HTTP transport, which speaks `Request`/`Response` and therefore drops straight into Hono.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` 1.29, Hono 4.12, Zod 4.3, Vitest 4, pnpm workspaces + Turborepo.

## Global Constraints

- Node 22+ (repo runs on v24); TS execution via `tsx`, packages consumed as raw TS (`"main": "src/index.ts"`), matching `@pfm/engine`.
- Zod is **v4.3.6** in this repo, not v3. MCP SDK 1.29 supports both through its `zod-compat` layer (`zod: "^3.25 || ^4.0"`), so `inputSchema` accepts a full `z.object(...)` instance. Do not "fix" this by downgrading Zod.
- Money is integer tiyn (1/100 ₸). Negative `amountCents` = outflow. Never do raw arithmetic on money in new code — this package does none, it only passes values through.
- Dates: transactions `YYYY-MM-DD`, budget months `YYYY-MM`, APR in basis points.
- Tool names: `snake_case`, matching `/^[a-z][a-z0-9_]*$/`.
- `@pfm/mcp` MUST NOT import `@pfm/api` or `@pfm/engine` — `apps/api` depends on `@pfm/mcp`, and the reverse would create a cycle. The `dispatch` argument is the only seam.
- Existing REST behaviour must not change. The only edit to `app.ts` is one `app.route(...)` line plus reusing an extracted error handler.
- Spec: `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md`.

## Deviations from the spec (approved, apply as written here)

The spec described the transport using `HttpBindings` + `RESPONSE_ALREADY_SENT`, copying HTR. SDK 1.29 ships `WebStandardStreamableHTTPServerTransport` with `handleRequest(req: Request): Promise<Response>`, which is Hono-native and removes the Node `incoming`/`outgoing` plumbing entirely. Use the Web-standard transport. Task 7 updates the spec text to match.

The transport is created with `enableJsonResponse: true`. In stateless mode this makes the reply a fully materialised JSON body rather than an SSE stream, so the per-request transport and server can be closed as soon as `handleRequest` resolves, with no risk of truncating a stream still being read.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `apps/mcp/package.json` | Package manifest for `@pfm/mcp` |
| `apps/mcp/tsconfig.json` | Build config, mirrors `apps/api` |
| `apps/mcp/vitest.config.ts` | Test config, mirrors `apps/api` |
| `apps/mcp/src/dispatch.ts` | `Dispatch` / `DispatchResult` types — the seam |
| `apps/mcp/src/tools.ts` | `ToolDef` type, `qs`/`omitId` helpers, all 48 tool definitions |
| `apps/mcp/src/server.ts` | `createMcpServer(dispatch)` — registration + result/error mapping |
| `apps/mcp/src/index.ts` | Public exports |
| `apps/mcp/tests/tools.test.ts` | Table invariants, path/body mapping, in-memory client round-trip |
| `apps/api/src/mcp.ts` | Internal router, auth, `POST /mcp/:token` |
| `apps/api/tests/mcp.test.ts` | End-to-end over `app.request()` |

**Modified:**

| File | Change |
|---|---|
| `apps/api/src/errors.ts` | Extract the `onError` body into an exported `errorHandler` |
| `apps/api/src/app.ts:22-34` | Use `errorHandler`; add `app.route('/mcp', mcpRoutes(db))` |
| `apps/api/package.json` | Add `@pfm/mcp` + `@modelcontextprotocol/sdk` deps |
| `.env.example` | Add `PFM_MCP_TOKEN` |
| `CLAUDE.md` | `apps/mcp` is no longer "post-MVP" |
| `docs/section-6b.md` | Rewrite to match what was built |
| `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md` | Record the transport deviation |

---

## Task 1: Package scaffold, dispatch seam, server, and the accounts tools

This task establishes every pattern the next four tasks repeat mechanically. Do not proceed to Task 2 until its tests pass — a generics problem with `inputSchema` surfaces here or nowhere.

**Files:**
- Create: `apps/mcp/package.json`, `apps/mcp/tsconfig.json`, `apps/mcp/vitest.config.ts`
- Create: `apps/mcp/src/dispatch.ts`, `apps/mcp/src/tools.ts`, `apps/mcp/src/server.ts`, `apps/mcp/src/index.ts`
- Test: `apps/mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'`
  - `interface DispatchResult { status: number; body: unknown }`
  - `type Dispatch = (method: HttpMethod, path: string, body?: unknown) => Promise<DispatchResult>`
  - `interface ToolDef { name: string; description: string; schema: z.ZodObject<z.ZodRawShape>; method: HttpMethod; path: (args: any) => string; body?: (args: any) => unknown }`
  - `const tools: ToolDef[]`
  - `function createMcpServer(dispatch: Dispatch): McpServer`
  - helpers `qs(params)` and `omitId(args)` (module-private to `tools.ts`)

- [ ] **Step 1: Create the package manifest**

`apps/mcp/package.json`:

```json
{
  "name": "@pfm/mcp",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "latest"
  },
  "devDependencies": {
    "tsx": "latest",
    "vitest": "latest",
    "typescript": "latest"
  }
}
```

Note the absence of `@pfm/engine` — this package touches no database.

- [ ] **Step 2: Create build and test config**

`apps/mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`apps/mcp/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true } });
```

- [ ] **Step 3: Install so the workspace picks up the new package**

Run: `pnpm install`
Expected: pnpm reports `+ apps/mcp` among the importers and creates `apps/mcp/node_modules`.

- [ ] **Step 4: Write the dispatch seam**

`apps/mcp/src/dispatch.ts`:

```typescript
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface DispatchResult {
  /** HTTP status returned by the route. >= 400 marks the tool result as an error. */
  status: number;
  /** Parsed JSON body, or the raw text when the response was not JSON. */
  body: unknown;
}

/**
 * Performs one call against the PFM REST surface.
 *
 * This is the only seam between the MCP tool table and the API. Production
 * wiring routes into an in-process Hono app; tests pass a recorder.
 */
export type Dispatch = (method: HttpMethod, path: string, body?: unknown) => Promise<DispatchResult>;
```

- [ ] **Step 5: Write the failing test**

`apps/mcp/tests/tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tools } from '../src/tools.js';
import { createMcpServer } from '../src/server.js';
import type { Dispatch, DispatchResult } from '../src/dispatch.js';

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function recorder(result: DispatchResult = { status: 200, body: { ok: true } }) {
  const calls: Call[] = [];
  const dispatch: Dispatch = async (method, path, body) => {
    calls.push({ method, path, body });
    return result;
  };
  return { calls, dispatch };
}

function tool(name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no such tool: ${name}`);
  return found;
}

/** Builds the (method, path, body) a tool would dispatch for the given args. */
function mapping(name: string, args: Record<string, unknown>) {
  const t = tool(name);
  return {
    method: t.method,
    path: t.path(args),
    body: t.body ? t.body(args) : undefined,
  };
}

async function connectedClient(dispatch: Dispatch) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(dispatch);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('tool table invariants', () => {
  it('has unique snake_case names', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('describes every tool', () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it('only produces paths under /api/v1/', () => {
    for (const t of tools) {
      const sample = t.path({ id: 'x', month: '2026-08' });
      expect(sample.startsWith('/api/v1/')).toBe(true);
    }
  });
});

describe('accounts tools', () => {
  it('lists accounts with no arguments', () => {
    expect(mapping('list_accounts', {})).toEqual({
      method: 'GET',
      path: '/api/v1/accounts',
      body: undefined,
    });
  });

  it('reads one account by id', () => {
    expect(mapping('get_account', { id: 'acc-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/accounts/acc-1',
      body: undefined,
    });
  });

  it('creates an account with the whole argument object as body', () => {
    expect(mapping('create_account', { name: 'Kaspi Gold', type: 'checking' })).toEqual({
      method: 'POST',
      path: '/api/v1/accounts',
      body: { name: 'Kaspi Gold', type: 'checking' },
    });
  });

  it('strips id from the body when updating', () => {
    expect(mapping('update_account', { id: 'acc-1', name: 'Renamed' })).toEqual({
      method: 'PATCH',
      path: '/api/v1/accounts/acc-1',
      body: { name: 'Renamed' },
    });
  });

  it('deletes an account by id', () => {
    expect(mapping('delete_account', { id: 'acc-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/accounts/acc-1',
      body: undefined,
    });
  });
});

describe('server wiring', () => {
  it('registers every tool from the table', async () => {
    const client = await connectedClient(recorder().dispatch);
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(tools.length);
  });

  it('returns the route body as text content', async () => {
    const { calls, dispatch } = recorder({ status: 200, body: [{ id: 'acc-1' }] });
    const client = await connectedClient(dispatch);

    const result = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(calls).toEqual([{ method: 'GET', path: '/api/v1/accounts', body: undefined }]);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual([{ id: 'acc-1' }]);
  });

  it('marks non-2xx responses as errors and passes the payload through', async () => {
    const payload = {
      error: { code: 'NOT_FOUND', message: "Account 'nope' not found", suggestion: 'Use GET /api/v1/accounts' },
    };
    const client = await connectedClient(recorder({ status: 404, body: payload }).dispatch);

    const result = await client.callTool({ name: 'get_account', arguments: { id: 'nope' } });

    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(payload);
  });

  it('wraps a thrown dispatch into an INTERNAL_ERROR result', async () => {
    const dispatch: Dispatch = async () => {
      throw new Error('socket hang up');
    };
    const client = await connectedClient(dispatch);

    const result = await client.callTool({ name: 'list_accounts', arguments: {} });

    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('socket hang up');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @pfm/mcp test`
Expected: FAIL — `Failed to resolve import "../src/tools.js"`.

- [ ] **Step 7: Write the tool table with the accounts group**

`apps/mcp/src/tools.ts`:

```typescript
import { z } from 'zod';
import type { HttpMethod } from './dispatch.js';

export interface ToolDef {
  name: string;
  description: string;
  /** Argument schema. Shown to the model; the route re-validates on arrival. */
  schema: z.ZodObject<z.ZodRawShape>;
  method: HttpMethod;
  path: (args: any) => string;
  /** Omit for GET/DELETE. */
  body?: (args: any) => unknown;
}

/** Builds a query string, dropping undefined values. Returns '' when empty. */
function qs(params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** PATCH tools take `id` for the path; it must not travel in the body. */
function omitId<T extends Record<string, unknown>>(args: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = args;
  return rest;
}

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking'] as const;
const CARD_TYPES = ['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other'] as const;

export const tools: ToolDef[] = [
  // ===== Accounts =====
  {
    name: 'list_accounts',
    description:
      'List all active accounts with computed balances. Each entry carries balanceCents plus balanceFormatted, and the cleared/uncleared split. Start here to discover account IDs.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/accounts',
  },
  {
    name: 'get_account',
    description: 'Get one account by id, including its computed balance and cleared/uncleared split.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/accounts/${a.id}`,
  },
  {
    name: 'create_account',
    description:
      'Create an account. type "tracking" is always off-budget; every other type defaults to on-budget. Currency defaults to KZT.',
    schema: z.object({
      name: z.string().min(1),
      type: z.enum(ACCOUNT_TYPES),
      onBudget: z.boolean().optional(),
      currency: z.string().optional(),
      note: z.string().optional(),
      bankName: z.string().optional(),
      last4Digits: z.string().length(4).optional(),
      cardType: z.enum(CARD_TYPES).optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/accounts',
    body: (a) => a,
  },
  {
    name: 'update_account',
    description: 'Update an account. Only the supplied fields change. Nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      onBudget: z.boolean().optional(),
      currency: z.string().optional(),
      sortOrder: z.number().int().optional(),
      note: z.string().nullable().optional(),
      bankName: z.string().nullable().optional(),
      last4Digits: z.string().length(4).nullable().optional(),
      cardType: z.enum(CARD_TYPES).nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/accounts/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_account',
    description:
      'Deactivate an account. This hides the account and its history from balances. Prefer fixing individual transactions over deleting an account.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/accounts/${a.id}`,
  },
];
```

- [ ] **Step 8: Write the server**

`apps/mcp/src/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Dispatch } from './dispatch.js';
import { tools } from './tools.js';

/**
 * Builds an McpServer with every PFM tool registered against the given dispatch.
 *
 * Tool results carry the route's JSON body verbatim: the REST layer already
 * emits both `*Cents` and `*Formatted` money fields, so no second renderer.
 */
export function createMcpServer(dispatch: Dispatch): McpServer {
  const server = new McpServer({ name: 'pfm', version: '0.4.0' });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => {
        try {
          const { status, body } = await dispatch(
            tool.method,
            tool.path(args ?? {}),
            tool.body ? tool.body(args ?? {}) : undefined,
          );
          return {
            isError: status >= 400,
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: { code: 'INTERNAL_ERROR', message, suggestion: 'Check the API server logs' },
                }),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}
```

If TypeScript rejects `inputSchema: tool.schema` on generic inference, the supported fallback is `inputSchema: tool.schema.shape` — `zod-compat.normalizeObjectSchema` accepts a raw shape too. Try the schema form first; it is unambiguous for the several zero-argument tools.

- [ ] **Step 9: Write the public exports**

`apps/mcp/src/index.ts`:

```typescript
export { createMcpServer } from './server.js';
export { tools } from './tools.js';
export type { ToolDef } from './tools.js';
export type { Dispatch, DispatchResult, HttpMethod } from './dispatch.js';
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm --filter @pfm/mcp test`
Expected: PASS — 12 tests. `registers every tool from the table` asserts against `tools.length`, so it stays green as the table grows.

- [ ] **Step 11: Verify the package type-checks**

Run: `pnpm --filter @pfm/mcp build`
Expected: exit 0, `apps/mcp/dist/` produced.

- [ ] **Step 12: Commit**

```bash
git add apps/mcp pnpm-lock.yaml
git commit -m "feat(mcp): scaffold @pfm/mcp with dispatch seam and accounts tools"
```

---

## Task 2: Categories and budget tools

**Files:**
- Modify: `apps/mcp/src/tools.ts` (append to the `tools` array)
- Test: `apps/mcp/tests/tools.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: `ToolDef`, `qs`, `omitId` from Task 1.
- Produces: 10 more entries in `tools`. No new exported types.

Route-ordering note: `/api/v1/budget/rta-overview` is registered before `/:month` in `budget.ts`, so the literal path wins. Do not reorder tools to compensate — the tool table has no bearing on Hono matching.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mcp/tests/tools.test.ts`:

```typescript
describe('categories tools', () => {
  it('lists category groups with their categories', () => {
    expect(mapping('list_categories', {})).toEqual({
      method: 'GET',
      path: '/api/v1/categories',
      body: undefined,
    });
  });

  it('creates a group', () => {
    expect(mapping('create_category_group', { name: 'Fixed' })).toEqual({
      method: 'POST',
      path: '/api/v1/categories/groups',
      body: { name: 'Fixed' },
    });
  });

  it('creates a category inside a group', () => {
    expect(mapping('create_category', { groupId: 'grp-fixed', name: 'Rent' })).toEqual({
      method: 'POST',
      path: '/api/v1/categories',
      body: { groupId: 'grp-fixed', name: 'Rent' },
    });
  });

  it('strips id when updating a category', () => {
    expect(mapping('update_category', { id: 'cat-rent', name: 'Rent & utilities' })).toEqual({
      method: 'PATCH',
      path: '/api/v1/categories/cat-rent',
      body: { name: 'Rent & utilities' },
    });
  });

  it('deletes a category', () => {
    expect(mapping('delete_category', { id: 'cat-rent' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/categories/cat-rent',
      body: undefined,
    });
  });
});

describe('budget tools', () => {
  it('reads a month', () => {
    expect(mapping('get_budget', { month: '2026-08' })).toEqual({
      method: 'GET',
      path: '/api/v1/budget/2026-08',
      body: undefined,
    });
  });

  it('reads the RTA overview without a from filter', () => {
    expect(mapping('get_rta_overview', {})).toEqual({
      method: 'GET',
      path: '/api/v1/budget/rta-overview',
      body: undefined,
    });
  });

  it('reads the RTA overview with a from filter', () => {
    expect(mapping('get_rta_overview', { from: '2026-01' })).toEqual({
      method: 'GET',
      path: '/api/v1/budget/rta-overview?from=2026-01',
      body: undefined,
    });
  });

  it('reads ready-to-assign for a month', () => {
    expect(mapping('get_ready_to_assign', { month: '2026-08' })).toEqual({
      method: 'GET',
      path: '/api/v1/budget/2026-08/ready-to-assign',
      body: undefined,
    });
  });

  it('assigns money, keeping month in the path only', () => {
    expect(mapping('assign_budget', { month: '2026-08', categoryId: 'cat-rent', amountCents: 15000000 })).toEqual({
      method: 'POST',
      path: '/api/v1/budget/2026-08/assign',
      body: { categoryId: 'cat-rent', amountCents: 15000000 },
    });
  });

  it('moves money between categories', () => {
    expect(
      mapping('move_budget', {
        month: '2026-08',
        fromCategoryId: 'cat-cafe',
        toCategoryId: 'cat-groceries',
        amountCents: 500000,
      }),
    ).toEqual({
      method: 'POST',
      path: '/api/v1/budget/2026-08/move',
      body: { fromCategoryId: 'cat-cafe', toCategoryId: 'cat-groceries', amountCents: 500000 },
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pfm/mcp test`
Expected: FAIL — `no such tool: list_categories` and the other nine new tools.

- [ ] **Step 3: Append the tools**

Add before the closing `];` of the `tools` array in `apps/mcp/src/tools.ts`:

```typescript
  // ===== Categories =====
  {
    name: 'list_categories',
    description:
      'List category groups with their categories, excluding system and hidden ones. Use this to discover category IDs before assigning money or filing a transaction.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/categories',
  },
  {
    name: 'create_category_group',
    description: 'Create a category group — the heading that categories are filed under, e.g. "Fixed costs".',
    schema: z.object({ name: z.string().min(1) }),
    method: 'POST',
    path: () => '/api/v1/categories/groups',
    body: (a) => a,
  },
  {
    name: 'create_category',
    description:
      'Create a category inside a group. Optional target: targetType "monthly_funding" | "target_balance" | "target_by_date" with targetAmountCents in tiyn, and targetDate as YYYY-MM-DD for date targets.',
    schema: z.object({
      groupId: z.string().min(1),
      name: z.string().min(1),
      targetAmountCents: z.number().int().optional(),
      targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
      targetDate: z.string().optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/categories',
    body: (a) => a,
  },
  {
    name: 'update_category',
    description: 'Update a category name, target or note. Nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      targetAmountCents: z.number().int().nullable().optional(),
      targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
      targetDate: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/categories/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_category',
    description: 'Hide a category. Its past transactions keep their history; the category stops appearing in the budget.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/categories/${a.id}`,
  },

  // ===== Budget =====
  {
    name: 'get_budget',
    description:
      'Full budget for a month (YYYY-MM): every category with assigned, activity and available in tiyn plus formatted variants, grouped by category group, and Ready to Assign for that month.',
    schema: z.object({ month: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/${a.month}`,
  },
  {
    name: 'get_rta_overview',
    description:
      'Ready to Assign across a range of months at once, starting at optional `from` (YYYY-MM). Use this instead of calling get_ready_to_assign month by month when diagnosing where money went missing — RTA is cumulative, so a single month in isolation misleads.',
    schema: z.object({ from: z.string().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/rta-overview${qs({ from: a.from })}`,
  },
  {
    name: 'get_ready_to_assign',
    description:
      'Ready to Assign for one month (YYYY-MM) with its breakdown: total inflows and total assigned, computed cumulatively from the beginning through that month.',
    schema: z.object({ month: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/budget/${a.month}/ready-to-assign`,
  },
  {
    name: 'assign_budget',
    description:
      'Set the amount assigned to a category for a month (YYYY-MM). amountCents is the new total for that month in tiyn, not a delta, and must be zero or positive.',
    schema: z.object({
      month: z.string(),
      categoryId: z.string().min(1),
      amountCents: z.number().int().min(0),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/assign`,
    body: (a) => ({ categoryId: a.categoryId, amountCents: a.amountCents }),
  },
  {
    name: 'move_budget',
    description:
      'Move assigned money between two categories within a month (YYYY-MM). amountCents must be positive and is taken from the source and added to the target. This is how you cover an overspent category without touching Ready to Assign.',
    schema: z.object({
      month: z.string(),
      fromCategoryId: z.string().min(1),
      toCategoryId: z.string().min(1),
      amountCents: z.number().int().positive(),
    }),
    method: 'POST',
    path: (a) => `/api/v1/budget/${a.month}/move`,
    body: (a) => ({
      fromCategoryId: a.fromCategoryId,
      toCategoryId: a.toCategoryId,
      amountCents: a.amountCents,
    }),
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @pfm/mcp test`
Expected: PASS — 23 tests, `tools` now has 15 entries.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp
git commit -m "feat(mcp): add categories and budget tools"
```

---

## Task 3: Transaction and scheduled-transaction tools

**Files:**
- Modify: `apps/mcp/src/tools.ts`
- Test: `apps/mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef`, `qs`, `omitId` from Task 1.
- Produces: 10 more entries in `tools`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mcp/tests/tools.test.ts`:

```typescript
describe('transaction tools', () => {
  it('lists with no filters', () => {
    expect(mapping('list_transactions', {})).toEqual({
      method: 'GET',
      path: '/api/v1/transactions',
      body: undefined,
    });
  });

  it('lists with every filter', () => {
    expect(
      mapping('list_transactions', {
        accountId: 'acc-1',
        categoryId: 'cat-rent',
        since: '2026-08-01',
        until: '2026-08-31',
        limit: 100,
      }),
    ).toEqual({
      method: 'GET',
      path: '/api/v1/transactions?accountId=acc-1&categoryId=cat-rent&since=2026-08-01&until=2026-08-31&limit=100',
      body: undefined,
    });
  });

  it('reads one transaction', () => {
    expect(mapping('get_transaction', { id: 'tx-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/transactions/tx-1',
      body: undefined,
    });
  });

  it('creates a transaction', () => {
    expect(
      mapping('create_transaction', {
        accountId: 'acc-1',
        date: '2026-08-06',
        amountCents: -1250000,
        payeeName: 'Magnum',
        categoryId: 'cat-groceries',
      }),
    ).toEqual({
      method: 'POST',
      path: '/api/v1/transactions',
      body: {
        accountId: 'acc-1',
        date: '2026-08-06',
        amountCents: -1250000,
        payeeName: 'Magnum',
        categoryId: 'cat-groceries',
      },
    });
  });

  it('strips id when updating', () => {
    expect(mapping('update_transaction', { id: 'tx-1', amountCents: -1300000 })).toEqual({
      method: 'PATCH',
      path: '/api/v1/transactions/tx-1',
      body: { amountCents: -1300000 },
    });
  });

  it('deletes a transaction', () => {
    expect(mapping('delete_transaction', { id: 'tx-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/transactions/tx-1',
      body: undefined,
    });
  });
});

describe('scheduled transaction tools', () => {
  it('lists all scheduled transactions', () => {
    expect(mapping('list_scheduled', {})).toEqual({
      method: 'GET',
      path: '/api/v1/scheduled',
      body: undefined,
    });
  });

  it('lists only upcoming ones', () => {
    expect(mapping('list_scheduled', { upcoming: 30 })).toEqual({
      method: 'GET',
      path: '/api/v1/scheduled?upcoming=30',
      body: undefined,
    });
  });

  it('creates a scheduled transaction', () => {
    expect(
      mapping('create_scheduled', {
        accountId: 'acc-1',
        frequency: 'monthly',
        nextDate: '2026-09-01',
        amountCents: -15000000,
        payeeName: 'Landlord',
      }),
    ).toEqual({
      method: 'POST',
      path: '/api/v1/scheduled',
      body: {
        accountId: 'acc-1',
        frequency: 'monthly',
        nextDate: '2026-09-01',
        amountCents: -15000000,
        payeeName: 'Landlord',
      },
    });
  });

  it('strips id when updating', () => {
    expect(mapping('update_scheduled', { id: 'sch-1', amountCents: -16000000 })).toEqual({
      method: 'PATCH',
      path: '/api/v1/scheduled/sch-1',
      body: { amountCents: -16000000 },
    });
  });

  it('deletes a scheduled transaction', () => {
    expect(mapping('delete_scheduled', { id: 'sch-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/scheduled/sch-1',
      body: undefined,
    });
  });

  it('processes due transactions, defaulting to an empty body', () => {
    expect(mapping('process_scheduled', {})).toEqual({
      method: 'POST',
      path: '/api/v1/scheduled/process',
      body: {},
    });
  });

  it('processes due transactions as of a date', () => {
    expect(mapping('process_scheduled', { asOfDate: '2026-08-31' })).toEqual({
      method: 'POST',
      path: '/api/v1/scheduled/process',
      body: { asOfDate: '2026-08-31' },
    });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pfm/mcp test`
Expected: FAIL — `no such tool: list_transactions` and the other nine new tools.

- [ ] **Step 3: Append the tools**

Add before the closing `];` in `apps/mcp/src/tools.ts`:

```typescript
  // ===== Transactions =====
  {
    name: 'list_transactions',
    description:
      'List transactions newest first, default limit 50. Filter by accountId, categoryId and a since/until date range (YYYY-MM-DD). Amounts are tiyn; negative is an outflow.',
    schema: z.object({
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    method: 'GET',
    path: (a) =>
      `/api/v1/transactions${qs({
        accountId: a.accountId,
        categoryId: a.categoryId,
        since: a.since,
        until: a.until,
        limit: a.limit,
      })}`,
  },
  {
    name: 'get_transaction',
    description: 'Get one transaction by id.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/transactions/${a.id}`,
  },
  {
    name: 'create_transaction',
    description:
      'Record a transaction. amountCents is tiyn: negative for spending, positive for income. Supplying transferAccountId makes it a transfer between two accounts — the API writes both paired sides and leaves them uncategorised, which is correct and must not be "fixed" by also passing categoryId.',
    schema: z.object({
      accountId: z.string().min(1),
      date: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/transactions',
    body: (a) => a,
  },
  {
    name: 'update_transaction',
    description:
      'Update a transaction. Only supplied fields change. categoryId and memo accept null to clear them. To recategorise a transfer, edit the accounts instead — transfers carry no category by design.',
    schema: z.object({
      id: z.string(),
      date: z.string().optional(),
      amountCents: z.number().int().optional(),
      payeeName: z.string().optional(),
      categoryId: z.string().nullable().optional(),
      memo: z.string().nullable().optional(),
      cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/transactions/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_transaction',
    description:
      'Delete a transaction. Use this for typos and duplicates. Deleting one side of a transfer is handled by the API.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/transactions/${a.id}`,
  },

  // ===== Scheduled transactions =====
  {
    name: 'list_scheduled',
    description:
      'List scheduled (recurring) transactions. Pass upcoming as a number of days to only return the ones due within that window.',
    schema: z.object({ upcoming: z.number().int().positive().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/scheduled${qs({ upcoming: a.upcoming })}`,
  },
  {
    name: 'create_scheduled',
    description:
      'Create a recurring transaction. frequency is weekly, biweekly, monthly or yearly; nextDate (YYYY-MM-DD) is the next occurrence. amountCents is tiyn, negative for spending. Supplying transferAccountId schedules a recurring transfer.',
    schema: z.object({
      accountId: z.string().min(1),
      frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']),
      nextDate: z.string(),
      amountCents: z.number().int(),
      payeeName: z.string().optional(),
      categoryId: z.string().optional(),
      transferAccountId: z.string().optional(),
      memo: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/scheduled',
    body: (a) => a,
  },
  {
    name: 'update_scheduled',
    description: 'Update a scheduled transaction. Only supplied fields change; nullable fields accept null to clear them.',
    schema: z.object({
      id: z.string(),
      frequency: z.enum(['weekly', 'biweekly', 'monthly', 'yearly']).optional(),
      nextDate: z.string().optional(),
      amountCents: z.number().int().optional(),
      payeeName: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      transferAccountId: z.string().nullable().optional(),
      memo: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/scheduled/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_scheduled',
    description: 'Delete a scheduled transaction. Already-created transactions from past occurrences are not affected.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/scheduled/${a.id}`,
  },
  {
    name: 'process_scheduled',
    description:
      'Create real transactions for every scheduled item due on or before asOfDate (YYYY-MM-DD, defaults to today) and advance each to its next occurrence. This writes to the ledger — confirm with the user before calling it.',
    schema: z.object({ asOfDate: z.string().optional() }),
    method: 'POST',
    path: () => '/api/v1/scheduled/process',
    body: (a) => (a.asOfDate === undefined ? {} : { asOfDate: a.asOfDate }),
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @pfm/mcp test`
Expected: PASS — 36 tests, `tools` now has 25 entries.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp
git commit -m "feat(mcp): add transaction and scheduled-transaction tools"
```

---

## Task 4: Loan and personal-debt tools

**Files:**
- Modify: `apps/mcp/src/tools.ts`
- Test: `apps/mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef`, `qs`, `omitId` from Task 1.
- Produces: 12 more entries in `tools`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mcp/tests/tools.test.ts`:

```typescript
describe('loan tools', () => {
  it('lists loans', () => {
    expect(mapping('list_loans', {})).toEqual({ method: 'GET', path: '/api/v1/loans', body: undefined });
  });

  it('reads one loan', () => {
    expect(mapping('get_loan', { id: 'loan-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/loans/loan-1',
      body: undefined,
    });
  });

  it('reads the amortization schedule', () => {
    expect(mapping('get_loan_schedule', { id: 'loan-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/loans/loan-1/schedule',
      body: undefined,
    });
  });

  it('creates a loan', () => {
    const args = {
      name: 'Halyk auto',
      type: 'loan',
      principalCents: 500000000,
      aprBps: 1850,
      termMonths: 60,
      startDate: '2026-01-15',
      monthlyPaymentCents: 12800000,
      paymentDay: 15,
    };
    expect(mapping('create_loan', args)).toEqual({ method: 'POST', path: '/api/v1/loans', body: args });
  });

  it('strips id when updating', () => {
    expect(mapping('update_loan', { id: 'loan-1', monthlyPaymentCents: 13000000 })).toEqual({
      method: 'PATCH',
      path: '/api/v1/loans/loan-1',
      body: { monthlyPaymentCents: 13000000 },
    });
  });

  it('deletes a loan', () => {
    expect(mapping('delete_loan', { id: 'loan-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/loans/loan-1',
      body: undefined,
    });
  });
});

describe('personal debt tools', () => {
  it('lists unsettled debts by default', () => {
    expect(mapping('list_debts', {})).toEqual({ method: 'GET', path: '/api/v1/debts', body: undefined });
  });

  it('lists including settled debts', () => {
    expect(mapping('list_debts', { includeSettled: true })).toEqual({
      method: 'GET',
      path: '/api/v1/debts?includeSettled=true',
      body: undefined,
    });
  });

  it('reads one debt', () => {
    expect(mapping('get_debt', { id: 'debt-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/debts/debt-1',
      body: undefined,
    });
  });

  it('creates a debt', () => {
    const args = { personName: 'Aidar', direction: 'owed', amountCents: 5000000 };
    expect(mapping('create_debt', args)).toEqual({ method: 'POST', path: '/api/v1/debts', body: args });
  });

  it('strips id when updating', () => {
    expect(mapping('update_debt', { id: 'debt-1', amountCents: 6000000 })).toEqual({
      method: 'PATCH',
      path: '/api/v1/debts/debt-1',
      body: { amountCents: 6000000 },
    });
  });

  it('settles a debt with no body', () => {
    expect(mapping('settle_debt', { id: 'debt-1' })).toEqual({
      method: 'POST',
      path: '/api/v1/debts/debt-1/settle',
      body: undefined,
    });
  });

  it('deletes a debt', () => {
    expect(mapping('delete_debt', { id: 'debt-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/debts/debt-1',
      body: undefined,
    });
  });
});
```

`settle_debt` deliberately has no `body` function: the route handler is synchronous and never reads the request body, so sending one would be dead weight.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pfm/mcp test`
Expected: FAIL — `no such tool: list_loans` and the other eleven new tools.

- [ ] **Step 3: Append the tools**

Add before the closing `];` in `apps/mcp/src/tools.ts`:

```typescript
  // ===== Loans =====
  {
    name: 'list_loans',
    description:
      'List bank loans with current outstanding debt, monthly payment and progress. Amounts are tiyn; aprBps is basis points (1850 = 18.50%).',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/loans',
  },
  {
    name: 'get_loan',
    description: 'Get one loan by id with its computed summary: outstanding principal, payments made and remaining term.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/loans/${a.id}`,
  },
  {
    name: 'create_loan',
    description:
      'Create a loan. principalCents and monthlyPaymentCents are tiyn, aprBps is basis points, startDate is YYYY-MM-DD, paymentDay is 1–28. paidOffCents records principal already repaid before this loan was entered.',
    schema: z.object({
      name: z.string().min(1),
      type: z.enum(['loan', 'installment', 'credit_line']),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      principalCents: z.number().int().positive(),
      aprBps: z.number().int().min(0).optional(),
      termMonths: z.number().int().positive(),
      startDate: z.string(),
      monthlyPaymentCents: z.number().int().positive(),
      paymentDay: z.number().int().min(1).max(28),
      penaltyRateBps: z.number().int().min(0).optional(),
      earlyRepaymentFeeCents: z.number().int().min(0).optional(),
      paidOffCents: z.number().int().min(0).optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/loans',
    body: (a) => a,
  },
  {
    name: 'update_loan',
    description:
      'Update a loan. Principal, APR, term and start date are deliberately not editable — recreate the loan if those were entered wrong.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      accountId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      monthlyPaymentCents: z.number().int().positive().optional(),
      paymentDay: z.number().int().min(1).max(28).optional(),
      penaltyRateBps: z.number().int().min(0).optional(),
      earlyRepaymentFeeCents: z.number().int().min(0).optional(),
      paidOffCents: z.number().int().min(0).optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/loans/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_loan',
    description: 'Deactivate a loan, removing it from lists and debt totals.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/loans/${a.id}`,
  },
  {
    name: 'get_loan_schedule',
    description:
      'Full amortization schedule for a loan: per-month principal, interest and remaining balance in tiyn. Use this to answer "how much of my payment is interest".',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/loans/${a.id}/schedule`,
  },

  // ===== Personal debts =====
  {
    name: 'list_debts',
    description:
      'List informal debts between the user and other people. direction "owe" means the user owes them; "owed" means they owe the user. Settled debts are excluded unless includeSettled is true.',
    schema: z.object({ includeSettled: z.boolean().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/debts${qs({ includeSettled: a.includeSettled })}`,
  },
  {
    name: 'get_debt',
    description: 'Get one personal debt by id.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/debts/${a.id}`,
  },
  {
    name: 'create_debt',
    description:
      'Record a personal debt. direction "owe" = the user owes personName; "owed" = personName owes the user. amountCents is tiyn and must be positive — direction carries the sign, not the amount. dueDate is YYYY-MM-DD.',
    schema: z.object({
      personName: z.string().min(1),
      direction: z.enum(['owe', 'owed']),
      amountCents: z.number().int().positive(),
      currency: z.string().optional(),
      dueDate: z.string().optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/debts',
    body: (a) => a,
  },
  {
    name: 'update_debt',
    description: 'Update a personal debt. direction cannot be changed — delete and recreate if it was entered backwards.',
    schema: z.object({
      id: z.string(),
      personName: z.string().min(1).optional(),
      amountCents: z.number().int().positive().optional(),
      currency: z.string().optional(),
      dueDate: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/debts/${a.id}`,
    body: omitId,
  },
  {
    name: 'settle_debt',
    description:
      'Mark a personal debt as settled, stamped with today as the settled date. Fails if it is already settled. This does not create a transaction — record any money movement separately with create_transaction.',
    schema: z.object({ id: z.string() }),
    method: 'POST',
    path: (a) => `/api/v1/debts/${a.id}/settle`,
  },
  {
    name: 'delete_debt',
    description: 'Permanently delete a personal debt record. Prefer settle_debt when the debt was actually repaid.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/debts/${a.id}`,
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @pfm/mcp test`
Expected: PASS — 49 tests, `tools` now has 37 entries.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp
git commit -m "feat(mcp): add loan and personal-debt tools"
```

---

## Task 5: Deposit and simulation tools — completing the table at 48

**Files:**
- Modify: `apps/mcp/src/tools.ts`
- Test: `apps/mcp/tests/tools.test.ts`

**Interfaces:**
- Consumes: `ToolDef`, `qs`, `omitId` from Task 1.
- Produces: 11 more entries in `tools`, bringing it to exactly 48.

Route-ordering note: `/api/v1/deposits/kdif` is registered before `/:id` in `deposits.ts`, so `get_kdif_exposure` resolves correctly and is not shadowed by `get_deposit`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mcp/tests/tools.test.ts`:

```typescript
describe('deposit tools', () => {
  it('lists deposits', () => {
    expect(mapping('list_deposits', {})).toEqual({ method: 'GET', path: '/api/v1/deposits', body: undefined });
  });

  it('reads KDIF exposure from its literal path', () => {
    expect(mapping('get_kdif_exposure', {})).toEqual({
      method: 'GET',
      path: '/api/v1/deposits/kdif',
      body: undefined,
    });
  });

  it('reads one deposit', () => {
    expect(mapping('get_deposit', { id: 'dep-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/deposits/dep-1',
      body: undefined,
    });
  });

  it('reads an interest schedule, optionally truncated', () => {
    expect(mapping('get_deposit_schedule', { id: 'dep-1' })).toEqual({
      method: 'GET',
      path: '/api/v1/deposits/dep-1/schedule',
      body: undefined,
    });
    expect(mapping('get_deposit_schedule', { id: 'dep-1', months: 12 })).toEqual({
      method: 'GET',
      path: '/api/v1/deposits/dep-1/schedule?months=12',
      body: undefined,
    });
  });

  it('creates a deposit', () => {
    const args = {
      name: 'Halyk term',
      bankName: 'Halyk',
      type: 'term',
      initialAmountCents: 100000000,
      annualRateBps: 1550,
      termMonths: 12,
      startDate: '2026-08-01',
    };
    expect(mapping('create_deposit', args)).toEqual({ method: 'POST', path: '/api/v1/deposits', body: args });
  });

  it('strips id when updating', () => {
    expect(mapping('update_deposit', { id: 'dep-1', topUpCents: 5000000 })).toEqual({
      method: 'PATCH',
      path: '/api/v1/deposits/dep-1',
      body: { topUpCents: 5000000 },
    });
  });

  it('deletes a deposit', () => {
    expect(mapping('delete_deposit', { id: 'dep-1' })).toEqual({
      method: 'DELETE',
      path: '/api/v1/deposits/dep-1',
      body: undefined,
    });
  });
});

describe('simulation tools', () => {
  const debt = {
    name: 'Kaspi Red',
    type: 'credit_card',
    balanceCents: 30000000,
    aprBps: 2500,
    minPaymentCents: 1500000,
  };

  it('simulates a payoff', () => {
    const args = { debts: [debt], strategy: 'avalanche', extraMonthlyCents: 5000000 };
    expect(mapping('simulate_payoff', args)).toEqual({
      method: 'POST',
      path: '/api/v1/simulate/payoff',
      body: args,
    });
  });

  it('compares strategies', () => {
    const args = { debts: [debt], extraMonthlyCents: 5000000 };
    expect(mapping('compare_strategies', args)).toEqual({
      method: 'POST',
      path: '/api/v1/simulate/compare',
      body: args,
    });
  });

  it('compares paying debt against investing', () => {
    const args = { extraMonthlyCents: 5000000, debt, expectedReturnBps: 1200, horizonMonths: 60 };
    expect(mapping('debt_vs_invest', args)).toEqual({
      method: 'POST',
      path: '/api/v1/simulate/debt-vs-invest',
      body: args,
    });
  });

  it('compares deposit offers', () => {
    const args = {
      deposits: [
        { name: 'A', initialAmountCents: 100000000, annualRateBps: 1500, termMonths: 12, capitalization: 'monthly' },
        { name: 'B', initialAmountCents: 100000000, annualRateBps: 1600, termMonths: 12, capitalization: 'at_end' },
      ],
    };
    expect(mapping('compare_deposits', args)).toEqual({
      method: 'POST',
      path: '/api/v1/simulate/deposit-compare',
      body: args,
    });
  });
});

describe('table completeness', () => {
  it('exposes exactly 48 tools', () => {
    expect(tools).toHaveLength(48);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @pfm/mcp test`
Expected: FAIL — `no such tool: list_deposits` and the other ten new tools, plus the length assertion reporting 37.

- [ ] **Step 3: Append the tools**

Add before the closing `];` in `apps/mcp/src/tools.ts`:

```typescript
  // ===== Deposits =====
  {
    name: 'list_deposits',
    description:
      'List active deposits with current balance, accrued interest and effective annual rate. annualRateBps is basis points (1550 = 15.50%); amounts are tiyn.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/deposits',
  },
  {
    name: 'get_deposit',
    description: 'Get one deposit by id with its computed summary: current balance, interest accrued and days to maturity.',
    schema: z.object({ id: z.string() }),
    method: 'GET',
    path: (a) => `/api/v1/deposits/${a.id}`,
  },
  {
    name: 'create_deposit',
    description:
      'Create a deposit. initialAmountCents is tiyn, annualRateBps is basis points, startDate is YYYY-MM-DD, termMonths 0 means open-ended. capitalization controls compounding: monthly, quarterly, at_end or none.',
    schema: z.object({
      name: z.string().min(1),
      bankName: z.string().min(1),
      type: z.enum(['term', 'savings', 'demand']),
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      initialAmountCents: z.number().int().positive(),
      currency: z.string().optional(),
      annualRateBps: z.number().int().min(0),
      earlyWithdrawalRateBps: z.number().int().min(0).optional(),
      termMonths: z.number().int().min(0),
      startDate: z.string(),
      endDate: z.string().optional(),
      capitalization: z.enum(['monthly', 'quarterly', 'at_end', 'none']).optional(),
      isWithdrawable: z.boolean().optional(),
      isReplenishable: z.boolean().optional(),
      minBalanceCents: z.number().int().min(0).optional(),
      topUpCents: z.number().int().min(0).optional(),
      note: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/deposits',
    body: (a) => a,
  },
  {
    name: 'update_deposit',
    description:
      'Update a deposit. Rate, term and start date are deliberately not editable — recreate the deposit if those were entered wrong. topUpCents records additional money paid in.',
    schema: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      accountId: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      topUpCents: z.number().int().min(0).optional(),
      note: z.string().nullable().optional(),
    }),
    method: 'PATCH',
    path: (a) => `/api/v1/deposits/${a.id}`,
    body: omitId,
  },
  {
    name: 'delete_deposit',
    description: 'Deactivate a deposit, removing it from lists and KDIF exposure.',
    schema: z.object({ id: z.string() }),
    method: 'DELETE',
    path: (a) => `/api/v1/deposits/${a.id}`,
  },
  {
    name: 'get_deposit_schedule',
    description:
      'Month-by-month interest schedule for a deposit: opening balance, interest, capitalised amount, closing balance and cumulative interest, all in tiyn. Pass months to truncate a long schedule.',
    schema: z.object({ id: z.string(), months: z.number().int().positive().optional() }),
    method: 'GET',
    path: (a) => `/api/v1/deposits/${a.id}/schedule${qs({ months: a.months })}`,
  },
  {
    name: 'get_kdif_exposure',
    description:
      'Deposit exposure per bank against the Kazakhstan Deposit Insurance Fund guarantee limit, flagging any bank where the user holds more than is insured.',
    schema: z.object({}),
    method: 'GET',
    path: () => '/api/v1/deposits/kdif',
  },

  // ===== Simulations =====
  {
    name: 'simulate_payoff',
    description:
      'Simulate paying off a set of debts under one strategy: snowball (smallest balance first), avalanche (highest APR first), highest_monthly_interest, or cash_flow_index. Debts are passed in explicitly rather than read from the database, so hypotheticals are possible. extraMonthlyCents is the additional payment above the minimums; startDate is YYYY-MM.',
    schema: z.object({
      debts: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            type: z.enum(['credit_card', 'loan', 'installment']),
            balanceCents: z.number().int().positive(),
            aprBps: z.number().int().min(0),
            minPaymentCents: z.number().int().positive(),
            remainingInstallments: z.number().int().positive().optional(),
            latePenaltyCents: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(20),
      strategy: z.enum(['snowball', 'avalanche', 'highest_monthly_interest', 'cash_flow_index']),
      extraMonthlyCents: z.number().int().min(0).optional(),
      startDate: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/payoff',
    body: (a) => a,
  },
  {
    name: 'compare_strategies',
    description:
      'Run every payoff strategy against the same debts and compare total interest and months to debt-free. Use this to answer "snowball or avalanche" with numbers instead of opinion.',
    schema: z.object({
      debts: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            type: z.enum(['credit_card', 'loan', 'installment']),
            balanceCents: z.number().int().positive(),
            aprBps: z.number().int().min(0),
            minPaymentCents: z.number().int().positive(),
            remainingInstallments: z.number().int().positive().optional(),
            latePenaltyCents: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(20),
      extraMonthlyCents: z.number().int().min(0).optional(),
      startDate: z.string().optional(),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/compare',
    body: (a) => a,
  },
  {
    name: 'debt_vs_invest',
    description:
      'Compare putting extraMonthlyCents against one debt versus investing it at expectedReturnBps over horizonMonths, and report which leaves the user better off.',
    schema: z.object({
      extraMonthlyCents: z.number().int().min(0),
      debt: z.object({
        id: z.string().optional(),
        name: z.string(),
        type: z.enum(['credit_card', 'loan', 'installment']),
        balanceCents: z.number().int().positive(),
        aprBps: z.number().int().min(0),
        minPaymentCents: z.number().int().positive(),
        remainingInstallments: z.number().int().positive().optional(),
        latePenaltyCents: z.number().int().min(0).optional(),
      }),
      expectedReturnBps: z.number().int().min(0),
      horizonMonths: z.number().int().positive().max(600),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/debt-vs-invest',
    body: (a) => a,
  },
  {
    name: 'compare_deposits',
    description:
      'Compare 2–10 hypothetical deposit offers by effective annual rate and total interest, accounting for how each compounds. Use this to choose between bank offers before opening one.',
    schema: z.object({
      deposits: z
        .array(
          z.object({
            name: z.string().min(1),
            initialAmountCents: z.number().int().positive(),
            annualRateBps: z.number().int().min(0),
            termMonths: z.number().int().min(0),
            capitalization: z.enum(['monthly', 'quarterly', 'at_end', 'none']).optional(),
          }),
        )
        .min(2)
        .max(10),
    }),
    method: 'POST',
    path: () => '/api/v1/simulate/deposit-compare',
    body: (a) => a,
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @pfm/mcp test`
Expected: PASS — 61 tests, including `exposes exactly 48 tools`.

- [ ] **Step 5: Verify the package still type-checks**

Run: `pnpm --filter @pfm/mcp build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp
git commit -m "feat(mcp): add deposit and simulation tools, completing the 48-tool table"
```

---

## Task 6: Mount the MCP endpoint in the API

**Files:**
- Create: `apps/api/src/mcp.ts`
- Modify: `apps/api/package.json`, `apps/api/src/errors.ts`, `apps/api/src/app.ts:22-34`
- Test: `apps/api/tests/mcp.test.ts`

**Interfaces:**
- Consumes: `createMcpServer`, `type Dispatch` from `@pfm/mcp` (Task 1).
- Produces:
  - `errorHandler` exported from `apps/api/src/errors.ts`, of type `ErrorHandler` from `hono`
  - `mcpRoutes(db: DB): Hono` exported from `apps/api/src/mcp.ts`

- [ ] **Step 1: Add the dependencies**

In `apps/api/package.json`, add to `dependencies`:

```json
    "@pfm/mcp": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
```

Run: `pnpm install`
Expected: `apps/api` gains both; no other importer changes.

- [ ] **Step 2: Write the failing test**

`apps/api/tests/mcp.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

const TOKEN = 'test-mcp-token';

let db: DB;
let app: Hono;

/** Posts a JSON-RPC message the way a streamable-HTTP MCP client does. */
async function rpc(path: string, message: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });
  return res;
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
};

beforeAll(() => {
  process.env.PFM_MCP_TOKEN = TOKEN;
  db = createDb(':memory:');
  app = createApp(db);
});

afterAll(() => {
  delete process.env.PFM_MCP_TOKEN;
});

describe('MCP endpoint auth', () => {
  it('rejects a wrong token in the path', async () => {
    const res = await rpc('/mcp/wrong-token', INITIALIZE);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a missing token', async () => {
    const res = await rpc('/mcp', INITIALIZE);
    expect(res.status).toBe(401);
  });

  it('accepts the token in the path', async () => {
    const res = await rpc(`/mcp/${TOKEN}`, INITIALIZE);
    expect(res.status).toBe(200);
  });

  it('accepts the token as a bearer header', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(INITIALIZE),
    });
    expect(res.status).toBe(200);
  });
});

describe('MCP endpoint protocol', () => {
  it('lists all 48 tools', async () => {
    const res = await rpc(`/mcp/${TOKEN}`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.result.tools).toHaveLength(48);
    expect(payload.result.tools.map((t: { name: string }) => t.name)).toContain('get_budget');
  });

  it('calls a tool against the real routes', async () => {
    const res = await rpc(`/mcp/${TOKEN}`, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_accounts', arguments: {} },
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.result.isError).toBeFalsy();
    expect(JSON.parse(payload.result.content[0].text)).toEqual([]);
  });

  it('surfaces a route error as an MCP tool error', async () => {
    const res = await rpc(`/mcp/${TOKEN}`, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'get_account', arguments: { id: 'does-not-exist' } },
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.result.isError).toBe(true);
    expect(JSON.parse(payload.result.content[0].text).error.code).toBe('NOT_FOUND');
  });

  it('does not require the REST API key for internal dispatch', async () => {
    process.env.PFM_API_KEY = 'rest-key-that-mcp-should-not-need';
    try {
      const res = await rpc(`/mcp/${TOKEN}`, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_accounts', arguments: {} },
      });
      const payload = await res.json();
      expect(payload.result.isError).toBeFalsy();
    } finally {
      delete process.env.PFM_API_KEY;
    }
  });
});
```

The last test is the one that proves the internal router genuinely bypasses `apiKeyAuth`. Without it, a regression would only appear in production.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @pfm/api test -- mcp.test.ts`
Expected: FAIL — every case 404s, because `/mcp` is not routed yet.

- [ ] **Step 4: Extract the error handler**

Append to `apps/api/src/errors.ts`:

```typescript
import type { ErrorHandler } from 'hono';

/**
 * Shared error renderer. Used by the public app and by the internal router
 * behind the MCP endpoint so both emit the same {error:{code,message,suggestion}}.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const status = (err as any).status ?? 500;
  return c.json(
    {
      error: {
        code: (err as any).code ?? 'INTERNAL_ERROR',
        message: err.message,
        suggestion: (err as any).suggestion ?? 'Check server logs',
      },
    },
    status,
  );
};
```

- [ ] **Step 5: Write the MCP module**

`apps/api/src/mcp.ts`:

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer, type Dispatch } from '@pfm/mcp';
import type { DB } from '@pfm/engine';
import { errorHandler } from './errors.js';
import { accountRoutes } from './routes/accounts.js';
import { categoryRoutes } from './routes/categories.js';
import { transactionRoutes } from './routes/transactions.js';
import { budgetRoutes } from './routes/budget.js';
import { debtRoutes } from './routes/debt.js';
import { scheduledRoutes } from './routes/scheduled.js';
import { loanRoutes } from './routes/loans.js';
import { debtListRoutes } from './routes/debts.js';
import { depositRoutes } from './routes/deposits.js';

/**
 * The same routes the public API serves, minus apiKeyAuth, cors and logger.
 * Authorization happened at the /mcp/:token boundary; re-checking a key we
 * would have to hand ourselves buys nothing.
 */
function createInternalRouter(db: DB) {
  const app = new Hono();
  app.onError(errorHandler);

  app.route('/api/v1/accounts', accountRoutes(db));
  app.route('/api/v1/categories', categoryRoutes(db));
  app.route('/api/v1/transactions', transactionRoutes(db));
  app.route('/api/v1/budget', budgetRoutes(db));
  app.route('/api/v1/simulate', debtRoutes());
  app.route('/api/v1/scheduled', scheduledRoutes(db));
  app.route('/api/v1/loans', loanRoutes(db));
  app.route('/api/v1/debts', debtListRoutes(db));
  app.route('/api/v1/deposits', depositRoutes(db));

  return app;
}

function makeDispatch(internal: Hono): Dispatch {
  return async (method, path, body) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }

    const res = await internal.request(path, init);
    const text = await res.text();

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: res.status, body: parsed };
  };
}

/** Constant-time comparison that tolerates differing lengths. */
function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Remote MCP endpoint sharing the API's database.
 *
 * Auth: the `:token` path segment or an `Authorization: Bearer` header must
 * equal PFM_MCP_TOKEN, falling back to PFM_API_KEY. With neither configured
 * auth is skipped, matching apiKeyAuth's local-dev behaviour.
 */
export function mcpRoutes(db: DB) {
  const app = new Hono();
  const dispatch = makeDispatch(createInternalRouter(db));

  const authorized = (c: Context): boolean => {
    const expected = process.env.PFM_MCP_TOKEN || process.env.PFM_API_KEY;
    if (!expected) return true; // local dev

    if (tokenMatches(c.req.param('token'), expected)) return true;

    const header = c.req.header('Authorization');
    const match = header?.match(/^Bearer\s+(.+)$/i);
    return tokenMatches(match?.[1], expected);
  };

  const handle = async (c: Context) => {
    if (!authorized(c)) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid MCP token',
            suggestion: 'Use https://<host>/mcp/<PFM_MCP_TOKEN> as the connector URL',
          },
        },
        401,
      );
    }

    const server = createMcpServer(dispatch);
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless: no sessions, a fresh server per request.
      sessionIdGenerator: undefined,
      // Materialise the reply as JSON so it is safe to close immediately below.
      enableJsonResponse: true,
    });

    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  };

  app.all('/', handle);
  app.all('/:token', handle);

  return app;
}
```

- [ ] **Step 6: Wire it into the app**

In `apps/api/src/app.ts`, replace the inline `app.onError(...)` block at lines 22-34 with a call to the shared handler, and mount the route. The import line becomes:

```typescript
import { errorHandler } from './errors.js';
import { mcpRoutes } from './mcp.js';
```

The body changes to:

```typescript
  app.onError(errorHandler);

  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  app.route('/mcp', mcpRoutes(db));

  app.use('/api/v1/*', apiKeyAuth());
```

`/mcp` is mounted before the `/api/v1/*` auth middleware so the MCP endpoint owns its own authorization.

- [ ] **Step 7: Run the new tests**

Run: `pnpm --filter @pfm/api test -- mcp.test.ts`
Expected: PASS — 8 tests.

If `lists all 48 tools` returns an empty or truncated body, the cause is closing the transport before the response is read; confirm `enableJsonResponse: true` is set, and if it still fails, move the `close()` calls into a `queueMicrotask` after the return instead of a `finally`.

- [ ] **Step 8: Run the whole suite for regressions**

Run: `pnpm test`
Expected: PASS — every existing engine and API test still green. The `app.ts` edit touches shared error rendering, so `api.test.ts`'s error-shape assertions are the ones to watch.

- [ ] **Step 9: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): mount remote MCP endpoint at POST /mcp/:token"
```

---

## Task 7: Configuration, documentation, and connecting Claude Desktop

**Files:**
- Modify: `.env.example`, `CLAUDE.md`, `docs/section-6b.md`, `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md`

**Interfaces:**
- Consumes: everything from Tasks 1–6. Produces no code.

- [ ] **Step 1: Document the environment variable**

In `.env.example`, below the existing `PFM_API_KEY` block:

```bash
# MCP connector token (optional — falls back to PFM_API_KEY when unset).
# Set this so Claude's access can be rotated without breaking the mobile app.
PFM_MCP_TOKEN=
```

- [ ] **Step 2: Update CLAUDE.md**

In the Structure section, change:

```
- `apps/mcp` — MCP server for AI agents (post-MVP)
```

to:

```
- `apps/mcp` — @pfm/mcp: MCP tool table + server, dispatched into the API routes
```

And add to Key Conventions, after the Engine Pattern section:

```markdown
### MCP Pattern

`@pfm/mcp` owns a declarative table of 48 tools; each maps arguments to an HTTP
method, path and body. `createMcpServer(dispatch)` takes the dispatch function as
its first argument, the same dependency-injection shape engine functions use for
`db`. The API supplies a dispatch that routes into an internal Hono app built from
the same route factories as REST, so route handlers stay the single source of truth.

`@pfm/mcp` must not import `@pfm/api` or `@pfm/engine` — apps/api depends on it.

Remote endpoint: `POST /mcp/:token`, token = `PFM_MCP_TOKEN` (falls back to
`PFM_API_KEY`). Adding a REST endpoint means adding a tool to the table.
```

- [ ] **Step 3: Rewrite the section-6b doc**

Replace the body of `docs/section-6b.md` — it currently specifies a stdio server with 11 tools, which is not what exists. Keep the heading, and write:

```markdown
# Секция 6B: MCP Server

Реализовано. Дизайн: `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md`.

## Что это

`@pfm/mcp` — таблица из 48 инструментов поверх REST API. Инструмент отображает
аргументы в `метод + путь + тело`, а `dispatch` выполняет вызов по внутреннему
Hono-роутеру, собранному из тех же фабрик маршрутов, что обслуживают REST.
Бизнес-логика не дублируется.

## Транспорт

Remote streamable-http, смонтирован в сервис `api`: `POST /mcp/:token`.
Отдельного stdio-режима нет — данные живут на Railway-томе.

Токен: `PFM_MCP_TOKEN`, при отсутствии `PFM_API_KEY`, при отсутствии обоих
авторизация выключена (локальная разработка). Принимается и как сегмент пути,
и как `Authorization: Bearer`.

## Инструменты (48)

Счета (5), категории (5), бюджет (5), транзакции (5), симуляции (4),
регулярные платежи (5), кредиты (6), долги людям (6), депозиты (7).
Актуальный список — `apps/mcp/src/tools.ts`.

## Формат ответа

Тело маршрута отдаётся как есть. API уже возвращает деньги парами
(`balanceCents` + `balanceFormatted`), поэтому второго рендерера нет.
Не-2xx → `isError: true` с телом `{error:{code,message,suggestion}}`.

## Подключение Claude Desktop

Settings → Connectors → Add custom connector → URL:

    https://<railway-host>/mcp/<PFM_MCP_TOKEN>
```

- [ ] **Step 4: Record the transport deviation in the spec**

In `docs/superpowers/specs/2026-08-06-pfm-mcp-server-design.md`, replace the paragraph in the Авторизация section that begins "Транспорт stateless:" with:

```markdown
Транспорт stateless: на каждый запрос создаются свежие `McpServer` и
`WebStandardStreamableHTTPServerTransport` с `sessionIdGenerator: undefined` и
`enableJsonResponse: true`, оба закрываются сразу после того, как ответ собран.
Web-стандартный транспорт из SDK 1.29 принимает `Request` и возвращает `Response`,
поэтому вставляется в Hono напрямую — без `HttpBindings` и `RESPONSE_ALREADY_SENT`,
которые понадобились бы node-варианту.
```

- [ ] **Step 5: Verify the full suite and build one more time**

Run: `pnpm test && pnpm build`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add .env.example CLAUDE.md docs/
git commit -m "docs: document the MCP server and PFM_MCP_TOKEN"
```

- [ ] **Step 7: Deploy and connect (requires the user)**

These steps touch production and need the user's go-ahead — do not run them unattended.

1. Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set `PFM_MCP_TOKEN` on the Railway `api` service.
3. Merge and let the service redeploy. `railway.json` needs no change — the MCP rides inside `api`.
4. Verify against production:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://api-production-a69c.up.railway.app/mcp/wrong \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

Expected: `401`. Repeating it with the real token must return `200`.

5. Claude Desktop → Settings → Connectors → Add custom connector →
   `https://api-production-a69c.up.railway.app/mcp/<PFM_MCP_TOKEN>`
6. Confirm the connector reports 48 tools, then ask Claude for the current budget as a smoke test.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Structure (`apps/mcp`, `apps/api/src/mcp.ts`) | 1, 6 |
| Dispatch DI, no dependency on `@pfm/api` | 1 |
| Internal router without auth/cors/logger | 6 |
| 48 tools across 9 groups | 1–5 |
| Declarative table shape, `path()`/`body()` | 1 |
| Zod schemas rewritten, not imported | 1–5 |
| Response passthrough, no second renderer | 1 |
| `PFM_MCP_TOKEN` → `PFM_API_KEY` → off | 6 |
| Path token and Bearer header | 6 |
| `timingSafeEqual` | 6 |
| Stateless transport | 6 |
| Errors: non-2xx → `isError`, throw → `INTERNAL_ERROR` | 1, 6 |
| Tests: table invariants, path building | 1–5 |
| Tests: initialize, tools/list = 48, list_accounts, 401/200 | 6 |
| Railway: no config change, add env var | 7 |
| `.env.example`, `CLAUDE.md`, `section-6b.md` | 7 |

No gaps.

**Placeholder scan:** every code step carries complete code. No TBD, no "similar to Task N", no "add error handling" without the handler.

**Type consistency:** `Dispatch`, `DispatchResult`, `HttpMethod` and `ToolDef` are defined once in Task 1 and used unchanged in Tasks 2–6. `createMcpServer(dispatch)` has one signature throughout. `errorHandler` and `mcpRoutes` are defined in Task 6 and referenced only after. Tool counts are consistent: 5 → 15 → 25 → 37 → 48, asserted at the end of Task 5 and again over HTTP in Task 6.
