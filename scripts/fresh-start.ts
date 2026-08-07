#!/usr/bin/env tsx
/**
 * Replaces the whole transaction history with one reconciliation entry per
 * account, so the books start from today's real balances.
 *
 * Reports only by default; --confirm is required to write, and writing takes a
 * backup of the database file first. Everything happens in one transaction, so
 * a failure part-way leaves the database exactly as it was — which is the
 * reason to do this here rather than as a hundred API calls.
 *
 *   pnpm tsx scripts/fresh-start.ts                            # report
 *   pnpm tsx scripts/fresh-start.ts --confirm                  # apply
 *   pnpm tsx scripts/fresh-start.ts --confirm --keep-budget    # leave assignments alone
 *   pnpm tsx scripts/fresh-start.ts --confirm --date=2026-08-07
 *
 * Balances are not supplied by hand. Each account is reconciled to the balance
 * it already computes to, which makes the operation provably balance-preserving:
 * it erases how the money got there, never how much there is.
 *
 * Transactions are soft-deleted (is_deleted = 1), matching the rest of the
 * codebase — the rows survive in the table and in the audit journal.
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { createId } from '@paralleldrive/cuid2';

const DB_PATH = process.env.PFM_DB_PATH ?? './data/pfm.db';
const CONFIRM = process.argv.includes('--confirm');
const KEEP_BUDGET = process.argv.includes('--keep-budget');
const DATE = process.argv.find((a) => a.startsWith('--date='))?.slice(7)
  ?? new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`--date must be YYYY-MM-DD, got '${DATE}'`);
  process.exit(1);
}

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set PFM_DB_PATH.`);
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');

const hasSchema = sqlite.prepare(
  `SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'transactions'`
).get() as { n: number };
if (!hasSchema.n) {
  console.error(`${DB_PATH} has no PFM schema — wrong path, or migrations have not run.`);
  process.exit(1);
}

const fmt = (cents: number, cur = 'KZT') =>
  `${(cents / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === 'KZT' ? '₸' : cur}`;

interface AcctRow {
  id: string; name: string; currency: string; on_budget: number; is_active: number; balance: number; tx_count: number;
}

const accounts = sqlite.prepare(`
  SELECT a.id, a.name, a.currency, a.on_budget, a.is_active,
    COALESCE(SUM(CASE WHEN t.is_deleted = 0 THEN t.amount_cents ELSE 0 END), 0) as balance,
    COALESCE(SUM(CASE WHEN t.is_deleted = 0 THEN 1 ELSE 0 END), 0) as tx_count
  FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
  GROUP BY a.id ORDER BY a.sort_order
`).all() as AcctRow[];

const liveTx = sqlite.prepare(
  `SELECT COUNT(*) as n FROM transactions WHERE is_deleted = 0`
).get() as { n: number };

const byMonth = sqlite.prepare(`
  SELECT substr(date, 1, 7) as month, COUNT(*) as n FROM transactions
  WHERE is_deleted = 0 GROUP BY month ORDER BY month
`).all() as Array<{ month: string; n: number }>;

const assigned = sqlite.prepare(
  `SELECT COUNT(*) as rows, COALESCE(SUM(assigned_cents), 0) as total FROM monthly_budgets`
).get() as { rows: number; total: number };

console.log(`PFM fresh start — ${DB_PATH}`);
console.log(CONFIRM ? 'MODE: apply (writes)' : 'MODE: report only (use --confirm to write)');
console.log(`reconciliation date: ${DATE}`);

console.log(`\nlive transactions: ${liveTx.n}`);
console.log(`  ${byMonth.map((m) => `${m.month}: ${m.n}`).join(', ')}`);
console.log(`assignments: ${assigned.rows} row(s), ${fmt(assigned.total)} — ${KEEP_BUDGET ? 'KEPT' : 'will be cleared'}`);

console.log(`\nbalances that will be preserved:`);
let total = 0;
const toWrite = accounts.filter((a) => a.balance !== 0);
for (const a of accounts) {
  if (a.currency === 'KZT') total += a.balance;
  const note = a.balance === 0 ? 'no entry written' : 'one adjustment';
  console.log(`  ${a.is_active ? 'active  ' : 'inactive'} ${a.on_budget ? 'on ' : 'off'} ${fmt(a.balance, a.currency).padStart(16)}  ${a.name.padEnd(22)} ${a.tx_count} tx → ${note}`);
}
console.log(`\ntotal (KZT accounts): ${fmt(total)}`);
console.log(`entries to write: ${toWrite.length}`);

// Foreign-currency balances are held in that currency's minor unit and cannot
// be added to a tenge total; flag rather than silently mixing them in.
const foreign = accounts.filter((a) => a.currency !== 'KZT' && a.balance !== 0);
if (foreign.length) {
  console.log(`\nnot included in the total (different currency):`);
  for (const a of foreign) console.log(`  ${a.name}: ${fmt(a.balance, a.currency)}`);
}

if (!CONFIRM) {
  console.log('\nnothing written — re-run with --confirm');
  sqlite.close();
  process.exit(0);
}

const backup = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(DB_PATH, backup);
console.log(`\nbackup: ${backup}`);

const auditMark = (
  sqlite.prepare(`SELECT COALESCE(MAX(rowid), 0) as mark FROM audit_log`).get() as { mark: number }
).mark;

const now = new Date().toISOString();
let written = 0;

sqlite.transaction(() => {
  sqlite.prepare(`UPDATE transactions SET is_deleted = 1, updated_at = ? WHERE is_deleted = 0`).run(now);

  if (!KEEP_BUDGET) sqlite.prepare(`DELETE FROM monthly_budgets`).run();

  const insert = sqlite.prepare(`
    INSERT INTO transactions
      (id, account_id, date, amount_cents, payee_name, category_id, memo,
       cleared, approved, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Начальный остаток', ?, ?, 'reconciled', 1, 0, ?, ?)
  `);

  for (const a of toWrite) {
    insert.run(
      createId(), a.id, DATE, a.balance,
      // On-budget money must land in Ready to Assign to be budgetable at all.
      a.on_budget ? 'ready-to-assign' : null,
      `Сверка на ${DATE}: остаток восстановлен, история свёрнута`,
      now, now,
    );
    written++;
  }
})();

// The triggers journalled every row above, but only the API's middleware stamps
// a batch. Do it here so this is one reviewable, revertible entry.
const batchId = `fresh-start-${DATE}-${createId().slice(0, 8)}`;
sqlite.prepare(`
  UPDATE audit_log SET batch_id = ?, method = 'SCRIPT', path = ?
  WHERE rowid > ? AND batch_id = 'pending'
`).run(batchId, `fresh-start --date=${DATE}`, auditMark);

// Prove the balances survived rather than asserting it.
const after = sqlite.prepare(`
  SELECT a.id, a.name, a.currency,
    COALESCE(SUM(CASE WHEN t.is_deleted = 0 THEN t.amount_cents ELSE 0 END), 0) as balance
  FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
  GROUP BY a.id
`).all() as Array<{ id: string; name: string; currency: string; balance: number }>;

const drift = after.filter((a) => a.balance !== accounts.find((b) => b.id === a.id)!.balance);

console.log(`\nsoft-deleted ${liveTx.n} transaction(s), wrote ${written} opening balance(s)`);
if (!KEEP_BUDGET) console.log(`cleared ${assigned.rows} assignment(s) (${fmt(assigned.total)})`);
console.log(`audit batch: ${batchId}`);

if (drift.length) {
  console.log(`\n!! BALANCES CHANGED — restore from ${backup}`);
  for (const d of drift) {
    const before = accounts.find((b) => b.id === d.id)!;
    console.log(`   ${d.name}: ${fmt(before.balance, d.currency)} → ${fmt(d.balance, d.currency)}`);
  }
  sqlite.close();
  process.exit(1);
}

console.log('verified: every account balance is unchanged');

const rta = sqlite.prepare(`
  SELECT COALESCE(SUM(t.amount_cents), 0) as total
  FROM transactions t JOIN accounts a ON a.id = t.account_id
  WHERE a.on_budget = 1 AND t.is_deleted = 0 AND t.category_id = 'ready-to-assign'
`).get() as { total: number };

console.log(`Ready to Assign is now ${fmt(rta.total - (KEEP_BUDGET ? assigned.total : 0))}`);
sqlite.close();
