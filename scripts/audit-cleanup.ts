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
 *   dupe-loans   the same loan entered twice, doubling the reported debt
 *   dupe-accts   the same account entered twice, doubling its balance
 *   loans        loans repaid in full but still counted as active debt
 *   offsetting   same-day transaction pairs that cancel each other out, the
 *                signature of hand-made corrections standing in for a proper
 *                reconciliation
 *   orphans      transactions pointing at a category id that no longer resolves
 *   unfunded     categories that went negative in a closed month — money spent
 *                that was never assigned. Absorbing the minus is correct, but
 *                silent: the RTA drop lands weeks after the decision that
 *                caused it, by which time the two look unrelated.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { findUnfundedSpending } from '@pfm/engine';
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

// --- The same loan entered twice ------------------------------------------
//
// A retried create makes a second loan with a new id. Both stay active and both
// are summed, so the reported debt is roughly double. The twins are recognised
// by sharing a start date and a term: a retry that reconstructed the principal
// by arithmetic lands a few tiyn away from the original, so the amounts cannot
// be matched exactly.

interface DupLoan {
  id: string; name: string; category_id: string | null;
  principal_cents: number; monthly_payment_cents: number;
  term_months: number; start_date: string; paid_off_cents: number;
}

function outstandingOf(l: DupLoan): number {
  const opening = Math.max(0, l.principal_cents - l.paid_off_cents);
  if (!l.category_id) return opening;
  const row = sqlite.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as total FROM transactions
    WHERE category_id = ? AND is_deleted = 0 AND transfer_account_id IS NULL AND date >= ?
  `).get(l.category_id, l.start_date) as { total: number };
  return Math.max(0, opening - Math.max(0, -row.total));
}

function checkDuplicateLoans() {
  section('The same loan entered twice');

  const active = sqlite.prepare(`
    SELECT id, name, category_id, principal_cents, monthly_payment_cents,
           term_months, start_date, paid_off_cents
    FROM loans WHERE is_active = 1
  `).all() as DupLoan[];

  const groups = new Map<string, DupLoan[]>();
  for (const l of active) {
    const k = `${l.start_date}|${l.term_months}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const pairs = [...groups.values()].filter((g) => g.length > 1);
  if (!pairs.length) return void console.log('none');

  let doubleCounted = 0;
  const toClose: DupLoan[] = [];

  for (const g of pairs) {
    console.log(`\nstart ${g[0].start_date}, ${g[0].term_months} months — ${g.length} active loans`);
    const debts = g.map(outstandingOf);

    for (const [i, l] of g.entries()) {
      console.log(`  ${l.id}  ${l.category_id ? 'linked  ' : 'no cat  '} ${fmt(debts[i])}  "${l.name}"`);
      findings++;
    }

    // Keep the record wired to a category; it is the one that tracks payments.
    const keepIdx = g.findIndex((l) => l.category_id);
    const agree = debts.every((d) => d === debts[0]);

    if (keepIdx === -1 || !agree) {
      console.log('  → twins disagree on the outstanding amount; decide by hand which is real');
      continue;
    }

    for (const [i, l] of g.entries()) {
      if (i === keepIdx) continue;
      toClose.push(l);
      doubleCounted += debts[i];
    }
    console.log(`  → keep ${g[keepIdx].id} (linked to a category), close the other ${g.length - 1}`);
  }

  console.log(`\ndouble-counted debt: ${fmt(doubleCounted)}`);

  if (APPLY && toClose.length) {
    const today = new Date().toISOString().slice(0, 10);
    const stmt = sqlite.prepare(`
      UPDATE loans SET is_active = 0, paid_off_cents = principal_cents,
        closed_date = ?, closure_reason = ?, updated_at = ? WHERE id = ?
    `);
    for (const l of toClose) {
      stmt.run(today, 'Closed by audit-cleanup: duplicate of a linked loan', new Date().toISOString(), l.id);
      repairs++;
    }
    console.log(`closed ${toClose.length} duplicate loan(s)`);
  }
}

// --- The same account entered twice ---------------------------------------
//
// Deactivating the copy is not enough: its transactions keep feeding Ready to
// Assign, which is exactly how an invisible account skews the totals. The
// transactions have to go with it.

interface DupAcct { id: string; name: string; created_at: string; is_active: number }

