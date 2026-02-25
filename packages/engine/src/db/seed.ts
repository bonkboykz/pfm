import Database from 'better-sqlite3';

const DB_PATH = process.env.PFM_DB_PATH ?? './data/pfm.db';
const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');

const now = new Date().toISOString();

// Fixed deterministic IDs — re-runs target the exact same rows
const accountIds = {
  kaspiGold: 'seed_acc_kaspi_gold',
  halyk: 'seed_acc_halyk',
  kaspiRed: 'seed_acc_kaspi_red',
  cash: 'seed_acc_cash',
};

const groupIds = {
  inflow: 'inflow-group', // system — already exists
  fixed: 'seed_grp_fixed',
  variable: 'seed_grp_variable',
  debt: 'seed_grp_debt',
  savings: 'seed_grp_savings',
};

const categoryIds = {
  readyToAssign: 'ready-to-assign', // system — already exists
  rent: 'seed_cat_rent',
  utilities: 'seed_cat_utilities',
  internet: 'seed_cat_internet',
  groceries: 'seed_cat_groceries',
  transport: 'seed_cat_transport',
  cafe: 'seed_cat_cafe',
  entertainment: 'seed_cat_entertainment',
  clothing: 'seed_cat_clothing',
  kaspiRedIphone: 'seed_cat_kaspi_red_iphone',
  halykCredit: 'seed_cat_halyk_credit',
  emergency: 'seed_cat_emergency',
  vacation: 'seed_cat_vacation',
};

const payeeIds = {
  employer: 'seed_pay_employer',
  landlord: 'seed_pay_landlord',
  magnum: 'seed_pay_magnum',
  miniMarket: 'seed_pay_mini_market',
  brisket: 'seed_pay_brisket',
  glovo: 'seed_pay_glovo',
  halykBank: 'seed_pay_halyk_bank',
};

const txIds = {
  salary: 'seed_tx_salary',
  rent: 'seed_tx_rent',
  groceries1: 'seed_tx_groceries1',
  groceries2: 'seed_tx_groceries2',
  cafe: 'seed_tx_cafe',
  transferOut: 'seed_tx_transfer_out',
  transferIn: 'seed_tx_transfer_in',
  loan: 'seed_tx_loan',
  glovo: 'seed_tx_glovo',
};

const mbIds = {
  rent: 'seed_mb_rent',
  utilities: 'seed_mb_utilities',
  internet: 'seed_mb_internet',
  groceries: 'seed_mb_groceries',
  transport: 'seed_mb_transport',
  cafe: 'seed_mb_cafe',
  entertainment: 'seed_mb_entertainment',
  clothing: 'seed_mb_clothing',
  kaspiRedIphone: 'seed_mb_kaspi_red_iphone',
  halykCredit: 'seed_mb_halyk_credit',
  emergency: 'seed_mb_emergency',
  vacation: 'seed_mb_vacation',
};

// --- ACCOUNTS ---
const insertAccount = sqlite.prepare(`
  INSERT OR IGNORE INTO accounts (id, name, type, on_budget, currency, sort_order, is_active, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'KZT', ?, 1, ?, ?)
`);

const seedAccounts = sqlite.transaction(() => {
  insertAccount.run(accountIds.kaspiGold, 'Kaspi Gold', 'checking', 1, 0, now, now);
  insertAccount.run(accountIds.halyk, 'Halyk Текущий', 'checking', 1, 1, now, now);
  insertAccount.run(accountIds.kaspiRed, 'Kaspi Red', 'credit_card', 1, 2, now, now);
  insertAccount.run(accountIds.cash, 'Наличные', 'cash', 1, 3, now, now);
});

seedAccounts();

// --- CATEGORY GROUPS ---
const insertGroup = sqlite.prepare(`
  INSERT OR IGNORE INTO category_groups (id, name, is_system, sort_order, is_hidden, created_at)
  VALUES (?, ?, ?, ?, 0, ?)
`);

