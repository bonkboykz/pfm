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
