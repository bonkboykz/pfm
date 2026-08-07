import { Hono } from 'hono';
import { z } from 'zod';
import type { DB } from '@pfm/engine';
import { validationError, notFound } from '../errors.js';

const AUDITED_TABLES = new Set(['transactions', 'monthly_budgets', 'loans']);

interface AuditRow {
  id: string;
  batch_id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  method: string;
  path: string;
  before_json: string | null;
  after_json: string | null;
  is_reverted: number;
  reverted_at: string | null;
  created_at: string;
}

const undoSchema = z.object({
  batchId: z.string().min(1),
});

function describe(row: AuditRow): string {
  const after = row.after_json ? JSON.parse(row.after_json) : null;
  const before = row.before_json ? JSON.parse(row.before_json) : null;
  const body = after ?? before ?? {};

  switch (row.entity) {
    case 'transactions':
      return `${row.action} transaction ${body.amount_cents ?? '?'} on ${body.date ?? '?'}${body.payee_name ? ` — ${body.payee_name}` : ''}`;
    case 'monthly_budgets':
      return `${row.action} assignment ${body.month ?? '?'} category ${body.category_id ?? '?'} = ${body.assigned_cents ?? '?'}`;
    case 'loans':
      return `${row.action} loan ${body.name ?? body.id ?? '?'}`;
    default:
      return `${row.action} ${row.entity}`;
  }
}

export function auditRoutes(db: DB) {
  const router = new Hono();

  // GET / — recent changes, newest first, grouped by the request that made them
  router.get('/', (c) => {
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 500);
    const entity = c.req.query('entity');
    const batchId = c.req.query('batchId');

    const where: string[] = [];
    const params: unknown[] = [];

    if (entity) { where.push('entity = ?'); params.push(entity); }
    if (batchId) { where.push('batch_id = ?'); params.push(batchId); }
    if (c.req.query('includeReverted') !== 'true') where.push('is_reverted = 0');

    const rows = db.$client.prepare(`
      SELECT * FROM audit_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY rowid DESC LIMIT ?
    `).all(...params, limit) as AuditRow[];

    // Rows are returned grouped by batch so a caller sees "the import" rather
    // than three hundred individual inserts.
    const batches = new Map<string, { batchId: string; method: string; path: string; at: string; changes: any[] }>();

    for (const r of rows) {
      if (!batches.has(r.batch_id)) {
        batches.set(r.batch_id, {
          batchId: r.batch_id,
          method: r.method,
          path: r.path,
          at: r.created_at,
          changes: [],
        });
      }
      batches.get(r.batch_id)!.changes.push({
        id: r.id,
        entity: r.entity,
        entityId: r.entity_id,
        action: r.action,
        summary: describe(r),
        isReverted: Boolean(r.is_reverted),
        at: r.created_at,
      });
    }

    return c.json({
      batches: Array.from(batches.values()).map((b) => ({
        ...b,
        changeCount: b.changes.length,
      })),
      totalChanges: rows.length,
    });
  });

  // POST /undo — replay one batch backwards
  router.post('/undo', async (c) => {
    const body = await c.req.json();
    const parsed = undoSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const rows = db.$client.prepare(
      `SELECT * FROM audit_log WHERE batch_id = ? AND is_reverted = 0 ORDER BY rowid DESC`
    ).all(parsed.data.batchId) as AuditRow[];

    if (!rows.length) throw notFound('Audit batch', parsed.data.batchId);

    const unsupported = rows.filter((r) => !AUDITED_TABLES.has(r.entity));
    if (unsupported.length) {
      throw validationError(`Cannot undo changes to ${[...new Set(unsupported.map((r) => r.entity))].join(', ')}`);
    }

    const now = new Date().toISOString();
    let reverted = 0;

    // Newest first, so a batch that created a row and then updated it unwinds
    // in the order it was applied. The undo itself is written to the journal by
    // the same triggers, then marked so it does not appear as fresh history.
    const mark = db.$client.prepare(`SELECT COALESCE(MAX(rowid), 0) as m FROM audit_log`).get() as { m: number };

    db.$client.transaction(() => {
      for (const r of rows) {
        if (r.action === 'create') {
          db.$client.prepare(`DELETE FROM ${r.entity} WHERE id = ?`).run(r.entity_id);
        } else if (r.before_json) {
          const before = JSON.parse(r.before_json) as Record<string, unknown>;
          const cols = Object.keys(before);
          db.$client.prepare(`
            INSERT INTO ${r.entity} (${cols.join(', ')})
            VALUES (${cols.map(() => '?').join(', ')})
            ON CONFLICT(id) DO UPDATE SET ${cols.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ')}
          `).run(...cols.map((k) => before[k] as never));
        }
        reverted++;
      }

      db.$client.prepare(
        `UPDATE audit_log SET is_reverted = 1, reverted_at = ? WHERE batch_id = ? AND is_reverted = 0`
      ).run(now, parsed.data.batchId);

      db.$client.prepare(
        `UPDATE audit_log SET is_reverted = 1, reverted_at = ?, batch_id = ? WHERE rowid > ? AND batch_id = 'pending'`
      ).run(now, `undo-${parsed.data.batchId}`, mark.m);
    })();

    return c.json({
      batchId: parsed.data.batchId,
      reverted,
      message: `Reverted ${reverted} change(s)`,
    });
  });

  return router;
}
