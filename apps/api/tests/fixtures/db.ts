import { createDb, initializeDatabase, type DB } from '@pfm/engine';

/**
 * An in-memory database with the full schema, the audit triggers, and the two
 * system rows the engine hardcodes ("inflow-group" / "ready-to-assign"), but no
 * user data.
 *
 * `createDb` only opens a connection — it does not create tables, and
 * `packages/engine/src/db/migrate.ts` is a side-effecting script that writes to
 * ./data, so it cannot be reused from a test. Both go through the same
 * `initializeDatabase`, so a test database can never drift from production's.
 */
export function createTestDb(): DB {
  const db = createDb(':memory:');
  initializeDatabase(db.$client);
  return db;
}