const seedGroups = sqlite.transaction(() => {
  insertGroup.run(groupIds.fixed, 'Постоянные', 0, 1, now);
  insertGroup.run(groupIds.variable, 'Переменные', 0, 2, now);
  insertGroup.run(groupIds.debt, 'Долги', 0, 3, now);
  insertGroup.run(groupIds.savings, 'Накопления', 0, 4, now);
});

seedGroups();

// --- CATEGORIES ---
const insertCategory = sqlite.prepare(`
  INSERT OR IGNORE INTO categories (id, group_id, name, is_system, sort_order, is_hidden, created_at)
  VALUES (?, ?, ?, ?, ?, 0, ?)
`);

const seedCategories = sqlite.transaction(() => {
  // Постоянные
  insertCategory.run(categoryIds.rent, groupIds.fixed, 'Аренда', 0, 0, now);
  insertCategory.run(categoryIds.utilities, groupIds.fixed, 'Коммунальные', 0, 1, now);
  insertCategory.run(categoryIds.internet, groupIds.fixed, 'Интернет', 0, 2, now);

  // Переменные
  insertCategory.run(categoryIds.groceries, groupIds.variable, 'Продукты', 0, 0, now);
  insertCategory.run(categoryIds.transport, groupIds.variable, 'Транспорт', 0, 1, now);
  insertCategory.run(categoryIds.cafe, groupIds.variable, 'Кафе', 0, 2, now);
  insertCategory.run(categoryIds.entertainment, groupIds.variable, 'Развлечения', 0, 3, now);
  insertCategory.run(categoryIds.clothing, groupIds.variable, 'Одежда', 0, 4, now);

  // Долги
  insertCategory.run(categoryIds.kaspiRedIphone, groupIds.debt, 'Kaspi Red iPhone', 0, 0, now);
  insertCategory.run(categoryIds.halykCredit, groupIds.debt, 'Халық кредит', 0, 1, now);

  // Накопления
  insertCategory.run(categoryIds.emergency, groupIds.savings, 'Подушка безопасности', 0, 0, now);
  insertCategory.run(categoryIds.vacation, groupIds.savings, 'Отпуск', 0, 1, now);
});

seedCategories();

// --- PAYEES ---
const insertPayee = sqlite.prepare(`
  INSERT OR IGNORE INTO payees (id, name, last_category_id, created_at)
  VALUES (?, ?, ?, ?)
`);

const seedPayees = sqlite.transaction(() => {
  insertPayee.run(payeeIds.employer, 'ТОО Работодатель', categoryIds.readyToAssign, now);
  insertPayee.run(payeeIds.landlord, 'Арендодатель', categoryIds.rent, now);
  insertPayee.run(payeeIds.magnum, 'Magnum', categoryIds.groceries, now);
  insertPayee.run(payeeIds.miniMarket, 'Мини-маркет', categoryIds.groceries, now);
  insertPayee.run(payeeIds.brisket, 'Кофейня Brisket', categoryIds.cafe, now);
  insertPayee.run(payeeIds.glovo, 'Glovo', categoryIds.cafe, now);
  insertPayee.run(payeeIds.halykBank, 'Halyk Bank', categoryIds.halykCredit, now);
});

seedPayees();

// --- TRANSACTIONS ---
// All amounts in tiyns (1₸ = 100 tiyns)
const insertTx = sqlite.prepare(`
  INSERT OR IGNORE INTO transactions (id, account_id, date, amount_cents, payee_id, payee_name, category_id, transfer_account_id, transfer_transaction_id, memo, cleared, approved, is_deleted, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
`);

