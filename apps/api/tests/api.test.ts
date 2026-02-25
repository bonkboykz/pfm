import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createDb, type DB } from '@pfm/engine';
import { createApp } from '../src/app.js';
import type { Hono } from 'hono';

// --- Deterministic IDs (same as engine tests) ---

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

const pay = {
  employer: 'pay-employer',
  landlord: 'pay-landlord',
  magnum: 'pay-magnum',
  miniMarket: 'pay-mini-market',
  brisket: 'pay-brisket',
  glovo: 'pay-glovo',
  halykBank: 'pay-halyk-bank',
};

// --- DDL + Seed (same as engine tests) ---

function createAndSeedDb(): DB {
  const db = createDb(':memory:');
  const sqlite = db.$client;

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
      bank_name TEXT,
      last_4_digits TEXT,
      card_type TEXT,
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

    CREATE TABLE IF NOT EXISTS scheduled_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
      next_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      payee_name TEXT,
      category_id TEXT REFERENCES categories(id),
      transfer_account_id TEXT REFERENCES accounts(id),
      memo TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sched_next_date ON scheduled_transactions(next_date);
    CREATE INDEX IF NOT EXISTS idx_sched_active ON scheduled_transactions(is_active);

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('loan', 'installment', 'credit_line')),
      account_id TEXT REFERENCES accounts(id),
      category_id TEXT REFERENCES categories(id),
      principal_cents INTEGER NOT NULL,
      apr_bps INTEGER NOT NULL DEFAULT 0,
      term_months INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      monthly_payment_cents INTEGER NOT NULL,
      payment_day INTEGER NOT NULL,
      penalty_rate_bps INTEGER NOT NULL DEFAULT 0,
      early_repayment_fee_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(is_active);
    CREATE INDEX IF NOT EXISTS idx_loans_category ON loans(category_id);

    CREATE TABLE IF NOT EXISTS personal_debts (
      id TEXT PRIMARY KEY,
      person_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('owe', 'owed')),
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KZT',
      due_date TEXT,
      note TEXT,
      is_settled INTEGER NOT NULL DEFAULT 0,
      settled_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
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
  insertCategory.run(cat.rent, grp.fixed, 'Аренда', 0, now);
  insertCategory.run(cat.utilities, grp.fixed, 'Коммунальные', 1, now);
  insertCategory.run(cat.internet, grp.fixed, 'Интернет', 2, now);
  insertCategory.run(cat.groceries, grp.variable, 'Продукты', 0, now);
  insertCategory.run(cat.transport, grp.variable, 'Транспорт', 1, now);
  insertCategory.run(cat.cafe, grp.variable, 'Кафе', 2, now);
  insertCategory.run(cat.entertainment, grp.variable, 'Развлечения', 3, now);
  insertCategory.run(cat.clothing, grp.variable, 'Одежда', 4, now);
  insertCategory.run(cat.kaspiRedIphone, grp.debt, 'Kaspi Red iPhone', 0, now);
  insertCategory.run(cat.halykCredit, grp.debt, 'Халық кредит', 1, now);
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

  insertTx.run(tx.salary, acc.kaspiGold, '2026-02-05', 50000000, pay.employer, 'ТОО Работодатель', cat.readyToAssign, null, null, 'Зарплата за февраль', 'cleared', now, now);
  insertTx.run(tx.rent, acc.kaspiGold, '2026-02-06', -15000000, pay.landlord, 'Арендодатель', cat.rent, null, null, 'Аренда квартиры', 'cleared', now, now);
  insertTx.run(tx.groceries1, acc.kaspiGold, '2026-02-08', -850000, pay.magnum, 'Magnum', cat.groceries, null, null, null, 'cleared', now, now);
  insertTx.run(tx.groceries2, acc.kaspiGold, '2026-02-12', -1200000, pay.miniMarket, 'Мини-маркет', cat.groceries, null, null, null, 'cleared', now, now);
  insertTx.run(tx.cafe, acc.kaspiGold, '2026-02-10', -450000, pay.brisket, 'Кофейня Brisket', cat.cafe, null, null, 'Обед', 'cleared', now, now);
  insertTx.run(tx.transferOut, acc.kaspiGold, '2026-02-07', -15000000, null, 'Transfer: Halyk Текущий', null, acc.halyk, tx.transferIn, 'Перевод на Halyk', 'cleared', now, now);
  insertTx.run(tx.transferIn, acc.halyk, '2026-02-07', 15000000, null, 'Transfer: Kaspi Gold', null, acc.kaspiGold, tx.transferOut, 'Перевод с Kaspi Gold', 'cleared', now, now);
  insertTx.run(tx.loan, acc.halyk, '2026-02-15', -8500000, pay.halykBank, 'Halyk Bank', cat.halykCredit, null, null, 'Ежемесячный платёж', 'cleared', now, now);
  insertTx.run(tx.glovo, acc.kaspiRed, '2026-02-14', -500000, pay.glovo, 'Glovo', cat.cafe, null, null, 'Доставка еды', 'uncleared', now, now);

  // Monthly budgets (2026-02)
  const insertBudget = sqlite.prepare(`
    INSERT INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
    VALUES (?, ?, '2026-02', ?, ?, ?)
  `);
  insertBudget.run('mb-rent', cat.rent, 15000000, now, now);
  insertBudget.run('mb-utilities', cat.utilities, 1500000, now, now);
  insertBudget.run('mb-internet', cat.internet, 500000, now, now);
  insertBudget.run('mb-groceries', cat.groceries, 8000000, now, now);
  insertBudget.run('mb-transport', cat.transport, 3000000, now, now);
  insertBudget.run('mb-cafe', cat.cafe, 2000000, now, now);
  insertBudget.run('mb-entertainment', cat.entertainment, 1500000, now, now);
  insertBudget.run('mb-clothing', cat.clothing, 2000000, now, now);
  insertBudget.run('mb-kaspi-red', cat.kaspiRedIphone, 7500000, now, now);
  insertBudget.run('mb-halyk-credit', cat.halykCredit, 8500000, now, now);
  insertBudget.run('mb-emergency', cat.emergency, 5000000, now, now);
  insertBudget.run('mb-vacation', cat.vacation, 4000000, now, now);

  return db;
}

