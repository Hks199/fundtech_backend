import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool, pool } from '../src/db.js';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';

const migrationUrl = config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL_UNPOOLED;
const migrationPool = migrationUrl ? createPool(migrationUrl) : pool;
try {
  const sql = await readFile(resolve(process.cwd(), 'db/001_initial.sql'), 'utf8');
  await migrationPool.query(sql);
  logger.info('Database migration complete');
} finally {
  await migrationPool.end();
  if (migrationPool !== pool) await pool.end();
}
