import { createDb } from '@pfm/engine';

const dbPath = process.env.PFM_DB_PATH ?? './data/pfm.db';
export const db = createDb(dbPath);
