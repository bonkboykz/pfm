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
