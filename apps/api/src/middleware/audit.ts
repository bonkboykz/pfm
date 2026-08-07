import type { MiddlewareHandler } from 'hono';
import { createId } from '@paralleldrive/cuid2';
import type { DB } from '@pfm/engine';

/**
 * Ties the rows a request changed together under one batch id.
 *
 * Database triggers write the journal entries with placeholder request fields;
 * this notes the journal's high-water mark before the handler runs and stamps
 * everything appended afterwards. That keeps the trigger definitions free of
 * request plumbing and means a bulk import is one undoable batch rather than
 * three hundred unrelated rows.
 *
 * The watermark assumes requests do not overlap inside a single process, which
 * holds here: better-sqlite3 is synchronous and this API serves one client. If
 * that ever stops being true, concurrent writes would be grouped under the
 * wrong batch — mislabelled history, never lost history.
 */
export function auditLogger(db: DB): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const before = db.$client
      .prepare(`SELECT COALESCE(MAX(rowid), 0) as mark FROM audit_log`)
      .get() as { mark: number };

    await next();

    // A failed request may still have written rows before throwing; stamping
    // them keeps those visible instead of leaving them as 'pending'.
    const batchId = createId();
    const path = new URL(c.req.url).pathname;

    const result = db.$client.prepare(`
      UPDATE audit_log
      SET batch_id = ?, method = ?, path = ?
      WHERE rowid > ? AND batch_id = 'pending'
    `).run(batchId, method, path, before.mark);

    if (result.changes > 0) {
      c.header('X-Audit-Batch', batchId);
    }
  };
}
