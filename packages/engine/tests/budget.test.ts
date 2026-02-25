import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import {
  getBudgetMonth,
  assignToCategory,
  moveBetweenCategories,
  getAccountBalances,
  getReadyToAssign,
  getReadyToAssignRange,
} from '../src/budget/engine.js';

// --- Deterministic IDs ---

const acc = {
  kaspiGold: 'acc-kaspi-gold',
  halyk: 'acc-halyk',
  kaspiRed: 'acc-kaspi-red',
  cash: 'acc-cash',
};

const grp = {
  inflow: 'inflow-group',
  fixed: 'grp-fixed',
  variable: 'grp-variable',
  debt: 'grp-debt',
  savings: 'grp-savings',
};

const cat = {
  readyToAssign: 'ready-to-assign',
  rent: 'cat-rent',
  utilities: 'cat-utilities',
  internet: 'cat-internet',
  groceries: 'cat-groceries',
  transport: 'cat-transport',
  cafe: 'cat-cafe',
  entertainment: 'cat-entertainment',
  clothing: 'cat-clothing',
  kaspiRedIphone: 'cat-kaspi-red-iphone',
  halykCredit: 'cat-halyk-credit',
  emergency: 'cat-emergency',
  vacation: 'cat-vacation',
};

const pay = {
  employer: 'pay-employer',
  landlord: 'pay-landlord',
  magnum: 'pay-magnum',
  miniMarket: 'pay-mini-market',
  brisket: 'pay-brisket',
  glovo: 'pay-glovo',
  halykBank: 'pay-halyk-bank',
};

const tx = {
  salary: 'tx-salary',
  rent: 'tx-rent',
  groceries1: 'tx-groceries1',
  groceries2: 'tx-groceries2',
  cafe: 'tx-cafe',
  transferOut: 'tx-transfer-out',
  transferIn: 'tx-transfer-in',
  loan: 'tx-loan',
  glovo: 'tx-glovo',
};

