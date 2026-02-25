import { createId } from '@paralleldrive/cuid2';
import type { DB } from '../db/index.js';
import { formatMoney } from '../math/money.js';
import type { Frequency, ScheduledTransaction, ProcessResult } from './types.js';

export function advanceDate(current: string, freq: Frequency): string {
  const [y, m, d] = current.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const origDay = date.getUTCDate();

  switch (freq) {
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7);
      break;
    case 'biweekly':
      date.setUTCDate(date.getUTCDate() + 14);
      break;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + 1);
      // If overflowed (e.g., Jan 31 → Mar 3), go to last day of intended month
      if (date.getUTCDate() < origDay) date.setUTCDate(0);
      break;
    case 'yearly':
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      // Handle leap year (Feb 29 → Feb 28)
      if (date.getUTCDate() !== origDay) date.setUTCDate(0);
      break;
  }

  return date.toISOString().split('T')[0];
}

export function getUpcoming(db: DB, daysAhead = 7, asOfDate?: string): ScheduledTransaction[] {
  const today = asOfDate ?? new Date().toISOString().split('T')[0];
  const [y, mo, da] = today.split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, mo - 1, da + daysAhead));
  const cutoffDate = cutoff.toISOString().split('T')[0];

  const stmt = db.$client.prepare(`
    SELECT st.*, a.name as account_name, c.name as category_name,
           ta.name as transfer_account_name
    FROM scheduled_transactions st
    JOIN accounts a ON a.id = st.account_id
    LEFT JOIN categories c ON c.id = st.category_id
    LEFT JOIN accounts ta ON ta.id = st.transfer_account_id
    WHERE st.is_active = 1
      AND st.next_date <= ?
    ORDER BY st.next_date
  `);

  const rows = stmt.all(cutoffDate) as any[];

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    frequency: row.frequency as Frequency,
    nextDate: row.next_date,
    amountCents: row.amount_cents,
    amountFormatted: formatMoney(row.amount_cents),
    payeeName: row.payee_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    transferAccountId: row.transfer_account_id,
    transferAccountName: row.transfer_account_name,
    memo: row.memo,
    isActive: !!row.is_active,
  }));
}

export function processDue(db: DB, asOfDate?: string): ProcessResult {
  const today = asOfDate ?? new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const dueRows = db.$client.prepare(`
    SELECT st.*, a.name as account_name, ta.name as transfer_account_name
    FROM scheduled_transactions st
    JOIN accounts a ON a.id = st.account_id
    LEFT JOIN accounts ta ON ta.id = st.transfer_account_id
    WHERE st.is_active = 1
      AND st.next_date <= ?
  `).all(today) as any[];

  const result: ProcessResult = { created: 0, transactions: [], errors: [] };

  const insertTx = db.$client.prepare(`
    INSERT INTO transactions (id, account_id, date, amount_cents, payee_name, category_id, transfer_account_id, transfer_transaction_id, memo, cleared, approved, is_deleted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uncleared', 1, 0, ?, ?)
  `);

  const updateSched = db.$client.prepare(`
    UPDATE scheduled_transactions SET next_date = ?, updated_at = ? WHERE id = ?
  `);

  for (const row of dueRows) {
    try {
      if (row.transfer_account_id) {
        // Transfer: create paired transactions
        const tx1Id = createId();
        const tx2Id = createId();
        const memo = row.memo ? `${row.memo} (auto)` : '(auto)';

        insertTx.run(
          tx1Id, row.account_id, row.next_date, row.amount_cents,
          `Transfer: ${row.transfer_account_name}`, null,
          row.transfer_account_id, tx2Id, memo, now, now,
        );
        insertTx.run(
          tx2Id, row.transfer_account_id, row.next_date, -row.amount_cents,
          `Transfer: ${row.account_name}`, null,
          row.account_id, tx1Id, memo, now, now,
        );

        result.transactions.push(
          { id: tx1Id, scheduledId: row.id, date: row.next_date },
          { id: tx2Id, scheduledId: row.id, date: row.next_date },
        );
        result.created += 2;
      } else {
        // Regular transaction
        const txId = createId();
        const memo = row.memo ? `${row.memo} (auto)` : '(auto)';

        insertTx.run(
          txId, row.account_id, row.next_date, row.amount_cents,
          row.payee_name, row.category_id,
          null, null, memo, now, now,
        );

        result.transactions.push({ id: txId, scheduledId: row.id, date: row.next_date });
        result.created += 1;
      }

      // Advance next_date
      const newDate = advanceDate(row.next_date, row.frequency as Frequency);
      updateSched.run(newDate, now, row.id);
    } catch (err: any) {
      result.errors.push({ scheduledId: row.id, message: err.message });
    }
  }

  return result;
}
