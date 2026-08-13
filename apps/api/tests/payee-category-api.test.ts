import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import type { DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import { createTestDb } from './fixtures/db.js';

/**
 * Подстановка категории по плательщику.
 *
 * `payees.last_category_id` заполнялся с первого дня и не читался нигде: база
 * знала, что «Магнум» это продукты, и молчала об этом на каждой новой операции
 * и на каждом импорте. Здесь она наконец отвечает — но только когда категорию
 * не назвали явно.
 */

async function api(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function seed(db: DB) {
  const s = db.$client;
  const now = '2026-08-14T00:00:00.000Z';

  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('acc', 'Halyk', 'checking', now, now);
  acct.run('acc-2', 'Kaspi', 'checking', now, now);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('grp', 'Расходы', 0, 1, 0, ?)`,
  ).run(now);

  const cat = s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'grp', ?, 0, ?, ?, ?)`,
  );
  cat.run('cat-food', 'Продукты', 0, 0, now);
  cat.run('cat-fun', 'Развлечения', 1, 0, now);
  cat.run('cat-old', 'Старое', 2, 1, now); // скрытая

  const payee = s.prepare(
    `INSERT INTO payees (id, name, last_category_id, created_at) VALUES (?, ?, ?, ?)`,
  );
  payee.run('p-magnum', 'Магнум', 'cat-food', now);
  payee.run('p-stale', 'Ларёк', 'cat-old', now);
  payee.run('p-blank', 'Неизвестный', null, now);
}

describe('категория по плательщику', () => {
  let db: DB;
  let app: Hono;

  beforeEach(() => {
    db = createTestDb();
    seed(db);
    app = createApp(db);
  });

  it('подставляет последнюю категорию плательщика, когда её не назвали', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -450000,
      payeeName: 'Магнум',
    });

    expect(status).toBe(201);
    expect(data.categoryId).toBe('cat-food');
  });

  it('не перетирает категорию, названную явно', async () => {
    const { data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -450000,
      payeeName: 'Магнум',
      categoryId: 'cat-fun',
    });

    expect(data.categoryId).toBe('cat-fun');

    // И плательщик запоминает новый выбор — иначе подсказка застрянет навсегда.
    const payee = db.$client
      .prepare(`SELECT last_category_id AS c FROM payees WHERE name = 'Магнум'`)
      .get() as { c: string };
    expect(payee.c).toBe('cat-fun');
  });

  it('оставляет операцию без категории, когда плательщик её не помнит', async () => {
    const { data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -100000,
      payeeName: 'Неизвестный',
    });

    expect(data.categoryId).toBeNull();
  });

  it('не подставляет скрытую категорию', async () => {
    // Категорию спрятали — предлагать её значит воскрешать то, что убрали
    // с глаз, причём молча.
    const { data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -100000,
      payeeName: 'Ларёк',
    });

    expect(data.categoryId).toBeNull();
  });

  it('не трогает перевод между счетами', async () => {
    // У перевода category_id пустой по определению: он не расход и не доход.
    const { data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: 'acc',
      date: '2026-08-14',
      amountCents: -500000,
      transferAccountId: 'acc-2',
      payeeName: 'Магнум',
    });

    expect(data).toHaveLength(2);
    expect(data[0].categoryId).toBeNull();
    expect(data[1].categoryId).toBeNull();
  });

  it('работает и в массовом создании', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions/bulk', {
      transactions: [
        { accountId: 'acc', date: '2026-08-14', amountCents: -100000, payeeName: 'Магнум' },
        { accountId: 'acc', date: '2026-08-14', amountCents: -200000, payeeName: 'Неизвестный' },
      ],
    });

    expect(status).toBe(201);
    const rows = db.$client
      .prepare(`SELECT category_id AS c FROM transactions ORDER BY amount_cents DESC`)
      .all() as Array<{ c: string | null }>;
    expect(rows.map((r) => r.c)).toEqual(['cat-food', null]);
  });

  it('предпросмотр импорта показывает будущие категории', async () => {
    // dryRun обязан показывать то, что получится. Если предпросмотр молчит о
    // категориях, а импорт их проставляет, предпросмотр врёт.
    const csv = ['date,amount,payee', '2026-08-14,-4500,Магнум', '2026-08-14,-1200,Неизвестный'].join('\n');

    const { data } = await api(app, 'POST', '/api/v1/transactions/import', {
      accountId: 'acc',
      csv,
      dryRun: true,
    });

    expect(data.wouldCategorise).toBe(1);
    expect(data.preview.map((p: { categoryId: string | null }) => p.categoryId)).toEqual([
      'cat-food',
      null,
    ]);
  });

  it('импорт категоризует знакомых плательщиков и говорит сколько', async () => {
    const csv = [
      'date,amount,payee',
      '2026-08-14,-4500,Магнум',
      '2026-08-14,-1200,Неизвестный',
    ].join('\n');

    const { status, data } = await api(app, 'POST', '/api/v1/transactions/import', {
      accountId: 'acc',
      csv,
    });

    expect(status).toBe(201);
    expect(data.imported).toBe(2);
    expect(data.categorised).toBe(1);

    const rows = db.$client
      .prepare(`SELECT payee_name AS p, category_id AS c FROM transactions ORDER BY amount_cents`)
      .all() as Array<{ p: string; c: string | null }>;
    expect(rows).toEqual([
      { p: 'Магнум', c: 'cat-food' },
      { p: 'Неизвестный', c: null },
    ]);
  });
});