// --- DDL + Seed helper ---

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

  // Create tables (same DDL as migrate.ts)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking')),
      on_budget INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'KZT',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES category_groups(id),
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      target_amount_cents INTEGER,
      target_type TEXT DEFAULT 'none' CHECK(target_type IN ('none', 'monthly_funding', 'target_balance', 'target_by_date')),
      target_date TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      last_category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payee_id TEXT REFERENCES payees(id),
      payee_name TEXT,
      category_id TEXT REFERENCES categories(id),
      transfer_account_id TEXT REFERENCES accounts(id),
      transfer_transaction_id TEXT,
      memo TEXT,
      cleared TEXT NOT NULL DEFAULT 'uncleared' CHECK(cleared IN ('uncleared', 'cleared', 'reconciled')),
      approved INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tx_account_date ON transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_transfer ON transactions(transfer_transaction_id);

    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL,
      assigned_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_budget_cat_month ON monthly_budgets(category_id, month);
  `);

  const now = new Date().toISOString();

  // System records
  sqlite.prepare(`INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, 1, -1, 0, ?)`)
    .run(grp.inflow, 'Inflow', now);
  sqlite.prepare(`INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at) VALUES (?, ?, ?, 1, 0, 0, ?)`)
    .run(cat.readyToAssign, grp.inflow, 'Ready to Assign', now);

  // Accounts
  const insertAccount = sqlite.prepare(`
    INSERT INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'KZT', ?, 1, ?, ?)
  `);
  insertAccount.run(acc.kaspiGold, 'Kaspi Gold', 'checking', 1, 0, now, now);
  insertAccount.run(acc.halyk, 'Halyk Текущий', 'checking', 1, 1, now, now);
  insertAccount.run(acc.kaspiRed, 'Kaspi Red', 'credit_card', 1, 2, now, now);
  insertAccount.run(acc.cash, 'Наличные', 'cash', 1, 3, now, now);

  // Category groups
  const insertGroup = sqlite.prepare(`
    INSERT INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
    VALUES (?, ?, 0, ?, 0, ?)
  `);
  insertGroup.run(grp.fixed, 'Постоянные', 1, now);
  insertGroup.run(grp.variable, 'Переменные', 2, now);
  insertGroup.run(grp.debt, 'Долги', 3, now);
  insertGroup.run(grp.savings, 'Накопления', 4, now);

  // Categories
  const insertCategory = sqlite.prepare(`
    INSERT INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
    VALUES (?, ?, ?, 0, ?, 0, ?)
  `);
  // Постоянные
  insertCategory.run(cat.rent, grp.fixed, 'Аренда', 0, now);
  insertCategory.run(cat.utilities, grp.fixed, 'Коммунальные', 1, now);
  insertCategory.run(cat.internet, grp.fixed, 'Интернет', 2, now);
  // Переменные
  insertCategory.run(cat.groceries, grp.variable, 'Продукты', 0, now);
  insertCategory.run(cat.transport, grp.variable, 'Транспорт', 1, now);
  insertCategory.run(cat.cafe, grp.variable, 'Кафе', 2, now);
  insertCategory.run(cat.entertainment, grp.variable, 'Развлечения', 3, now);
  insertCategory.run(cat.clothing, grp.variable, 'Одежда', 4, now);
  // Долги
  insertCategory.run(cat.kaspiRedIphone, grp.debt, 'Kaspi Red iPhone', 0, now);
  insertCategory.run(cat.halykCredit, grp.debt, 'Халық кредит', 1, now);
  // Накопления
  insertCategory.run(cat.emergency, grp.savings, 'Подушка безопасности', 0, now);
  insertCategory.run(cat.vacation, grp.savings, 'Отпуск', 1, now);

  // Payees
  const insertPayee = sqlite.prepare(`
    INSERT INTO payees (id, name, last_category_id, created_at) VALUES (?, ?, ?, ?)
  `);
  insertPayee.run(pay.employer, 'ТОО Работодатель', cat.readyToAssign, now);
  insertPayee.run(pay.landlord, 'Арендодатель', cat.rent, now);
  insertPayee.run(pay.magnum, 'Magnum', cat.groceries, now);
  insertPayee.run(pay.miniMarket, 'Мини-маркет', cat.groceries, now);
  insertPayee.run(pay.brisket, 'Кофейня Brisket', cat.cafe, now);
  insertPayee.run(pay.glovo, 'Glovo', cat.cafe, now);
  insertPayee.run(pay.halykBank, 'Halyk Bank', cat.halykCredit, now);

  // Transactions
  const insertTx = sqlite.prepare(`
    INSERT INTO transactions (id, account_id, date, amount_cents, payee_id, payee_name, category_id, transfer_account_id, transfer_transaction_id, memo, cleared, approved, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
  `);

  // 1. Salary +500,000₸
  insertTx.run(tx.salary, acc.kaspiGold, '2026-02-05', 50000000, pay.employer, 'ТОО Работодатель', cat.readyToAssign, null, null, 'Зарплата за февраль', 'cleared', now, now);
  // 2. Rent -150,000₸
  insertTx.run(tx.rent, acc.kaspiGold, '2026-02-06', -15000000, pay.landlord, 'Арендодатель', cat.rent, null, null, 'Аренда квартиры', 'cleared', now, now);
  // 3. Groceries -8,500₸
  insertTx.run(tx.groceries1, acc.kaspiGold, '2026-02-08', -850000, pay.magnum, 'Magnum', cat.groceries, null, null, null, 'cleared', now, now);
  // 4. Groceries -12,000₸
  insertTx.run(tx.groceries2, acc.kaspiGold, '2026-02-12', -1200000, pay.miniMarket, 'Мини-маркет', cat.groceries, null, null, null, 'cleared', now, now);
  // 5. Eating out -4,500₸
  insertTx.run(tx.cafe, acc.kaspiGold, '2026-02-10', -450000, pay.brisket, 'Кофейня Brisket', cat.cafe, null, null, 'Обед', 'cleared', now, now);
  // 6. Transfer OUT Kaspi Gold → Halyk -150,000₸
  insertTx.run(tx.transferOut, acc.kaspiGold, '2026-02-07', -15000000, null, 'Transfer: Halyk Текущий', null, acc.halyk, tx.transferIn, 'Перевод на Halyk', 'cleared', now, now);
  // 7. Transfer IN Halyk ← Kaspi Gold +150,000₸
  insertTx.run(tx.transferIn, acc.halyk, '2026-02-07', 15000000, null, 'Transfer: Kaspi Gold', null, acc.kaspiGold, tx.transferOut, 'Перевод с Kaspi Gold', 'cleared', now, now);
  // 8. Loan payment -85,000₸
  insertTx.run(tx.loan, acc.halyk, '2026-02-15', -8500000, pay.halykBank, 'Halyk Bank', cat.halykCredit, null, null, 'Ежемесячный платёж', 'cleared', now, now);
  // 9. Glovo -5,000₸ (credit card, uncleared)
  insertTx.run(tx.glovo, acc.kaspiRed, '2026-02-14', -500000, pay.glovo, 'Glovo', cat.cafe, null, null, 'Доставка еды', 'uncleared', now, now);

  // Monthly budgets (2026-02): total 585,000₸ = 58,500,000 tiyns
  const insertBudget = sqlite.prepare(`
    INSERT INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
    VALUES (?, ?, '2026-02', ?, ?, ?)
  `);
  // Постоянные: 170,000₸
  insertBudget.run('mb-rent', cat.rent, 15000000, now, now);           // 150,000₸
  insertBudget.run('mb-utilities', cat.utilities, 1500000, now, now);  // 15,000₸
  insertBudget.run('mb-internet', cat.internet, 500000, now, now);     // 5,000₸
  // Переменные: 165,000₸
  insertBudget.run('mb-groceries', cat.groceries, 8000000, now, now);      // 80,000₸
  insertBudget.run('mb-transport', cat.transport, 3000000, now, now);      // 30,000₸
  insertBudget.run('mb-cafe', cat.cafe, 2000000, now, now);               // 20,000₸
  insertBudget.run('mb-entertainment', cat.entertainment, 1500000, now, now); // 15,000₸
  insertBudget.run('mb-clothing', cat.clothing, 2000000, now, now);        // 20,000₸
  // Долги: 160,000₸
  insertBudget.run('mb-kaspi-red', cat.kaspiRedIphone, 7500000, now, now); // 75,000₸
  insertBudget.run('mb-halyk-credit', cat.halykCredit, 8500000, now, now); // 85,000₸
  // Накопления: 90,000₸
  insertBudget.run('mb-emergency', cat.emergency, 5000000, now, now);      // 50,000₸
  insertBudget.run('mb-vacation', cat.vacation, 4000000, now, now);        // 40,000₸

  return db;
}

// --- Tests ---

describe('getBudgetMonth', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  it('computes ready to assign = -8,500,000 (over-assigned)', () => {
    const budget = getBudgetMonth(db, '2026-02');
    // Income 50,000,000 - Assigned 58,500,000 = -8,500,000
    expect(budget.readyToAssignCents).toBe(-8500000);
  });

  it('returns 12 non-system categories', () => {
    const budget = getBudgetMonth(db, '2026-02');
    expect(budget.categoryBudgets).toHaveLength(12);
  });

  it('computes groceries activity = -2,050,000', () => {
    const budget = getBudgetMonth(db, '2026-02');
    const groceries = budget.categoryBudgets.find(c => c.categoryId === cat.groceries);
    // -850,000 + -1,200,000 = -2,050,000
    expect(groceries?.activityCents).toBe(-2050000);
  });

  it('computes cafe activity = -950,000 (incl. credit card)', () => {
    const budget = getBudgetMonth(db, '2026-02');
    const cafe = budget.categoryBudgets.find(c => c.categoryId === cat.cafe);
    // -450,000 (Brisket on Kaspi Gold) + -500,000 (Glovo on Kaspi Red) = -950,000
    expect(cafe?.activityCents).toBe(-950000);
  });

  it('computes rent available = 0', () => {
    const budget = getBudgetMonth(db, '2026-02');
    const rent = budget.categoryBudgets.find(c => c.categoryId === cat.rent);
    // Assigned 15,000,000 + Activity -15,000,000 = 0
    expect(rent?.availableCents).toBe(0);
  });

  it('excludes transfers from category activity', () => {
    const budget = getBudgetMonth(db, '2026-02');
    // Total activity = rent -15M + groceries -2.05M + cafe -0.95M + halyk credit -8.5M = -26.5M
    expect(budget.totalActivityCents).toBe(-26500000);
  });
});

describe('assignToCategory', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  it('creates a new monthly budget entry', () => {
    // Assign 10,000₸ to transport in 2026-03 (doesn't exist yet)
    assignToCategory(db, cat.transport, '2026-03', 1000000);
    const budget = getBudgetMonth(db, '2026-03');
    const transport = budget.categoryBudgets.find(c => c.categoryId === cat.transport);
    expect(transport?.assignedCents).toBe(1000000);
  });

  it('updates existing monthly budget (upsert)', () => {
    // Update transport 2026-03 from 10,000₸ to 20,000₸
    assignToCategory(db, cat.transport, '2026-03', 2000000);
    const budget = getBudgetMonth(db, '2026-03');
    const transport = budget.categoryBudgets.find(c => c.categoryId === cat.transport);
    expect(transport?.assignedCents).toBe(2000000);
  });

  it('throws for system category', () => {
    expect(() => assignToCategory(db, cat.readyToAssign, '2026-02', 1000000))
      .toThrow('Cannot assign to system category');
  });

  it('throws for negative amount', () => {
    expect(() => assignToCategory(db, cat.groceries, '2026-02', -1000))
      .toThrow('Amount must be non-negative');
  });

  it('throws for non-existent category', () => {
    expect(() => assignToCategory(db, 'nonexistent', '2026-02', 1000))
      .toThrow('Category not found');
  });
});

describe('moveBetweenCategories', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  it('adjusts both category assigned values', () => {
    // Groceries available = 80,000₸ assigned - 20,500₸ spent = 59,500₸ = 5,950,000 tiyns
    // Move 10,000₸ (1,000,000 tiyns) from groceries to cafe
    moveBetweenCategories(db, cat.groceries, cat.cafe, '2026-02', 1000000);

    const budget = getBudgetMonth(db, '2026-02');
    const groceries = budget.categoryBudgets.find(c => c.categoryId === cat.groceries);
    const cafe = budget.categoryBudgets.find(c => c.categoryId === cat.cafe);

    // Groceries: was 8,000,000, moved out 1,000,000 → 7,000,000
    expect(groceries?.assignedCents).toBe(7000000);
    // Cafe: was 2,000,000, moved in 1,000,000 → 3,000,000
    expect(cafe?.assignedCents).toBe(3000000);
  });

  it('throws when insufficient available', () => {
    // Rent: available = 0 (assigned 15M, spent 15M)
    expect(() => moveBetweenCategories(db, cat.rent, cat.cafe, '2026-02', 1000000))
      .toThrow('Insufficient available');
  });
});

describe('getAccountBalances', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  it('computes Kaspi Gold balance = 17,500,000', () => {
    const balances = getAccountBalances(db);
    const kaspi = balances.find(a => a.accountId === acc.kaspiGold);
    // +50M -15M -0.85M -1.2M -0.45M -15M = 17.5M
    expect(kaspi?.balanceCents).toBe(17500000);
  });

  it('computes Kaspi Red: cleared=0, uncleared=-500,000, balance=-500,000', () => {
    const balances = getAccountBalances(db);
    const kaspiRed = balances.find(a => a.accountId === acc.kaspiRed);
    expect(kaspiRed?.clearedCents).toBe(0);
    expect(kaspiRed?.unclearedCents).toBe(-500000);
    expect(kaspiRed?.balanceCents).toBe(-500000);
  });

  it('computes Cash balance = 0', () => {
    const balances = getAccountBalances(db);
    const cash = balances.find(a => a.accountId === acc.cash);
    expect(cash?.balanceCents).toBe(0);
  });

  it('computes Halyk balance = 6,500,000', () => {
    const balances = getAccountBalances(db);
    const halyk = balances.find(a => a.accountId === acc.halyk);
    // +15M -8.5M = 6.5M
    expect(halyk?.balanceCents).toBe(6500000);
  });
});

describe('getReadyToAssign', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();
  });

  it('returns breakdown with isOverAssigned = true', () => {
    const result = getReadyToAssign(db, '2026-02');
    expect(result.totalInflowCents).toBe(50000000);
    expect(result.totalAssignedCents).toBe(58500000);
    expect(result.readyToAssignCents).toBe(-8500000);
    expect(result.isOverAssigned).toBe(true);
  });
});

describe('getReadyToAssignRange', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();

    // Add March assignment: 20,000,000 (200K₸) to rent
    const sqlite = db.$client;
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
      VALUES (?, ?, '2026-03', ?, ?, ?)
    `).run('mb-rent-mar', cat.rent, 20000000, now, now);
  });

  it('returns per-month RTA with minMonth pointing to month with least headroom', () => {
    const result = getReadyToAssignRange(db, '2026-02', '2026-03');

    expect(result.months).toHaveLength(2);
    expect(result.months[0].month).toBe('2026-02');
    expect(result.months[1].month).toBe('2026-03');

    // Feb RTA: 50M inflow - 58.5M assigned = -8.5M
    expect(result.months[0].readyToAssignCents).toBe(-8500000);
    // Mar RTA: 50M inflow - 58.5M (Feb) - 20M (Mar) = -28.5M
    expect(result.months[1].readyToAssignCents).toBe(-28500000);

    // Min should be March since it has more assigned
    expect(result.minMonth).toBe('2026-03');
    expect(result.minReadyToAssignCents).toBe(-28500000);
  });

  it('returns single month when from == to', () => {
    const result = getReadyToAssignRange(db, '2026-02', '2026-02');
    expect(result.months).toHaveLength(1);
    expect(result.minMonth).toBe('2026-02');
  });
});

describe('multi-month rollover', () => {
  let db: DB;

  beforeAll(() => {
    db = createAndSeedDb();

    // Add January assignment: 5,000₸ to entertainment
    const sqlite = db.$client;
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
      VALUES (?, ?, '2026-01', ?, ?, ?)
    `).run('mb-ent-jan', cat.entertainment, 500000, now, now);
  });

  it('January assignment carries to February available', () => {
    const budget = getBudgetMonth(db, '2026-02');
    const entertainment = budget.categoryBudgets.find(c => c.categoryId === cat.entertainment);
    // Jan assigned 500,000 + Feb assigned 1,500,000 + no activity = 2,000,000
    expect(entertainment?.availableCents).toBe(2000000);
  });
});
