import { createDb, initializeDatabase, type DB } from '@pfm/engine';

const dbPath = process.env.PFM_DB_PATH ?? './data/pfm.db';
export const db: DB = createDb(dbPath);

/**
 * Схема приводится в порядок на старте, а не отдельным ручным шагом.
 *
 * Раньше `initializeDatabase` звал только скрипт `pnpm db:migrate`, а прод
 * поднимался мимо него. Пока менялся лишь код, это сходило с рук; первая же
 * новая колонка приехала бы в задеплоенный API, которого нет в базе на
 * волюме, — и любая запись падала бы на неизвестном поле.
 *
 * Вызов идемпотентен по построению: таблицы создаются через IF NOT EXISTS,
 * ALTER-ы обёрнуты в try/catch и штатно падают на уже существующей колонке,
 * триггеры пересоздаются, системные строки вставляются через INSERT OR IGNORE.
 */
initializeDatabase(db.$client);
