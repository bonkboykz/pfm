# Секция 6E: API Key Authentication

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6e-auth.md.

Add API key authentication middleware to apps/api.

1. Create apps/api/src/middleware/auth.ts
2. Apply to all /api/v1/* routes in apps/api/src/app.ts
3. Keep /health unauthenticated
4. Update apps/api/tests — add auth headers to all test requests
5. Update packages/skill/SKILL.md — add PFM_API_KEY env requirement
6. Create .env.example in project root

Run pnpm test, fix all failures.
```

---

## Middleware: apps/api/src/middleware/auth.ts

```typescript
import type { MiddlewareHandler } from 'hono';
import { AppError } from '../errors.js';

export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const apiKey = process.env.PFM_API_KEY;

    // If no API key configured, auth is disabled (local dev)
    if (!apiKey) {
      return next();
    }

    const provided = c.req.header('Authorization');

    if (!provided) {
      throw new AppError(
        'UNAUTHORIZED',
        'Missing Authorization header',
        401,
        'Include header: Authorization: Bearer <your-api-key>'
      );
    }

    // Expect: "Bearer <key>"
    const match = provided.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1] !== apiKey) {
      throw new AppError(
        'UNAUTHORIZED',
        'Invalid API key',
        401,
        'Check your PFM_API_KEY environment variable'
      );
    }

    await next();
  };
}
```

### Key Behaviors

- **PFM_API_KEY not set** → auth disabled, all requests pass. Удобно для локальной разработки.
- **PFM_API_KEY set** → requires `Authorization: Bearer <key>` on every `/api/v1/*` request.
- `/health` — always public (no auth).
- Wrong/missing key → 401 with helpful suggestion.

---

## App Integration: apps/api/src/app.ts

```typescript
import { apiKeyAuth } from './middleware/auth.js';

// Public routes (no auth)
app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Protected routes
app.use('/api/v1/*', apiKeyAuth());

app.route('/api/v1/accounts', accountRoutes);
app.route('/api/v1/categories', categoryRoutes);
// ... etc
```

---

## Environment

### .env.example

```bash
# Server
PORT=3000

# Database
PFM_DB_PATH=./data/pfm.db

# Authentication (optional — leave empty to disable auth for local dev)
PFM_API_KEY=

# Generate a secure key:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### .env (production example)

```bash
PORT=3000
PFM_DB_PATH=./data/pfm.db
PFM_API_KEY=a1b2c3d4e5f6...your-secret-key
```

---

## Test Updates

All test helpers need auth header when API key is set:

```typescript
// apps/api/tests/helpers.ts
export async function api(method: string, path: string, body?: any) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // If API key is set in test env, include it
  if (process.env.PFM_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.PFM_API_KEY}`;
  }

  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}
```

### Auth-specific tests

```typescript
describe('Authentication', () => {
  it('allows /health without auth', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('rejects /api/v1/* without auth when key is set', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts');
    expect(res.status).toBe(401);
  });

  it('accepts valid Bearer token', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts', {
      headers: { 'Authorization': 'Bearer test-key-123' }
    });
    expect(res.status).toBe(200);
  });

  it('rejects wrong key', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts', {
      headers: { 'Authorization': 'Bearer wrong-key' }
    });
    expect(res.status).toBe(401);
  });

  it('allows everything when PFM_API_KEY not set', async () => {
    delete process.env.PFM_API_KEY;
    const res = await app.request('/api/v1/accounts');
    expect(res.status).toBe(200);
  });
});
```

---

## SKILL.md Updates

### Frontmatter change

```yaml
metadata:
  openclaw:
    emoji: "💰"
    requires:
      bins: [curl, jq]
      env: [PFM_API_URL, PFM_API_KEY]
    primaryEnv: PFM_API_URL
```

### Auth header in all curl examples

```bash
# All requests need auth header when API key is configured:
AUTH="Authorization: Bearer $PFM_API_KEY"

## List accounts
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/accounts" | jq

## Get budget
curl -s -H "$AUTH" "$PFM_API_URL/api/v1/budget/2026-02" | jq

## Add transaction
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$PFM_API_URL/api/v1/transactions" \
  -d '{"accountId":"...","date":"2026-02-24","amountCents":-850000}' | jq
```

### OpenClaw config update

```json
{
  "skills": {
    "entries": {
      "pfm-budget": {
        "enabled": true,
        "env": {
          "PFM_API_URL": "https://pfm.fly.dev",
          "PFM_API_KEY": "your-secret-key-here"
        }
      }
    }
  }
}
```

---

## Future: Multi-user Auth (beyond 6E)

Текущая реализация — single API key для single user. Если нужно multi-user:

1. Add `users` table with hashed API keys
2. Middleware extracts user from key, stores in context
3. All queries filter by `userId`
4. Accounts, transactions, categories — all scoped to user

Это отдельная секция, не часть 6E.