function checkDuplicateAccounts() {
  section('The same account entered twice');

  // A copy that has already been retired and emptied is not a finding.
  const groups = sqlite.prepare(`
    SELECT name, COUNT(*) as n FROM accounts a
    WHERE a.is_active = 1
       OR EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id AND t.is_deleted = 0)
    GROUP BY name HAVING COUNT(*) > 1
  `).all() as Array<{ name: string; n: number }>;

  if (!groups.length) return void console.log('none');

  for (const g of groups) {
    const copies = sqlite.prepare(`
      SELECT id, name, created_at, is_active FROM accounts a
      WHERE a.name = ?
        AND (a.is_active = 1
             OR EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id AND t.is_deleted = 0))
      ORDER BY created_at
    `).all(g.name) as DupAcct[];

    console.log(`\n"${g.name}" — ${g.n} copies`);

    const detail = copies.map((a) => {
      const row = sqlite.prepare(`
        SELECT COUNT(*) as n, COALESCE(SUM(amount_cents), 0) as bal
        FROM transactions WHERE account_id = ? AND is_deleted = 0
      `).get(a.id) as { n: number; bal: number };
      console.log(`  ${a.id}  active=${!!a.is_active}  ${fmt(row.bal)}  ${row.n} tx  created ${a.created_at.slice(0, 10)}`);
      findings++;
      return { a, ...row };
    });

    const balances = new Set(detail.map((d) => d.bal));
    if (balances.size > 1) {
      console.log('  → copies hold different money; merge by hand');
      continue;
    }

    const [, ...extras] = detail;
    console.log(`  → keep ${detail[0].a.id} (oldest); the rest double-count ${fmt(detail[0].bal)}`);

    if (APPLY) {
      const now = new Date().toISOString();
      for (const e of extras) {
        sqlite.prepare(`UPDATE transactions SET is_deleted = 1, updated_at = ? WHERE account_id = ?`).run(now, e.a.id);
        sqlite.prepare(`UPDATE accounts SET is_active = 0, updated_at = ? WHERE id = ?`).run(now, e.a.id);
        repairs++;
      }
      console.log(`  removed ${extras.length} copy/copies and their transactions`);
    }
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

/**
 * Траты без назначения. Репорт-онли: чинить это скриптом нельзя — решение,
 * откуда взять деньги задним числом, принимает человек.
 */
function checkUnfundedSpending() {
  section('Unfunded spending — categories that went negative in a closed month');

  const thisMonth = new Date().toISOString().slice(0, 7);
  const rows = findUnfundedSpending(drizzle(sqlite), thisMonth);

  if (rows.length === 0) {
    console.log('none — every closed month was covered by assignments');
    return;
  }

  for (const r of rows) {
    const parts = [
      r.cashCents > 0 ? `${fmt(r.cashCents)} out of Ready to Assign` : null,
      r.creditCents > 0 ? `${fmt(r.creditCents)} onto card debt` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${r.month}  ${r.categoryName} — ${fmt(r.overspentCents)}  → ${parts}`);
    findings++;
  }

  console.log('\nassign the money in that month to give the drop a name, or leave it as history');
}

// --- Run ------------------------------------------------------------------

console.log(`PFM data audit — ${DB_PATH}`);
console.log(APPLY ? 'MODE: apply (writes)' : 'MODE: report only (use --apply to repair)');

if (APPLY) {
  const backup = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(DB_PATH, backup);
  console.log(`backup: ${backup}`);
}

// The audit triggers journal every row this script touches, but the batch id and
// request fields are stamped by the API's middleware — which this script bypasses.
// Without the same stamp the repairs sit in the journal as anonymous 'pending'
// rows: invisible in list_recent_changes and out of reach of undo_changes.
const auditMark = (
  sqlite.prepare(`SELECT COALESCE(MAX(rowid), 0) as mark FROM audit_log`).get() as { mark: number }
).mark;

function stampAuditBatch(): string | null {
  const batchId = `cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const label = `audit-cleanup${ONLY.length ? ` --only=${ONLY.join(',')}` : ''}`;

  const res = sqlite.prepare(`
    UPDATE audit_log SET batch_id = ?, method = 'SCRIPT', path = ?
    WHERE rowid > ? AND batch_id = 'pending'
  `).run(batchId, label, auditMark);

  return res.changes > 0 ? batchId : null;
}

try {
  if (wanted('categories')) checkDuplicateCategories();
  if (wanted('dupe-loans')) checkDuplicateLoans();
  if (wanted('dupe-accts')) checkDuplicateAccounts();
  if (wanted('loans')) checkRepaidLoans();
  if (wanted('offsetting')) checkOffsettingTransactions();
  if (wanted('orphans')) checkOrphanReferences();
  if (wanted('unfunded')) checkUnfundedSpending();

  section('Summary');
  console.log(`findings: ${findings}`);

  if (!APPLY) {
    console.log('no changes written — re-run with --apply');
  } else {
    console.log(`repairs applied: ${repairs}`);
    const batchId = stampAuditBatch();
    if (batchId) {
      console.log(`audit batch: ${batchId}`);
      console.log(`undo with:   POST /api/v1/audit/undo { "batchId": "${batchId}" }`);
    }
  }
} finally {
  sqlite.close();
}