// --- Test helpers ---

async function api(app: Hono, method: string, path: string, body?: any) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await app.request(path, init);
  return { status: res.status, data: await res.json() };
}

// --- Tests ---

describe('REST API', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  // 1. Health check
  it('GET /health returns ok', async () => {
    const { status, data } = await api(app, 'GET', '/health');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.version).toBe('0.1.0');
  });

  // 2. List accounts with balances
  it('GET /api/v1/accounts lists 4 accounts with balances', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/accounts');
    expect(status).toBe(200);
    expect(data).toHaveLength(4);
    const kaspi = data.find((a: any) => a.id === acc.kaspiGold);
    expect(kaspi.balanceCents).toBe(17500000);
    expect(kaspi.balanceFormatted).toBe('175 000 ₸');
  });

  // 3. Create account
  it('POST /api/v1/accounts creates account', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/accounts', {
      name: 'Test Savings',
      type: 'savings',
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Test Savings');
    expect(data.onBudget).toBe(true);
  });

  // 4. Get single account
  it('GET /api/v1/accounts/:id returns account with balance', async () => {
    const { status, data } = await api(app, 'GET', `/api/v1/accounts/${acc.kaspiGold}`);
    expect(status).toBe(200);
    expect(data.name).toBe('Kaspi Gold');
    expect(data.balanceCents).toBe(17500000);
    expect(data.balanceFormatted).toBeDefined();
  });

  // 5. Update account
  it('PATCH /api/v1/accounts/:id updates name', async () => {
    const { status, data } = await api(app, 'PATCH', `/api/v1/accounts/${acc.cash}`, {
      name: 'Наличные Updated',
    });
    expect(status).toBe(200);
    expect(data.name).toBe('Наличные Updated');
  });

  // 6. Soft-delete account
  it('DELETE /api/v1/accounts/:id soft deletes', async () => {
    // Create a temporary account to delete
    const { data: created } = await api(app, 'POST', '/api/v1/accounts', {
      name: 'To Delete',
      type: 'checking',
    });
    const { status } = await api(app, 'DELETE', `/api/v1/accounts/${created.id}`);
    expect(status).toBe(200);

    // Verify it's gone from list
    const { data: list } = await api(app, 'GET', '/api/v1/accounts');
    expect(list.find((a: any) => a.id === created.id)).toBeUndefined();
  });

  // 7. List grouped categories
  it('GET /api/v1/categories lists 4 groups with 12 categories', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/categories');
    expect(status).toBe(200);
    expect(data).toHaveLength(4);
    const totalCats = data.reduce((sum: number, g: any) => sum + g.categories.length, 0);
    expect(totalCats).toBe(12);
  });

  // 8. Create category group
  it('POST /api/v1/categories/groups creates group', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/categories/groups', {
      name: 'Новая группа',
    });
    expect(status).toBe(201);
    expect(data.id).toBeDefined();
    expect(data.name).toBe('Новая группа');
  });

  // 9. Create category
  it('POST /api/v1/categories creates category', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/categories', {
      groupId: grp.variable,
      name: 'Спорт',
    });
    expect(status).toBe(201);
    expect(data.groupId).toBe(grp.variable);
  });

  // 10. List transactions filtered
  it('GET /api/v1/transactions?accountId filters by account', async () => {
    const { status, data } = await api(app, 'GET', `/api/v1/transactions?accountId=${acc.kaspiGold}`);
    expect(status).toBe(200);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((t: any) => t.accountId === acc.kaspiGold)).toBe(true);
  });

  // 11. Create transaction with payee auto-create
  it('POST /api/v1/transactions creates transaction', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: acc.kaspiGold,
      date: '2026-02-20',
      amountCents: -300000,
      payeeName: 'New Payee',
      categoryId: cat.groceries,
    });
    expect(status).toBe(201);
    expect(data.payeeName).toBe('New Payee');
    expect(data.payeeId).toBeDefined();
    expect(data.amountFormatted).toBeDefined();
  });

  // 12. Create transfer
  it('POST /api/v1/transactions with transferAccountId creates paired transactions', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: acc.kaspiGold,
      date: '2026-02-20',
      amountCents: -5000000,
      transferAccountId: acc.halyk,
    });
    expect(status).toBe(201);
    expect(data).toHaveLength(2);
    expect(data[0].amountCents).toBe(-5000000);
    expect(data[1].amountCents).toBe(5000000);
    expect(data[0].transferTransactionId).toBe(data[1].id);
    expect(data[1].transferTransactionId).toBe(data[0].id);
    expect(data[0].categoryId).toBeNull();
    expect(data[1].categoryId).toBeNull();
  });

  // 13. Delete transaction + paired
  it('DELETE /api/v1/transactions/:id soft-deletes both paired transactions', async () => {
    // Create a transfer first
    const { data: transfer } = await api(app, 'POST', '/api/v1/transactions', {
      accountId: acc.kaspiGold,
      date: '2026-02-21',
      amountCents: -1000000,
      transferAccountId: acc.cash,
    });
    const tx1Id = transfer[0].id;
    const tx2Id = transfer[1].id;

    const { status } = await api(app, 'DELETE', `/api/v1/transactions/${tx1Id}`);
    expect(status).toBe(200);

    // Both should be not found now
    const { status: s1 } = await api(app, 'GET', `/api/v1/transactions/${tx1Id}`);
    const { status: s2 } = await api(app, 'GET', `/api/v1/transactions/${tx2Id}`);
    expect(s1).toBe(404);
    expect(s2).toBe(404);
  });

  // 14. Get budget month
  it('GET /api/v1/budget/2026-02 returns grouped budget', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/budget/2026-02');
    expect(status).toBe(200);
    expect(data.month).toBe('2026-02');
    expect(data.readyToAssignCents).toBeLessThan(0);
    expect(data.readyToAssignFormatted).toBeDefined();
    expect(data.groups.length).toBeGreaterThanOrEqual(4);
    // Check grouping structure
    const fixedGroup = data.groups.find((g: any) => g.groupId === grp.fixed);
    expect(fixedGroup).toBeDefined();
    expect(fixedGroup.categories.length).toBe(3);
  });

  // 15. Assign to category
  it('POST /api/v1/budget/2026-02/assign updates budget', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-02/assign', {
      categoryId: cat.transport,
      amountCents: 5000000,
    });
    expect(status).toBe(200);
    const transport = data.groups
      .flatMap((g: any) => g.categories)
      .find((c: any) => c.categoryId === cat.transport);
    expect(transport.assignedCents).toBe(5000000);
  });

  // 16. Move between categories
  it('POST /api/v1/budget/2026-02/move adjusts both', async () => {
    // First check groceries available > 0
    const { data: before } = await api(app, 'GET', '/api/v1/budget/2026-02');
    const groceriesBefore = before.groups
      .flatMap((g: any) => g.categories)
      .find((c: any) => c.categoryId === cat.groceries);

    // Move 500,000 from groceries to clothing
    const moveAmount = 500000;
    if (groceriesBefore.availableCents >= moveAmount) {
      const { status, data } = await api(app, 'POST', '/api/v1/budget/2026-02/move', {
        fromCategoryId: cat.groceries,
        toCategoryId: cat.clothing,
        amountCents: moveAmount,
      });
      expect(status).toBe(200);

      const groceriesAfter = data.groups
        .flatMap((g: any) => g.categories)
        .find((c: any) => c.categoryId === cat.groceries);
      const clothingAfter = data.groups
        .flatMap((g: any) => g.categories)
        .find((c: any) => c.categoryId === cat.clothing);

      expect(groceriesAfter.assignedCents).toBe(groceriesBefore.assignedCents - moveAmount);
      expect(clothingAfter.assignedCents).toBeGreaterThan(0);
    }
  });

  // 17a. RTA overview
  it('GET /api/v1/budget/rta-overview returns per-month RTA with min', async () => {
    // First assign something to March so we have multi-month coverage
    await api(app, 'POST', '/api/v1/budget/2026-03/assign', {
      categoryId: cat.rent,
      amountCents: 15000000,
    });

    const { status, data } = await api(app, 'GET', '/api/v1/budget/rta-overview?from=2026-02');
    expect(status).toBe(200);
    expect(data.from).toBe('2026-02');
    expect(data.to).toBe('2026-03');
    expect(data.months).toHaveLength(2);
    expect(data.months[0].month).toBe('2026-02');
    expect(data.months[1].month).toBe('2026-03');
    expect(data.months[0].readyToAssignFormatted).toBeDefined();
    expect(data.minReadyToAssignCents).toBeDefined();
    expect(data.minReadyToAssignFormatted).toBeDefined();
    expect(data.minMonth).toBeDefined();
    // March RTA should be lower than Feb (more assigned)
    expect(data.months[1].readyToAssignCents).toBeLessThan(data.months[0].readyToAssignCents);
    expect(data.minMonth).toBe('2026-03');
  });

  // 17. Ready to assign breakdown
  it('GET /api/v1/budget/2026-02/ready-to-assign returns breakdown', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/budget/2026-02/ready-to-assign');
    expect(status).toBe(200);
    expect(data.totalInflowCents).toBeDefined();
    expect(data.totalAssignedCents).toBeDefined();
    expect(data.readyToAssignCents).toBeDefined();
    expect(data.isOverAssigned).toBe(true);
    expect(data.readyToAssignFormatted).toBeDefined();
  });

  // 18. 404 on missing account
  it('GET /api/v1/accounts/nonexistent returns 404', async () => {
    const { status, data } = await api(app, 'GET', '/api/v1/accounts/nonexistent');
    expect(status).toBe(404);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('NOT_FOUND');
  });

  // 19. Validation error
  it('POST /api/v1/accounts with empty body returns 400', async () => {
    const { status, data } = await api(app, 'POST', '/api/v1/accounts', {});
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Authentication', () => {
  let app: Hono;

  beforeAll(() => {
    const db = createAndSeedDb();
    app = createApp(db);
  });

  afterEach(() => {
    delete process.env.PFM_API_KEY;
  });

  it('/health is accessible without auth', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('rejects /api/v1/* without auth when key is set', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts');
    expect(res.status).toBe(401);
    const data = await res.json() as any;
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('accepts valid Bearer token', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts', {
      headers: { 'Authorization': 'Bearer test-key-123' },
    });
    expect(res.status).toBe(200);
  });

  it('rejects wrong key', async () => {
    process.env.PFM_API_KEY = 'test-key-123';
    const res = await app.request('/api/v1/accounts', {
      headers: { 'Authorization': 'Bearer wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('allows everything when PFM_API_KEY not set', async () => {
    delete process.env.PFM_API_KEY;
    const res = await app.request('/api/v1/accounts');
    expect(res.status).toBe(200);
  });
});
