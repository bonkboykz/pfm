import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

export function createDb(dbPath = './data/pfm.db') {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

/**
 * Готового `db` пакет не отдаёт намеренно.
 *
 * Раньше здесь был `export const db = createDb()`, и импорт любого символа из
 * движка открывал `./data/pfm.db` и создавал каталог — просто потому, что
 * модуль загрузился. В CI, где vitest поднимает воркер на файл, соседние
 * процессы дрались за один файл и падали с SQLITE_BUSY; локально это не
 * воспроизводилось, пока тестовых файлов было мало.
 *
 * Никто эту переменную не использовал: apps/api строит своё соединение через
 * `createDb(process.env.PFM_DB_PATH)`, тесты — через `createDb(':memory:')`.
 * Соединение должен открывать тот, кто знает путь, а не импорт.
 */
export type DB = ReturnType<typeof createDb>;
export { schema };
