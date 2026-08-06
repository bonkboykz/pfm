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
