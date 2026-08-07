import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeDatabase } from './ddl.js';

const DB_PATH = process.env.PFM_DB_PATH ?? './data/pfm.db';

mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

initializeDatabase(sqlite);

sqlite.close();

console.log('Migration complete. Database created at', DB_PATH);
console.log('System records:');
console.log('  - Category group "Inflow" (id: inflow-group)');
console.log('  - Category "Ready to Assign" (id: ready-to-assign)');
console.log('Tables: accounts, category_groups, categories, payees, transactions, monthly_budgets, scheduled_transactions, loans, deposits, personal_debts, audit_log');
console.log('Audit triggers installed on: transactions, monthly_budgets, loans');
