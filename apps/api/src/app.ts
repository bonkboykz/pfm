import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { DB } from '@pfm/engine';
import { accountRoutes } from './routes/accounts.js';
import { categoryRoutes } from './routes/categories.js';
import { transactionRoutes } from './routes/transactions.js';
import { budgetRoutes } from './routes/budget.js';
import { debtRoutes } from './routes/debt.js';
import { scheduledRoutes } from './routes/scheduled.js';
import { loanRoutes } from './routes/loans.js';
import { debtListRoutes } from './routes/debts.js';
import { depositRoutes } from './routes/deposits.js';
import { apiKeyAuth } from './middleware/auth.js';
import { errorHandler } from './errors.js';
import { mcpRoutes } from './mcp.js';

export function createApp(db: DB) {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', logger());

  app.onError(errorHandler);

  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  // Mounted before the /api/v1/* auth middleware: the MCP endpoint owns its
  // own authorization via PFM_MCP_TOKEN.
  app.route('/mcp', mcpRoutes(db));

  app.use('/api/v1/*', apiKeyAuth());

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
