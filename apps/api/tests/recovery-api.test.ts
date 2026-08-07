import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * Covers the failures found while restoring five months of untracked finances:
 * assignments that reported success against nothing, loans whose balance
 * vanished, repaid loans still counted as debt, carryover that could not be
 * cleared, and accounts that moved the totals while staying invisible.
 */

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

function seed(db: DB) {
  const s = db.$client;
  const now = '2026-08-07T00:00:00.000Z';

  s.prepare(`INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('acc-main', 'Halyk', 'checking', 1, 'KZT', 0, 1, now, now);
  s.prepare(`INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('acc-cny', 'Наличные юани', 'cash', 0, 'CNY', 1, 1, now, now);
  // The ghost: deactivated, absent from list_accounts, still moving the totals.
  s.prepare(`INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('acc-ghost', 'BCC KartaKarta', 'credit_card', 1, 'KZT', 2, 0, now, now);

  s.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 0, 1, 0, ?)`)
    .run('grp-bills', 'Счета', now);
  for (const [id, name] of [['cat-rent', 'Аренда'], ['cat-food', 'Еда'], ['cat-debt', 'Кредит']]) {
    s.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 0, 0, 0, ?)`)
      .run(id, 'grp-bills', name, now);
  }

  return { now };
}

let db: DB;
let app: Hono;

beforeEach(() => {
  db = createTestDb();
  seed(db);
  app = createApp(db);
});

describe('unknown ids are refused rather than silently accepted', () => {
  it('rejects an assignment to a category that does not exist', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-08/assign', {
      categoryId: 'bc64fr0ga07p4topybixdi84',
      amountCents: 13664865,
    });

    expect(status).toBe(404);
    expect(data.error.code).toBe('UNKNOWN_REFERENCE');
    expect(data.error.suggestion).toMatch(/GET \/api\/v1\/categories/);
  });

  it('does not record an assignment it refused', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'nope', amountCents: 500 });

    const { data } = await api(app, 'GET', '/api/v1/budget/2026-08');
    expect(data.totalAssignedCents).toBe(0);
  });

  it('rejects a transaction pointing at a category that does not exist', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-01', amountCents: -1000, categoryId: 'ghost-cat',
    });

    expect(status).toBe(404);
    expect(data.error.code).toBe('UNKNOWN_REFERENCE');
  });

  it('returns the existing category when a create is retried', async () => {
    const first = await api(app, 'POST', '/api/v1/categories', { groupId: 'grp-bills', name: '🏦 Halyk Кредит' });
    const second = await api(app, 'POST', '/api/v1/categories', { groupId: 'grp-bills', name: '🏦 Halyk Кредит' });

    expect(first.status).toBe(201);
    expect(first.data.alreadyExisted).toBe(false);
    expect(second.status).toBe(200);
    expect(second.data.alreadyExisted).toBe(true);
    expect(second.data.id).toBe(first.data.id);
  });

  it('honours the id a create handed back', async () => {
    const { data: created } = await api(app, 'POST', '/api/v1/categories', { groupId: 'grp-bills', name: 'Ремонт' });
    const assign = await api(app, 'POST', '/api/v1/budget/2026-08/assign?response=minimal', {
      categoryId: created.id, amountCents: 250000,
    });

    expect(assign.status).toBe(200);
    expect(assign.data.categories[0]).toMatchObject({ categoryId: created.id, assignedCents: 250000 });
  });
});

describe('loan balances', () => {
  const baseLoan = {
    name: 'Kaspi рассрочка', type: 'installment' as const, categoryId: 'cat-debt',
    termMonths: 3, monthlyPaymentCents: 3350500, paymentDay: 3,
  };

  it('keeps the full balance for a loan starting today', async () => {
    const { data } = await api(app, 'POST', '/api/v1/loans', {
      ...baseLoan, principalCents: 10051500, paidOffCents: 0, startDate: '2026-08-03',
    });

    expect(data.currentDebtCents).toBe(10051500);
  });

  it('keeps the full balance for a loan starting next month', async () => {
    const { data } = await api(app, 'POST', '/api/v1/loans', {
      ...baseLoan, principalCents: 7876500, paidOffCents: 0, startDate: '2026-09-03', termMonths: 4,
    });

    expect(data.currentDebtCents).toBe(7876500);
  });

  it('ignores spending in the category that predates the loan', async () => {
    // The category carries history from whatever loan this one replaced.
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-03-15', amountCents: -9000000, categoryId: 'cat-debt',
    });

    const { data } = await api(app, 'POST', '/api/v1/loans', {
      ...baseLoan, principalCents: 10051500, startDate: '2026-08-03',
    });

    expect(data.currentDebtCents).toBe(10051500);
  });

  it('counts payments made since the loan started', async () => {
    const { data: loan } = await api(app, 'POST', '/api/v1/loans', {
      ...baseLoan, principalCents: 10051500, startDate: '2026-08-03',
    });

    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-09-03', amountCents: -3350500, categoryId: 'cat-debt',
    });

    const { data } = await api(app, 'GET', `/api/v1/loans/${loan.id}`);
    expect(data.currentDebtCents).toBe(10051500 - 3350500);
  });

  it('accepts a balance quoted straight from the statement', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/loans', {
      ...baseLoan, currentBalanceCents: 10051500, startDate: '2026-08-03',
    });

    expect(status).toBe(201);
    expect(data.currentDebtCents).toBe(10051500);
  });

  it('needs one of principal or current balance', async () => {
    const { status } = await api(app, 'POST', '/api/v1/loans', { ...baseLoan, startDate: '2026-08-03' });
    expect(status).toBe(400);
  });
});

describe('closing loans', () => {
  async function makeLoan() {
    const { data } = await api(app, 'POST', '/api/v1/loans', {
      name: 'Погашенный', type: 'loan', currentBalanceCents: 255000000,
      termMonths: 12, startDate: '2026-01-01', monthlyPaymentCents: 25000000, paymentDay: 5,
    });
    return data;
  }

  it('drops a closed loan out of the debt total', async () => {
    const loan = await makeLoan();
    const { status, data } = await api(app, 'POST', `/api/v1/loans/${loan.id}/close`, {
      closedDate: '2026-08-01', reason: 'repaid in full',
    });

    expect(status).toBe(200);
    expect(data.isActive).toBe(false);
    expect(data.currentDebtCents).toBe(0);
    expect(data.closedDate).toBe('2026-08-01');
    expect(data.closureReason).toBe('repaid in full');
  });

  it('hides closed loans from the default list but keeps them reachable', async () => {
    const loan = await makeLoan();
    await api(app, 'POST', `/api/v1/loans/${loan.id}/close`, {});

    const active = await api(app, 'GET', '/api/v1/loans');
    expect(active.data).toHaveLength(0);

    const all = await api(app, 'GET', '/api/v1/loans?includeInactive=true');
    expect(all.data).toHaveLength(1);
    expect(all.data[0].isActive).toBe(false);

    const byId = await api(app, 'GET', `/api/v1/loans/${loan.id}`);
    expect(byId.status).toBe(200);
  });

  it('deactivates through update_loan too', async () => {
    const loan = await makeLoan();
    const { status, data } = await api(app, 'PATCH', `/api/v1/loans/${loan.id}`, { isActive: false });

    expect(status).toBe(200);
    expect(data.isActive).toBe(false);
  });

  it('reports the summed active debt on request', async () => {
    const keep = await makeLoan();
    const close = await makeLoan();
    await api(app, 'POST', `/api/v1/loans/${close.id}/close`, {});

    const { data } = await api(app, 'GET', '/api/v1/loans?includeInactive=true&withTotals=true');
    expect(data.activeCount).toBe(1);
    expect(data.totalActiveDebtCents).toBe(255000000);
    expect(data.loans.find((l: { id: string }) => l.id === keep.id).isActive).toBe(true);
  });

  it('refuses a paid-off figure above the principal', async () => {
    const loan = await makeLoan();
    const { status } = await api(app, 'PATCH', `/api/v1/loans/${loan.id}`, { paidOffCents: 999999999 });
    expect(status).toBe(400);
  });
});

describe('clearing inherited Available', () => {
  beforeEach(async () => {
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-05-01', amountCents: 231372900, categoryId: 'ready-to-assign',
    });
    await api(app, 'POST', '/api/v1/budget/2026-05/assign', { categoryId: 'cat-rent', amountCents: 231372900 });
  });

  it('carries Available forward into a later month', async () => {
    const { data } = await api(app, 'GET', '/api/v1/budget/2026-08');
    const rent = data.groups[0].categories.find((c: { categoryId: string }) => c.categoryId === 'cat-rent');
    expect(rent.availableCents).toBe(231372900);
  });

  it('zeroes carryover without inventing transactions', async () => {
    const txBefore = await api(app, 'GET', '/api/v1/transactions?limit=500');

    const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-08/set-available?response=minimal', {
      categoryId: 'cat-rent', amountCents: 0,
    });

    expect(status).toBe(200);
    expect(data.categories[0].availableCents).toBe(0);
    expect(data.deltaCents).toBe(-231372900);

    const txAfter = await api(app, 'GET', '/api/v1/transactions?limit=500');
    expect(txAfter.data).toHaveLength(txBefore.data.length);
  });

  it('returns the freed money to Ready to Assign', async () => {
    const before = await api(app, 'GET', '/api/v1/budget/2026-08');
    await api(app, 'POST', '/api/v1/budget/2026-08/set-available', { categoryId: 'cat-rent', amountCents: 0 });
    const after = await api(app, 'GET', '/api/v1/budget/2026-08');

    expect(after.data.readyToAssignCents).toBe(before.data.readyToAssignCents + 231372900);
  });

  it('sets Available to an exact non-zero figure', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/set-available', { categoryId: 'cat-rent', amountCents: 49665414 });
    const { data } = await api(app, 'GET', '/api/v1/budget/2026-08');
    const rent = data.groups[0].categories.find((c: { categoryId: string }) => c.categoryId === 'cat-rent');
    expect(rent.availableCents).toBe(49665414);
  });

  it('clears every assignment from a month onward when confirmed', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-food', amountCents: 5000000 });

    const { status, data } = await api(app, 'POST', '/api/v1/budget/reset', { fromMonth: '2026-08', confirm: true });
    expect(status).toBe(200);
    expect(data.clearedCents).toBe(5000000);

    const after = await api(app, 'GET', '/api/v1/budget/2026-08');
    expect(after.data.totalAssignedCents).toBe(0);
  });

  it('refuses to reset without confirmation', async () => {
    const { status } = await api(app, 'POST', '/api/v1/budget/reset', { fromMonth: '2026-08' });
    expect(status).toBe(400);
  });
});

describe('bulk operations', () => {
  it('applies a whole batch of assignments at once', async () => {
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-01', amountCents: 50000000, categoryId: 'ready-to-assign',
    });

    const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-08/bulk-assign?response=minimal', {
      assignments: [
        { categoryId: 'cat-rent', amountCents: 20000000 },
        { categoryId: 'cat-food', amountCents: 15000000 },
        { categoryId: 'cat-debt', amountCents: 10000000 },
      ],
    });

    expect(status).toBe(200);
    expect(data.applied).toBe(3);
    expect(data.categories).toHaveLength(3);
    expect(data.readyToAssignCents).toBe(5000000);
  });

  it('applies none of a batch when one id is unknown', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-08/bulk-assign', {
      assignments: [
        { categoryId: 'cat-rent', amountCents: 20000000 },
        { categoryId: 'does-not-exist', amountCents: 15000000 },
      ],
    });

    expect(status).toBe(404);
    expect(data.error.code).toBe('UNKNOWN_REFERENCE');

    const budget = await api(app, 'GET', '/api/v1/budget/2026-08');
    expect(budget.data.totalAssignedCents).toBe(0);
  });

  it('rejects a batch naming the same category twice', async () => {
    const { status } = await api(app, 'POST', '/api/v1/budget/2026-08/bulk-assign', {
      assignments: [
        { categoryId: 'cat-rent', amountCents: 1 },
        { categoryId: 'cat-rent', amountCents: 2 },
      ],
    });
    expect(status).toBe(400);
  });

  it('writes many transactions in one call', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [
        { accountId: 'acc-main', date: '2026-08-01', amountCents: -1000, payeeName: 'Магнум', categoryId: 'cat-food' },
        { accountId: 'acc-main', date: '2026-08-02', amountCents: -2000, payeeName: 'Small', categoryId: 'cat-food' },
      ],
    });

    expect(status).toBe(201);
    expect(data.created).toBe(2);
  });

  it('leaves nothing written when a row in the batch is bad', async () => {
    const { status } = await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [
        { accountId: 'acc-main', date: '2026-08-01', amountCents: -1000 },
        { accountId: 'no-such-account', date: '2026-08-02', amountCents: -2000 },
      ],
    });

    expect(status).toBe(404);
    const list = await api(app, 'GET', '/api/v1/transactions?limit=500');
    expect(list.data).toHaveLength(0);
  });

  it('skips rows duplicating what is already stored', async () => {
    const row = { accountId: 'acc-main', date: '2026-08-01', amountCents: -1000, payeeName: 'Магнум' };
    await api(app, 'POST', '/api/v1/transactions', row);

    const { data } = await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [row, { ...row, date: '2026-08-02' }],
      skipDuplicates: true,
    });

    expect(data.created).toBe(1);
    expect(data.skipped).toBe(1);
  });
});

describe('minimal responses', () => {
  it('returns only the touched category', async () => {
    const { data } = await api(app, 'POST', '/api/v1/budget/2026-08/assign?response=minimal', {
      categoryId: 'cat-rent', amountCents: 15000000,
    });

    expect(data.categories).toHaveLength(1);
    expect(data.categories[0].categoryId).toBe('cat-rent');
    expect(data.groups).toBeUndefined();
    expect(data.readyToAssignFormatted).toBeDefined();
  });

  it('still returns the whole month by default', async () => {
    const { data } = await api(app, 'POST', '/api/v1/budget/2026-08/assign', {
      categoryId: 'cat-rent', amountCents: 15000000,
    });

    expect(data.groups).toBeDefined();
    expect(data.groups[0].categories).toHaveLength(3);
  });

  it('returns both sides of a move', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 15000000 });
    const { data } = await api(app, 'POST', '/api/v1/budget/2026-08/move?response=minimal', {
      fromCategoryId: 'cat-rent', toCategoryId: 'cat-food', amountCents: 5000000,
    });

    expect(data.categories.map((x: { categoryId: string }) => x.categoryId).sort())
      .toEqual(['cat-food', 'cat-rent']);
  });
});

describe('accounts that move the totals stay visible', () => {
  it('hides deactivated accounts by default and shows them on request', async () => {
    const plain = await api(app, 'GET', '/api/v1/accounts');
    expect(plain.data.map((a: { id: string }) => a.id)).not.toContain('acc-ghost');

    const all = await api(app, 'GET', '/api/v1/accounts?includeInactive=true');
    const ghost = all.data.find((a: { id: string }) => a.id === 'acc-ghost');
    expect(ghost).toBeDefined();
    expect(ghost.isActive).toBe(false);
  });

  it('reports the balance of a deactivated account', async () => {
    db.$client.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
      .run('tx-ghost', 'acc-ghost', '2026-07-01', -3115444, '2026-07-01', '2026-07-01');

    const { data } = await api(app, 'GET', '/api/v1/accounts?includeInactive=true');
    const ghost = data.find((a: { id: string }) => a.id === 'acc-ghost');
    expect(ghost.balanceCents).toBe(-3115444);
  });

  it('exposes onBudget and currency for every account', async () => {
    const { data } = await api(app, 'GET', '/api/v1/accounts');
    const cny = data.find((a: { id: string }) => a.id === 'acc-cny');
    expect(cny.onBudget).toBe(false);
    expect(cny.currency).toBe('CNY');
  });
});

describe('reconciliation', () => {
  it('accounts for the gap between balances and the budget', async () => {
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-01', amountCents: 50000000, categoryId: 'ready-to-assign',
    });
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-cny', date: '2026-08-01', amountCents: 5931600,
    });

    const { status, data } = await api(app, 'GET', '/api/v1/budget/2026-08/reconciliation');

    expect(status).toBe(200);
    expect(data.onBudgetBalanceCents).toBe(50000000);
    expect(data.offBudgetBalanceCents).toBe(5931600);
    expect(data.reconciliation.gapCents).toBe(5931600);
    expect(data.reconciliation.offBudgetBalanceCents).toBe(5931600);
    // Nothing is left over once each bucket is named.
    expect(data.reconciliation.unexplainedCents).toBe(0);
  });

  it('names uncategorised spending as its own bucket', async () => {
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-01', amountCents: 50000000, categoryId: 'ready-to-assign',
    });
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-02', amountCents: -1000000,
    });

    const { data } = await api(app, 'GET', '/api/v1/budget/2026-08/reconciliation');
    expect(data.reconciliation.uncategorizedCents).toBe(-1000000);
    expect(data.reconciliation.uncategorizedCount).toBe(1);
    expect(data.reconciliation.unexplainedCents).toBe(0);
  });

  it('corrects a drifted balance with a single adjustment', async () => {
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc-main', date: '2026-08-01', amountCents: 231372900, categoryId: 'ready-to-assign',
    });

    const { status, data } = await api(app, 'POST', '/api/v1/accounts/acc-main/reconcile', {
      actualBalanceCents: 49665414, date: '2026-08-07',
    });

    expect(status).toBe(200);
    expect(data.adjustmentCents).toBe(49665414 - 231372900);

    const accounts = await api(app, 'GET', '/api/v1/accounts');
    expect(accounts.data.find((a: { id: string }) => a.id === 'acc-main').balanceCents).toBe(49665414);

    const txs = await api(app, 'GET', '/api/v1/transactions?limit=500');
    expect(txs.data).toHaveLength(2);
  });

  it('writes nothing when the balance already matches', async () => {
    const { data } = await api(app, 'POST', '/api/v1/accounts/acc-main/reconcile', { actualBalanceCents: 0 });
    expect(data.adjustmentCents).toBe(0);
    expect(data.transactionId).toBeNull();
  });
});

describe('audit and undo', () => {
  it('records what a request changed', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 15000000 });

    const { data } = await api(app, 'GET', '/api/v1/audit');
    expect(data.batches.length).toBeGreaterThan(0);
    expect(data.batches[0].path).toBe('/api/v1/budget/2026-08/assign');
    expect(data.batches[0].changes[0].entity).toBe('monthly_budgets');
  });

  it('groups a bulk write into one batch', async () => {
    await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [
        { accountId: 'acc-main', date: '2026-08-01', amountCents: -1000 },
        { accountId: 'acc-main', date: '2026-08-02', amountCents: -2000 },
        { accountId: 'acc-main', date: '2026-08-03', amountCents: -3000 },
      ],
    });

    const { data } = await api(app, 'GET', '/api/v1/audit?entity=transactions');
    expect(data.batches).toHaveLength(1);
    expect(data.batches[0].changeCount).toBe(3);
  });

  it('undoes a batch of transactions in one call', async () => {
    await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [
        { accountId: 'acc-main', date: '2026-08-01', amountCents: -1000 },
        { accountId: 'acc-main', date: '2026-08-02', amountCents: -2000 },
      ],
    });

    const audit = await api(app, 'GET', '/api/v1/audit?entity=transactions');
    const batchId = audit.data.batches[0].batchId;

    const undo = await api(app, 'POST', '/api/v1/audit/undo', { batchId });
    expect(undo.status).toBe(200);
    expect(undo.data.reverted).toBe(2);

    const txs = await api(app, 'GET', '/api/v1/transactions?limit=500');
    expect(txs.data).toHaveLength(0);
  });

  it('restores the prior value when undoing an update', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 15000000 });
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 99000000 });

    const audit = await api(app, 'GET', '/api/v1/audit?entity=monthly_budgets');
    const latest = audit.data.batches[0].batchId;

    await api(app, 'POST', '/api/v1/audit/undo', { batchId: latest });

    const budget = await api(app, 'GET', '/api/v1/budget/2026-08');
    const rent = budget.data.groups[0].categories.find((c: { categoryId: string }) => c.categoryId === 'cat-rent');
    expect(rent.assignedCents).toBe(15000000);
  });

  it('marks writes that bypassed the API instead of showing a blank batch', async () => {
    // A migration, a seed or a maintenance script writes straight to the
    // database, so the triggers fire but no request stamps the row.
    db.$client.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
      .run('tx-direct', 'acc-main', '2026-08-01', -5000, '2026-08-01', '2026-08-01');

    const { data } = await api(app, 'GET', '/api/v1/audit?entity=transactions');
    const direct = data.batches.find((b: { batchId: string }) => b.batchId === 'pending');

    expect(direct).toBeDefined();
    expect(direct.method).toBe('DIRECT');
    expect(direct.path).toMatch(/outside the API/);
  });

  it('refuses to undo writes that never came through the API', async () => {
    db.$client.prepare(`INSERT INTO transactions (id, account_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`)
      .run('tx-direct-2', 'acc-main', '2026-08-01', -5000, '2026-08-01', '2026-08-01');

    const { status, data } = await api(app, 'POST', '/api/v1/audit/undo', { batchId: 'pending' });
    expect(status).toBe(400);
    expect(data.error.message).toMatch(/by hand/);
  });

  it('refuses to undo a batch twice', async () => {
    await api(app, 'POST', '/api/v1/budget/2026-08/assign', { categoryId: 'cat-rent', amountCents: 15000000 });
    const audit = await api(app, 'GET', '/api/v1/audit');
    const batchId = audit.data.batches[0].batchId;

    await api(app, 'POST', '/api/v1/audit/undo', { batchId });
    const second = await api(app, 'POST', '/api/v1/audit/undo', { batchId });
    expect(second.status).toBe(404);
  });
});

describe('CSV import', () => {
  const csv = [
    'Date,Amount,Description',
    '01.08.2026,"-15 000,50",Магнум',
    '02.08.2026,"-2 300,00",Такси',
    '2026-08-03,450000.00,Зарплата',
  ].join('\n');

  it('previews without writing when asked to', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions/import', {
      accountId: 'acc-main', csv, dryRun: true,
    });

    expect(status).toBe(200);
    expect(data.parsed).toBe(3);
    expect(data.wouldImport).toBe(3);

    const txs = await api(app, 'GET', '/api/v1/transactions?limit=500');
    expect(txs.data).toHaveLength(0);
  });

  it('parses spaced thousands, comma decimals and both date styles', async () => {
    const { data } = await api(app, 'POST', '/api/v1/transactions/import', { accountId: 'acc-main', csv });

    expect(data.imported).toBe(3);

    const txs = await api(app, 'GET', '/api/v1/transactions?limit=500');
    const byDate = Object.fromEntries(txs.data.map((t: any) => [t.date, t.amountCents]));
    expect(byDate['2026-08-01']).toBe(-1500050);
    expect(byDate['2026-08-02']).toBe(-230000);
    expect(byDate['2026-08-03']).toBe(45000000);
  });

  it('skips rows already imported when the statement overlaps', async () => {
    await api(app, 'POST', '/api/v1/transactions/import', { accountId: 'acc-main', csv });
    const { data } = await api(app, 'POST', '/api/v1/transactions/import', { accountId: 'acc-main', csv });

    expect(data.imported).toBe(0);
    expect(data.duplicates).toBe(3);
  });

  it('reports which column it could not find', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions/import', {
      accountId: 'acc-main', csv: 'foo,bar\n1,2',
    });

    expect(status).toBe(400);
    expect(data.error.message).toMatch(/date/i);
  });
});
