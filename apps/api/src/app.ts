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
import { apiKeyAuth } from './middleware/auth.js';

export function createApp(db: DB) {
  const app = new Hono();

  app.use('*', cors());
  app.use('*', logger());

  app.onError((err, c) => {
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
  });

  app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

  app.use('/api/v1/*', apiKeyAuth());

  app.route('/api/v1/accounts', accountRoutes(db));
  app.route('/api/v1/categories', categoryRoutes(db));
  app.route('/api/v1/transactions', transactionRoutes(db));
  app.route('/api/v1/budget', budgetRoutes(db));
  app.route('/api/v1/simulate', debtRoutes());
  app.route('/api/v1/scheduled', scheduledRoutes(db));
  app.route('/api/v1/loans', loanRoutes(db));
  app.route('/api/v1/debts', debtListRoutes(db));

  return app;
}