const seedTransactions = sqlite.transaction(() => {
  // 1. Salary +500,000₸ = +50,000,000 tiyns
  insertTx.run(txIds.salary, accountIds.kaspiGold, '2026-02-05', 50000000, payeeIds.employer, 'ТОО Работодатель', categoryIds.readyToAssign, null, null, 'Зарплата за февраль', 'cleared', now, now);

  // 2. Rent -150,000₸ = -15,000,000 tiyns
  insertTx.run(txIds.rent, accountIds.kaspiGold, '2026-02-06', -15000000, payeeIds.landlord, 'Арендодатель', categoryIds.rent, null, null, 'Аренда квартиры', 'cleared', now, now);

  // 3. Groceries -8,500₸ = -850,000 tiyns
  insertTx.run(txIds.groceries1, accountIds.kaspiGold, '2026-02-08', -850000, payeeIds.magnum, 'Magnum', categoryIds.groceries, null, null, null, 'cleared', now, now);

  // 4. Groceries -12,000₸ = -1,200,000 tiyns
  insertTx.run(txIds.groceries2, accountIds.kaspiGold, '2026-02-12', -1200000, payeeIds.miniMarket, 'Мини-маркет', categoryIds.groceries, null, null, null, 'cleared', now, now);

  // 5. Eating out -4,500₸ = -450,000 tiyns
  insertTx.run(txIds.cafe, accountIds.kaspiGold, '2026-02-10', -450000, payeeIds.brisket, 'Кофейня Brisket', categoryIds.cafe, null, null, 'Обед', 'cleared', now, now);

  // 6. Transfer OUT from Kaspi Gold -150,000₸ = -15,000,000 tiyns
  insertTx.run(txIds.transferOut, accountIds.kaspiGold, '2026-02-07', -15000000, null, 'Transfer: Halyk Текущий', null, accountIds.halyk, txIds.transferIn, 'Перевод на Halyk', 'cleared', now, now);

  // 7. Transfer IN to Halyk +150,000₸ = +15,000,000 tiyns
  insertTx.run(txIds.transferIn, accountIds.halyk, '2026-02-07', 15000000, null, 'Transfer: Kaspi Gold', null, accountIds.kaspiGold, txIds.transferOut, 'Перевод с Kaspi Gold', 'cleared', now, now);

  // 8. Loan payment -85,000₸ = -8,500,000 tiyns
  insertTx.run(txIds.loan, accountIds.halyk, '2026-02-15', -8500000, payeeIds.halykBank, 'Halyk Bank', categoryIds.halykCredit, null, null, 'Ежемесячный платёж', 'cleared', now, now);

  // 9. Glovo -5,000₸ = -500,000 tiyns (credit card)
  insertTx.run(txIds.glovo, accountIds.kaspiRed, '2026-02-14', -500000, payeeIds.glovo, 'Glovo', categoryIds.cafe, null, null, 'Доставка еды', 'uncleared', now, now);
});

seedTransactions();

// --- MONTHLY BUDGETS ---
// 2026-02: total 585,000₸ = 58,500,000 tiyns (over-assigned by 85,000₸)
const insertBudget = sqlite.prepare(`
  INSERT OR IGNORE INTO monthly_budgets (id, category_id, month, assigned_cents, created_at, updated_at)
  VALUES (?, ?, '2026-02', ?, ?, ?)
`);

const seedBudgets = sqlite.transaction(() => {
  // Постоянные: 170,000₸
  insertBudget.run(mbIds.rent, categoryIds.rent, 15000000, now, now);          // 150,000₸
  insertBudget.run(mbIds.utilities, categoryIds.utilities, 1500000, now, now);      // 15,000₸
  insertBudget.run(mbIds.internet, categoryIds.internet, 500000, now, now);        // 5,000₸

  // Переменные: 165,000₸
  insertBudget.run(mbIds.groceries, categoryIds.groceries, 8000000, now, now);      // 80,000₸
  insertBudget.run(mbIds.transport, categoryIds.transport, 3000000, now, now);      // 30,000₸
  insertBudget.run(mbIds.cafe, categoryIds.cafe, 2000000, now, now);           // 20,000₸
  insertBudget.run(mbIds.entertainment, categoryIds.entertainment, 1500000, now, now);  // 15,000₸
  insertBudget.run(mbIds.clothing, categoryIds.clothing, 2000000, now, now);       // 20,000₸

  // Долги: 160,000₸
  insertBudget.run(mbIds.kaspiRedIphone, categoryIds.kaspiRedIphone, 7500000, now, now); // 75,000₸
  insertBudget.run(mbIds.halykCredit, categoryIds.halykCredit, 8500000, now, now);    // 85,000₸

  // Накопления: 90,000₸
  insertBudget.run(mbIds.emergency, categoryIds.emergency, 5000000, now, now);      // 50,000₸
  insertBudget.run(mbIds.vacation, categoryIds.vacation, 4000000, now, now);       // 40,000₸
});

