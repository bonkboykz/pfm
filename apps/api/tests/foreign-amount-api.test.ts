import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * Валютная покупка на тенговой карте.
 *
 * Счёт в тенге, карта списывает тенге — мультивалютного учёта тут нет. Есть
 * число, у которого известно происхождение (10,59 $ по курсу 464,02) и которое
 * сначала оценочное, а после выписки фактическое. Раньше и то и другое агент
 * складывал в memo текстом: найти запросом нельзя, пересчитать нельзя, и через
 * месяц оценки не отличить от подтверждённых.
 *
 * Курс хранится целым: тиыны за одну единицу валюты, 464,02 ₸/$ → 46402.
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
  const now = '2026-08-16T00:00:00.000Z';
  s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES ('acc', 'Forte Visa Signature', 'checking', 1, 'KZT', 0, 1, ?, ?)`,
  ).run(now, now);
}

const COLAB = {
  accountId: 'acc',
  date: '2026-08-16',
  amountCents: -491397,
  payeeName: 'Google Colab',
  originalAmountCents: -1059,
  originalCurrency: 'USD',
  quotedRateCents: 46402,
  isEstimated: true,
};

describe('операция в валюте на тенговом счёте', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    seed(db);
    app = createApp(db);
  });

  it('сохраняет исходную сумму, валюту и курс', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions', COLAB);

    expect(status).toBe(201);
    expect(data.originalAmountCents).toBe(-1059);
    expect(data.originalCurrency).toBe('USD');
    expect(data.quotedRateCents).toBe(46402);
    expect(data.isEstimated).toBe(true);
    // Тенговая сумма остаётся тем, что видит бюджет.
    expect(data.amountCents).toBe(-491397);
  });

  it('показывает исходную сумму человеку и агенту', async () => {
    const { data } = await api(app, 'POST', '/api/v1/transactions', COLAB);
    expect(data.originalAmountFormatted).toBe('-$10,59');
  });

  it('валюта без суммы не принимается', async () => {
    // Иначе получилась бы строка «в долларах» без долларов.
    const { status } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-16',
      amountCents: -100000,
      originalCurrency: 'USD',
    });

    expect(status).toBe(400);
  });

  it('оценочные операции находятся отдельным фильтром', async () => {
    await api(app, 'POST', '/api/v1/transactions', COLAB);
    await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-15',
      amountCents: -314900,
      payeeName: 'Продукты',
    });

    const { data } = await api(app, 'GET', '/api/v1/transactions?estimated=true');
    expect(data).toHaveLength(1);
    expect(data[0].payeeName).toBe('Google Colab');
  });

  it('уточнение по выписке меняет сумму и снимает признак', async () => {
    const created = await api(app, 'POST', '/api/v1/transactions', COLAB);

    // Банк списал по своему курсу с комиссией — 4 981,20 ₸.
    const { data } = await api(app, 'PATCH', `/api/v1/transactions/${created.data.id}`, {
      amountCents: -498120,
      isEstimated: false,
    });

    expect(data.amountCents).toBe(-498120);
    expect(data.isEstimated).toBe(false);
    // Исходная сумма и курс ввода переживают уточнение: по ним считается,
    // сколько на самом деле забрал банк.
    expect(data.originalAmountCents).toBe(-1059);
    expect(data.quotedRateCents).toBe(46402);
  });

  it('обычная тенговая операция не обрастает лишним', async () => {
    const { data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-15',
      amountCents: -314900,
      payeeName: 'Продукты',
    });

    expect(data.originalAmountCents).toBeNull();
    expect(data.originalCurrency).toBeNull();
    expect(data.quotedRateCents).toBeNull();
    expect(data.isEstimated).toBe(false);
    expect(data.originalAmountFormatted).toBeNull();
  });
});
