import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * «Создать можно, исправить нельзя».
 *
 * У расписания нельзя было сменить счёт: правило, заведённое на Kaspi Gold,
 * так на нём и оставалось, и единственным выходом было удалить его и создать
 * заново — необратимая операция ради опечатки.
 *
 * У кредита нельзя было поправить условия: ставку, срок, дату начала и тело.
 * Банк пересматривает ставку, человек ошибается при вводе — и оба случая
 * упирались в то же удаление, только там оно уносит ещё и историю платежей.
 */

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function seed(db: DB) {
  const s = db.$client;
  const now = '2026-08-18T00:00:00.000Z';
  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('acc-kaspi', 'Kaspi Gold', now, now);
  acct.run('acc-halyk', 'Halyk Visa Rewards', now, now);

  s.prepare(
    `INSERT INTO scheduled_transactions
       (id, account_id, frequency, next_date, amount_cents, payee_name, is_active, created_at, updated_at)
     VALUES ('sch', 'acc-kaspi', 'monthly', '2026-08-21', -13664865, 'Halyk Bank', 1, ?, ?)`,
  ).run(now, now);

  s.prepare(
    `INSERT INTO loans
       (id, name, type, principal_cents, apr_bps, term_months, start_date,
        monthly_payment_cents, payment_day, penalty_rate_bps, early_repayment_fee_cents,
        paid_off_cents, is_active, created_at, updated_at)
     VALUES ('loan', 'Halyk Кредит', 'loan', 500000000, 2850, 24, '2025-06-01',
        13664865, 21, 0, 0, 0, 1, ?, ?)`,
  ).run(now, now);
}

describe('правка вместо пересоздания', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    seed(db);
    app = createApp(db);
  });

  it('расписанию можно сменить счёт', async () => {
    const { status, data } = await api(app, 'PATCH', '/api/v1/scheduled/sch', {
      accountId: 'acc-halyk',
    });

    expect(status).toBe(200);
    expect(data.accountId).toBe('acc-halyk');
  });

  it('несуществующий счёт расписание не принимает', async () => {
    const { status } = await api(app, 'PATCH', '/api/v1/scheduled/sch', {
      accountId: 'нет-такого',
    });

    expect(status).toBe(404);
  });

  it('кредиту можно поправить условия', async () => {
    const { status, data } = await api(app, 'PATCH', '/api/v1/loans/loan', {
      aprBps: 2650,
      termMonths: 36,
      startDate: '2025-07-01',
      principalCents: 450000000,
    });

    expect(status).toBe(200);
    expect(data.aprBps).toBe(2650);
    expect(data.termMonths).toBe(36);
    expect(data.startDate).toBe('2025-07-01');
    expect(data.principalCents).toBe(450000000);
  });

  it('правка тела не пускает его ниже уже погашенного', async () => {
    await api(app, 'PATCH', '/api/v1/loans/loan', { paidOffCents: 100000000 });
    const { status } = await api(app, 'PATCH', '/api/v1/loans/loan', {
      principalCents: 50000000,
    });

    expect(status).toBe(400);
  });
});
