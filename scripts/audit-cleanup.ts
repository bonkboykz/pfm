#!/usr/bin/env tsx
/**
 * Finds the damage a recovery session left behind, and optionally repairs it.
 *
 * Reports only by default. Nothing is written without --apply, and --apply
 * takes a backup of the database file first.
 *
 *   pnpm tsx scripts/audit-cleanup.ts                    # report
 *   pnpm tsx scripts/audit-cleanup.ts --apply            # repair
 *   pnpm tsx scripts/audit-cleanup.ts --apply --only=loans,categories
 *
 * Findings:
 *   categories   duplicate names in one group, from creates that were retried
 *   loans        loans repaid in full but still counted as active debt
 *   offsetting   same-day transaction pairs that cancel each other out, the
 *                signature of hand-made corrections standing in for a proper
 *                reconciliation
 *   orphans      transactions pointing at a category id that no longer resolves
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';

const DB_PATH = process.env.PFM_DB_PATH ?? './data/pfm.db';
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '')
  .split(',').filter(Boolean);

const wanted = (name: string) => ONLY.length === 0 || ONLY.includes(name);

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set PFM_DB_PATH.`);
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');

const hasSchema = sqlite.prepare(
  `SELECT COUNT(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'categories'`
).get() as { n: number };

if (!hasSchema.n) {
  console.error(`${DB_PATH} has no PFM schema — wrong path, or migrations have not run.`);
  console.error('Production data lives on the Railway volume at /data/pfm.db.');
  process.exit(1);
}

const fmt = (cents: number) =>
  `${(cents / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;

let findings = 0;
let repairs = 0;

function section(title: string) {
  console.log(`\n${'─'.repeat(64)}\n${title}\n${'─'.repeat(64)}`);
}

// --- Duplicate categories -------------------------------------------------
//
// A retried create made a second category with the same name and a fresh id.
// The copy holding no assignments and no transactions is the one to hide.

interface DupRow { group_id: string; name: string; ids: string; n: number }

function checkDuplicateCategories() {
  section('Duplicate categories');

  const dups = sqlite.prepare(`
    SELECT group_id, name, GROUP_CONCAT(id) as ids, COUNT(*) as n
    FROM categories
    WHERE is_system = 0 AND is_hidden = 0
    GROUP BY group_id, name HAVING COUNT(*) > 1
  `).all() as DupRow[];

  if (!dups.length) return void console.log('none');

  const toHide: string[] = [];

  for (const d of dups) {
    console.log(`\n"${d.name}" — ${d.n} copies`);

    for (const id of d.ids.split(',')) {
      const usage = sqlite.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE category_id = ? AND is_deleted = 0) as txs,
          (SELECT COALESCE(SUM(assigned_cents), 0) FROM monthly_budgets WHERE category_id = ?) as assigned,
          (SELECT COUNT(*) FROM loans WHERE category_id = ? AND is_active = 1) as loans
      `).get(id, id, id) as { txs: number; assigned: number; loans: number };

      const used = usage.txs > 0 || usage.assigned !== 0 || usage.loans > 0;
      console.log(`  ${id}  ${usage.txs} tx, assigned ${fmt(usage.assigned)}, ${usage.loans} loan(s)  ${used ? '← keep' : '← unused, would hide'}`);
      if (!used) toHide.push(id);
      findings++;
    }

    // Never hide every copy — if all of them are in use this needs a human.
    if (toHide.length === d.ids.split(',').length) {
      console.log('  all copies are in use; merge them by hand');
      toHide.length = 0;
    }
  }

  if (APPLY && toHide.length) {
    const stmt = sqlite.prepare(`UPDATE categories SET is_hidden = 1 WHERE id = ?`);
    for (const id of toHide) { stmt.run(id); repairs++; }
    console.log(`\nhid ${toHide.length} unused duplicate(s)`);
  }
}

// --- Loans repaid but still active ----------------------------------------

interface LoanRow {
  id: string; name: string; principal_cents: number; paid_off_cents: number;
  category_id: string | null; start_date: string;
}

function checkRepaidLoans() {
  section('Loans still counted as debt');

  const loans = sqlite.prepare(
    `SELECT id, name, principal_cents, paid_off_cents, category_id, start_date FROM loans WHERE is_active = 1`
  ).all() as LoanRow[];

  if (!loans.length) return void console.log('none active');

  const repaid: LoanRow[] = [];
  let totalActive = 0;

  for (const l of loans) {
    const opening = Math.max(0, l.principal_cents - l.paid_off_cents);
    let paid = 0;

    if (l.category_id) {
      const row = sqlite.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions
        WHERE category_id = ? AND is_deleted = 0 AND transfer_account_id IS NULL AND date >= ?
      `).get(l.category_id, l.start_date) as { total: number };
      paid = Math.max(0, -row.total);
    }

    const outstanding = Math.max(0, opening - paid);
    totalActive += outstanding;

    if (outstanding === 0) {
      repaid.push(l);
      console.log(`  ${l.name} — fully repaid, still active  (${l.id})`);
      findings++;
    }
  }

  console.log(`\nactive loans: ${loans.length}, outstanding ${fmt(totalActive)}`);
  if (!repaid.length) return void console.log('nothing to close');

  if (APPLY) {
    const today = new Date().toISOString().slice(0, 10);
    const stmt = sqlite.prepare(`
      UPDATE loans SET is_active = 0, paid_off_cents = principal_cents,
        closed_date = ?, closure_reason = ?, updated_at = ?
      WHERE id = ?
    `);
    for (const l of repaid) {
      stmt.run(today, 'Closed by audit-cleanup: balance reached zero', new Date().toISOString(), l.id);
      repairs++;
    }
    console.log(`closed ${repaid.length} repaid loan(s)`);
  }
}

// --- Offsetting transaction pairs -----------------------------------------
//
// Correcting a balance with a matched inflow and outflow leaves permanent
// noise in category history. reconcile_account exists so this is never needed.

interface TxRow { id: string; date: string; amount_cents: number; payee_name: string | null; category_id: string | null }

function checkOffsettingTransactions() {
  section('Offsetting transaction pairs');

  const inflows = sqlite.prepare(`
    SELECT id, date, amount_cents, payee_name, category_id FROM transactions
    WHERE is_deleted = 0 AND transfer_account_id IS NULL
      AND category_id = 'ready-to-assign' AND amount_cents > 0
  `).all() as TxRow[];

  const suspects: Array<{ inflow: TxRow; outflows: TxRow[] }> = [];

  for (const inf of inflows) {
    // Same-day spending that sums to exactly the inflow is the signature.
    const sameDay = sqlite.prepare(`
      SELECT id, date, amount_cents, payee_name, category_id FROM transactions
      WHERE is_deleted = 0 AND transfer_account_id IS NULL
        AND date = ? AND amount_cents < 0
        AND (category_id IS NULL OR category_id != 'ready-to-assign')
    `).all(inf.date) as TxRow[];

    const total = sameDay.reduce((s, t) => s + t.amount_cents, 0);
    if (sameDay.length >= 2 && total + inf.amount_cents === 0) {
      suspects.push({ inflow: inf, outflows: sameDay });
      findings += sameDay.length + 1;
    }
  }

  if (!suspects.length) return void console.log('none');

  for (const s of suspects) {
    console.log(`\n${s.inflow.date}: inflow ${fmt(s.inflow.amount_cents)} cancelled by ${s.outflows.length} outflows`);
    console.log(`  ${s.outflows.length + 1} transactions, net zero — replace with reconcile_account`);
  }

  if (APPLY) {
    console.log('\nnot removed automatically: deleting these changes every category total.');
    console.log('Review the ids above, then soft-delete them and reconcile the account instead:');
    console.log('  POST /api/v1/accounts/<id>/reconcile { actualBalanceCents }');
  }
}

// --- Orphaned category references -----------------------------------------

function checkOrphanReferences() {
  section('Transactions pointing at missing categories');

  const orphans = sqlite.prepare(`
    SELECT t.id, t.date, t.amount_cents, t.category_id
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.category_id IS NOT NULL AND c.id IS NULL AND t.is_deleted = 0
  `).all() as Array<{ id: string; date: string; amount_cents: number; category_id: string }>;

  if (!orphans.length) return void console.log('none');

  for (const o of orphans) {
    console.log(`  ${o.date}  ${fmt(o.amount_cents)}  → missing category ${o.category_id}  (${o.id})`);
    findings++;
  }

  if (APPLY) {
    const stmt = sqlite.prepare(`UPDATE transactions SET category_id = NULL, updated_at = ? WHERE id = ?`);
    for (const o of orphans) { stmt.run(new Date().toISOString(), o.id); repairs++; }
    console.log(`\ncleared ${orphans.length} dangling reference(s); recategorise them`);
  }
}

// --- Run ------------------------------------------------------------------

console.log(`PFM data audit — ${DB_PATH}`);
console.log(APPLY ? 'MODE: apply (writes)' : 'MODE: report only (use --apply to repair)');

if (APPLY) {
  const backup = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(DB_PATH, backup);
  console.log(`backup: ${backup}`);
}

try {
  if (wanted('categories')) checkDuplicateCategories();
  if (wanted('loans')) checkRepaidLoans();
  if (wanted('offsetting')) checkOffsettingTransactions();
  if (wanted('orphans')) checkOrphanReferences();

  section('Summary');
  console.log(`findings: ${findings}`);
  console.log(APPLY ? `repairs applied: ${repairs}` : 'no changes written — re-run with --apply');
} finally {
  sqlite.close();
}
