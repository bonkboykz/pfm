import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, initializeDatabase, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  initializeDatabase(sqlite);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run('inflow-group', 'Inflow', now);
  sqlite.prepare(`INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run('ready-to-assign', 'inflow-group', 'Ready to Assign', now);

  return db;
}

async function api(app: Hono, method: string, path: string, body?: any) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}

describe('Deposits API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  it('GET /api/v1/deposits returns empty list initially', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits');
    expect(status).toBe(200);
    expect(data).toEqual([]);
  });

  it('POST /api/v1/deposits creates a term deposit', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/deposits', {
      name: 'Halyk Срочный 14.5%',
      bankName: 'Halyk Bank',
      type: 'term',
      initialAmountCents: 100000000,
      annualRateBps: 1450,
      termMonths: 12,
      startDate: '2025-06-01',
      endDate: '2026-06-01',
      capitalization: 'monthly',
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Halyk Срочный 14.5%');
    expect(data.initialAmountCents).toBe(100000000);
    expect(data.initialAmountFormatted).toBeDefined();
    expect(data.currentBalanceCents).toBe(100000000);
    expect(data.currentBalanceFormatted).toBeDefined();
    expect(data.projectedInterestCents).toBeGreaterThan(0);
  });

  it('GET /api/v1/deposits lists created deposit', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits');
    expect(status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Halyk Срочный 14.5%');
  });

  it('GET /api/v1/deposits/:id returns deposit details', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'GET', `/api/v1/deposits/${list[0].id}`);
    expect(status).toBe(200);
    expect(data.initialAmountCents).toBe(100000000);
    expect(data.annualRateBps).toBe(1450);
  });

  it('PATCH /api/v1/deposits/:id updates topUpCents', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'PATCH', `/api/v1/deposits/${list[0].id}`, {
      topUpCents: 50000000,
    });
    expect(status).toBe(200);
    expect(data.topUpCents).toBe(50000000);
    // Balance should reflect topUp (no account linked)
    expect(data.currentBalanceCents).toBe(150000000);
  });

  it('GET /api/v1/deposits/:id/schedule returns interest schedule', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const { status, data } = await api(app, 'GET', `/api/v1/deposits/${list[0].id}/schedule`);
    expect(status).toBe(200);
    expect(data.schedule.length).toBe(12);
    expect(data.schedule[0].interestCents).toBeGreaterThan(0);
    expect(data.schedule[0].interestFormatted).toBeDefined();
    expect(data.schedule[11].endBalanceCents).toBeGreaterThan(150000000);
  });

  it('POST /api/v1/deposits creates savings (perpetual) deposit', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/deposits', {
      name: 'Kaspi Накопительный',
      bankName: 'Kaspi Bank',
      type: 'savings',
      initialAmountCents: 50000000,
      annualRateBps: 1000,
      termMonths: 0,
      startDate: '2025-01-01',
      isWithdrawable: true,
      isReplenishable: true,
    });
    expect(status).toBe(201);
    expect(data.type).toBe('savings');
    expect(data.termMonths).toBe(0);
    expect(data.isWithdrawable).toBe(true);
  });

  it('DELETE /api/v1/deposits/:id soft deletes', async () => {
    const { data: list } = await api(app, 'GET', '/api/v1/deposits');
    const lastId = list[list.length - 1].id;
    const { status } = await api(app, 'DELETE', `/api/v1/deposits/${lastId}`);
    expect(status).toBe(200);

    const { data: newList } = await api(app, 'GET', '/api/v1/deposits');
    expect(newList.find((d: any) => d.id === lastId)).toBeUndefined();
  });

  it('GET /api/v1/deposits/kdif returns KDIF exposure', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/deposits/kdif');
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    // We have 1 active deposit (Halyk)
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].bankName).toBeDefined();
    expect(data[0].totalDepositsCents).toBeGreaterThan(0);
    expect(data[0].guaranteeLimitCents).toBe(1500000000);
    expect(data[0].totalDepositsFormatted).toBeDefined();
  });

  it('GET /api/v1/deposits/nonexistent returns 404', async () => {
    const { status } = await api(app, 'GET', '/api/v1/deposits/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/v1/deposits with invalid data returns 400', async () => {
    const { status } = await api(app, 'POST', '/api/v1/deposits', {});
    expect(status).toBe(400);
  });

  it('POST /api/v1/simulate/deposit-compare compares deposits', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/simulate/deposit-compare', {
      deposits: [
        { name: 'Halyk 14.5%', initialAmountCents: 100000000, annualRateBps: 1450, termMonths: 12, capitalization: 'monthly' },
        { name: 'Kaspi 12%', initialAmountCents: 100000000, annualRateBps: 1200, termMonths: 12, capitalization: 'quarterly' },
      ],
    });
    expect(status).toBe(200);
    expect(data.deposits).toHaveLength(2);
    expect(data.recommended).toBe('Halyk 14.5%');
    expect(data.explanation).toContain('Halyk 14.5%');
    expect(data.deposits[0].totalInterestFormatted).toBeDefined();
    expect(data.deposits[0].schedule.length).toBe(12);
  });
});
