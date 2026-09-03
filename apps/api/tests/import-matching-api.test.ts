import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { accounts, categories, transactions } from '@pfm/engine';
import { createTestDb } from './fixtures/db.js';
import { transactionRoutes } from '../src/routes/transactions.js';
import { errorHandler } from '../src/errors.js';

/**
 * Импорт выписки встречается с тем, что уже введено руками.
 *
 * Дедуп был точным: совпасть должны дата, сумма и плательщик. Но банк ставит
 * дату проводки, а не покупки, и пишет плательщика по-своему — «купил кофе
 * вчера» и та же строка из выписки расходились по всем трём полям и давали
 * дубль.
 *
 * Здесь правила противоположны матчингу регулярных платежей, и намеренно.
 * Там плательщик обязателен, а сумма плавает: правило знает, кому платит, но
 * не сколько выйдет. Тут наоборот — сумма из банка точна до тиына, а имя
 * плательщика в выписке своё. Поэтому совпадение ищется по счёту, точной
 * сумме и окну ±10 дней, а плательщик не участвует.
 *
 * При совпадении банк подтверждает сумму, а разметка остаётся моя: категорию
 * и название плательщика я ставил осмысленно, и затирать их выпиской нельзя.
 */
describe('матчинг импорта', () => {
  const db = createTestDb();
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/transactions', transactionRoutes(db));

  beforeEach(() => {
    db.delete(transactions).run();
    db.insert(accounts)
      .values({ id: 'acc', name: 'Forte', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    db.insert(accounts)
      .values({ id: 'other', name: 'Kaspi', type: 'checking', onBudget: true })
      .onConflictDoNothing().run();
    db.insert(categories)
      .values({ id: 'cat', groupId: 'inflow-group', name: 'Кафе' })
      .onConflictDoNothing().run();
  });

  const csv = 'date,amount,payee\n2026-08-20,-5353.92,WOLT.COM VIRTUAL POS\n';

  function importCsv(body: Record<string, unknown> = {}) {
    return app.request('/transactions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc', csv, ...body }),
    });
  }

  /** Операция, заведённая руками: своя дата, свой плательщик, своя категория. */
  function manual(overrides: Record<string, unknown> = {}) {
    db.insert(transactions).values({
      id: 'manual',
      accountId: 'acc',
      date: '2026-08-18',
      amountCents: -535392,
      payeeName: 'Wolt',
      categoryId: 'cat',
      memo: 'ужин',
      ...overrides,
    }).run();
  }

  it('строка выписки не дублирует введённое руками', async () => {
    manual();
    const res = await importCsv();
    const json = await res.json();

    expect(json.imported).toBe(0);
    expect(json.matched).toBe(1);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it('совпадение сохраняет мою разметку и подтверждает сумму', async () => {
    manual();
    await importCsv();

    const tx = db.select().from(transactions).all()[0];
    expect(tx.payeeName).toBe('Wolt');
    expect(tx.categoryId).toBe('cat');
    expect(tx.memo).toBe('ужин');
    expect(tx.date).toBe('2026-08-18');
    // Банк подтвердил, что деньги ушли.
    expect(tx.cleared).toBe('cleared');
  });

  it('другая сумма — другая операция', async () => {
    manual({ amountCents: -500000 });
    const json = await (await importCsv()).json();

    expect(json.imported).toBe(1);
    expect(json.matched).toBe(0);
  });

  it('за пределами десяти дней — другая операция', async () => {
    manual({ date: '2026-08-05' });
    const json = await (await importCsv()).json();

    expect(json.imported).toBe(1);
  });

  it('на другом счёте — другая операция', async () => {
    manual({ accountId: 'other' });
    const json = await (await importCsv()).json();

    expect(json.imported).toBe(1);
  });

  it('повторный импорт того же файла не создаёт ничего', async () => {
    const first = await (await importCsv()).json();
    expect(first.imported).toBe(1);

    const second = await (await importCsv()).json();
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });

  it('уже импортированная строка не перематчивается на новую', async () => {
    // Иначе вторая покупка на ту же сумму в том же окне склеилась бы с первой.
    await importCsv();
    const twoRows =
      'date,amount,payee\n2026-08-20,-5353.92,WOLT.COM\n2026-08-21,-5353.92,WOLT.COM\n';
    const json = await (await importCsv({ csv: twoRows })).json();

    expect(json.imported).toBe(1);
    expect(json.duplicates).toBe(1);
  });
});
