import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';
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
  db = createTestDb();
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
