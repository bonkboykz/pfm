import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * `*Formatted` в валюте сущности.
 *
 * Строки рендерились в тенге независимо от того, в чём заведён счёт или вклад.
 * Из-за этого в мобильном клиенте живёт порт форматера с правилом «если у
 * сущности своя валюта — форматируй сам из *Cents». Валюта есть у счетов,
 * вкладов и личных долгов; у кредитов и бюджета колонки нет вовсе, там тенге
 * — не умолчание, а единственный вариант.
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
  const now = '2026-08-14T00:00:00.000Z';

  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, 'checking', 1, ?, 0, 1, ?, ?)`,
  );
  acct.run('acc-kzt', 'Halyk', 'KZT', now, now);
  acct.run('acc-usd', 'Wise', 'USD', now, now);

  const tx = s.prepare(
    `INSERT INTO transactions (id, account_id, date, amount_cents, payee_name, cleared, approved, is_deleted, created_at, updated_at)
     VALUES (?, ?, '2026-08-14', ?, ?, 'cleared', 1, 0, ?, ?)`,
  );
  tx.run('tx-usd', 'acc-usd', -123456, 'Amazon', now, now);
  tx.run('tx-kzt', 'acc-kzt', -450099, 'Магнум', now, now);

  s.prepare(
    `INSERT INTO deposits
       (id, name, bank_name, type, account_id, initial_amount_cents, currency, annual_rate_bps,
        term_months, start_date, end_date, capitalization, is_active, created_at, updated_at)
     VALUES ('dep-usd', 'Wise Save', 'Wise', 'term', 'acc-usd', 500000, 'USD', 400,
        12, '2026-01-01', '2027-01-01', 'monthly', 1, ?, ?)`,
  ).run(now, now);
}

describe('*Formatted учитывает валюту сущности', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    seed(db);
    app = createApp(db);
  });

  it('операция форматируется в валюте своего счёта', async () => {
    const { data } = await api(app, 'GET', '/api/v1/transactions');
    const byId = Object.fromEntries(data.map((t: { id: string }) => [t.id, t]));

    expect(byId['tx-usd'].amountFormatted).toBe('-$1 234,56');
    expect(byId['tx-kzt'].amountFormatted).toBe('-4 500,99 ₸');
  });

  it('одиночная операция тоже', async () => {
    const { data } = await api(app, 'GET', '/api/v1/transactions/tx-usd');
    expect(data.amountFormatted).toBe('-$1 234,56');
  });

  it('вклад форматируется в своей валюте', async () => {
    const { data } = await api(app, 'GET', '/api/v1/deposits');
    const dep = data[0];

    expect(dep.initialAmountFormatted).toBe('$5 000');
    // Текущий баланс считается из операций связанного счёта, поэтому число
    // здесь зависит от фикстуры — проверяем валюту, а не сумму.
    expect(dep.currentBalanceFormatted).toContain('$');
    expect(dep.currentBalanceFormatted).not.toContain('₸');
  });

  it('тиыны доезжают до ответа API', async () => {
    // Раньше −4 500,99 ₸ приходило как «-4 500 ₸», и агент через MCP видел
    // именно усечённую строку.
    const { data } = await api(app, 'GET', '/api/v1/accounts');
    const kzt = data.find((a: { id: string }) => a.id === 'acc-kzt');

    expect(kzt.balanceFormatted).toBe('-4 500,99 ₸');
  });
});
