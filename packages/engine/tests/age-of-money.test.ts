import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { getAgeOfMoney } from '../src/budget/age.js';

/**
 * Возраст денег — четвёртое правило YNAB.
 *
 * Сколько дней в среднем тенге лежит на счетах до того, как его потратят.
 * Разбирается FIFO: каждое списание съедает самые старые непотраченные
 * поступления. Возраст больше тридцати означает, что месяц живётся на прошлый
 * доход, и дата зарплаты перестаёт быть событием.
 *
 * Метрика поведенческая: богаче она не делает, она убирает зависимость от дат.
 */

const GROUP = 'grp';
const NOW = '2026-01-01T00:00:00.000Z';

function seed(): DB {
  const db = createDb(':memory:');
  const s = db.$client;
  initializeDatabase(s);

  s.prepare(
    `INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
     VALUES (?, 'Тест', 0, 1, 0, ?)`,
  ).run(GROUP, NOW);
  s.prepare(
    `INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
     VALUES ('food', ?, 'Продукты', 0, 0, 0, ?)`,
  ).run(GROUP, NOW);

  const acct = s.prepare(
    `INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, 'checking', ?, 'KZT', 0, 1, ?, ?)`,
  );
  acct.run('bank-a', 'Kaspi Gold', 1, NOW, NOW);
  acct.run('bank-b', 'Forte Visa', 1, NOW, NOW);
  acct.run('outside', 'Наличные', 0, NOW, NOW);

  return db;
}

let seq = 0;
function tx(db: DB, account: string, date: string, cents: number, categoryId: string | null) {
  db.$client
    .prepare(
      `INSERT INTO transactions (id, account_id, category_id, date, amount_cents, cleared, approved, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
    )
    .run(`tx-${seq++}`, account, categoryId, date, cents, NOW, NOW);
}

function income(db: DB, date: string, cents: number) {
  tx(db, 'bank-a', date, cents, 'ready-to-assign');
}

function spend(db: DB, date: string, cents: number) {
  tx(db, 'bank-a', date, -cents, 'food');
}

function internalTransfer(db: DB, date: string, cents: number) {
  const s = db.$client;
  const ins = s.prepare(
    `INSERT INTO transactions (id, account_id, category_id, date, amount_cents,
       transfer_account_id, transfer_transaction_id, cleared, approved, is_deleted, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'cleared', 1, 0, ?, ?)`,
  );
  const a = `tr-${seq++}`, b = `tr-${seq++}`;
  ins.run(a, 'bank-a', date, -cents, 'bank-b', b, NOW, NOW);
  ins.run(b, 'bank-b', date, cents, 'bank-a', a, NOW, NOW);
}

describe('возраст денег', () => {
  it('одно поступление и одна трата — возраст равен разнице дат', () => {
    const db = seed();
    income(db, '2026-01-01', 10000000);
    spend(db, '2026-01-11', 1000000);

    expect(getAgeOfMoney(db)!.days).toBe(10);
  });

  it('тратится самое старое поступление, а не ближайшее', () => {
    // Смысл FIFO: деньги стареют в очереди. Возьми движок последнее
    // поступление — возраст всегда был бы около нуля, и метрика ничего бы
    // не измеряла.
    const db = seed();
    income(db, '2026-01-01', 1000000);
    income(db, '2026-01-20', 9000000);
    spend(db, '2026-01-21', 1000000);

    expect(getAgeOfMoney(db)!.days).toBe(20);
  });

  it('трата из двух партий берёт возраст по взвешенному среднему', () => {
    // 1 000 из партии возрастом 20 дней и 1 000 из партии возрастом 1 день.
    const db = seed();
    income(db, '2026-01-01', 1000000);
    income(db, '2026-01-20', 1000000);
    spend(db, '2026-01-21', 2000000);

    expect(getAgeOfMoney(db)!.days).toBe(10);
  });

  it('усредняет последние списания, а не всю историю', () => {
    // Метрика должна показывать, как дела сейчас. Иначе давняя история
    // навсегда придавит любое улучшение.
    const db = seed();
    income(db, '2026-01-01', 100000000);
    spend(db, '2026-01-02', 1000000);   // возраст 1 — должен выпасть из выборки
    for (let d = 11; d <= 13; d++) spend(db, `2026-02-${d}`, 1000000);

    const result = getAgeOfMoney(db, undefined, 3)!;
    expect(result.sampleSize).toBe(3);
    expect(result.days).toBe(42); // 41, 42, 43
  });

  it('перевод между своими счетами не старит и не тратит', () => {
    const db = seed();
    income(db, '2026-01-01', 10000000);
    internalTransfer(db, '2026-01-05', 5000000);
    spend(db, '2026-01-11', 1000000);

    expect(getAgeOfMoney(db)!.days).toBe(10);
  });

  it('без поступлений или без трат возраст не определён', () => {
    const empty = seed();
    expect(getAgeOfMoney(empty)).toBeNull();

    const noSpending = seed();
    income(noSpending, '2026-01-01', 10000000);
    expect(getAgeOfMoney(noSpending)).toBeNull();
  });

  it('не заглядывает за asOfDate', () => {
    const db = seed();
    income(db, '2026-01-01', 10000000);
    spend(db, '2026-01-11', 1000000);
    spend(db, '2026-03-01', 1000000);

    expect(getAgeOfMoney(db, '2026-01-31')!.days).toBe(10);
  });
});