seedBudgets();

// --- SCHEDULED TRANSACTIONS ---
const schedIds = {
  salary: 'seed_sched_salary',
  rent: 'seed_sched_rent',
  internet: 'seed_sched_internet',
  kaspiRed: 'seed_sched_kaspi_red',
  halykCredit: 'seed_sched_halyk_credit',
};

const insertSched = sqlite.prepare(`
  INSERT OR IGNORE INTO scheduled_transactions (id, account_id, frequency, next_date, amount_cents, payee_name, category_id, transfer_account_id, memo, is_active, created_at, updated_at)
  VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);

const seedScheduled = sqlite.transaction(() => {
  // 1. Salary +500,000₸ on 1st
  insertSched.run(schedIds.salary, accountIds.kaspiGold, '2026-03-01', 50000000, 'ТОО Работодатель', categoryIds.readyToAssign, null, 'Зарплата', now, now);
  // 2. Rent -150,000₸ on 5th
  insertSched.run(schedIds.rent, accountIds.kaspiGold, '2026-03-05', -15000000, 'Арендодатель', categoryIds.rent, null, 'Аренда квартиры', now, now);
  // 3. Internet -5,000₸ on 15th
  insertSched.run(schedIds.internet, accountIds.kaspiGold, '2026-03-15', -500000, 'Интернет-провайдер', categoryIds.internet, null, 'Интернет', now, now);
  // 4. Kaspi Red transfer -150,000₸ on 20th
  insertSched.run(schedIds.kaspiRed, accountIds.kaspiGold, '2026-03-20', -15000000, null, null, accountIds.kaspiRed, 'Погашение Kaspi Red', now, now);
  // 5. Халық кредит -85,000₸ on 25th
  insertSched.run(schedIds.halykCredit, accountIds.halyk, '2026-03-25', -8500000, 'Halyk Bank', categoryIds.halykCredit, null, 'Ежемесячный платёж', now, now);
});

seedScheduled();

sqlite.close();

// Summary
const totalIncome = 50000000;
const totalAssigned = 15000000 + 1500000 + 500000 + 8000000 + 3000000 + 2000000 + 1500000 + 2000000 + 7500000 + 8500000 + 5000000 + 4000000;
const readyToAssign = totalIncome - totalAssigned;

console.log('Seed complete!');
console.log('');
console.log('Accounts:     4  (Kaspi Gold, Halyk Текущий, Kaspi Red, Наличные)');
console.log('Groups:       5  (Inflow + 4 user groups)');
console.log('Categories:  13  (Ready to Assign + 12 user categories)');
console.log('Payees:       7');
console.log('Transactions: 9  (1 salary, 5 expenses, 2 transfer pair, 1 credit card)');
console.log('Budgets:     12  (all for 2026-02)');
console.log('Scheduled:    5  (salary, rent, internet, Kaspi Red transfer, Халық кредит)');
console.log('');
console.log(`Income:       ${(totalIncome / 100).toLocaleString('ru-RU')} ₸`);
console.log(`Assigned:     ${(totalAssigned / 100).toLocaleString('ru-RU')} ₸`);
console.log(`Ready to Assign: ${(readyToAssign / 100).toLocaleString('ru-RU')} ₸`);
console.log(`Over-assigned by ${(Math.abs(readyToAssign) / 100).toLocaleString('ru-RU')} ₸ (intentional)`);
