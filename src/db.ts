import pg from 'pg';
import { config } from './config.js';

export function createPool(connectionString: string): pg.Pool {
  const url = new URL(connectionString);
  if (config.databaseSsl) {
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode && sslmode !== 'require' && sslmode !== 'verify-full') {
      throw new Error('DATABASE_SSL=true requires sslmode=require or sslmode=verify-full');
    }
    if (['sslcert', 'sslkey', 'sslrootcert'].some(name => url.searchParams.has(name))) {
      throw new Error('SSL certificate URL parameters are not supported; configure the database TLS settings separately');
    }
    // pg-connection-string replaces the explicit ssl object when sslmode is in the URL.
    url.searchParams.delete('sslmode');
  }
  return new pg.Pool({
    connectionString: url.toString(),
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  });
}

export const pool = createPool(config.DATABASE_URL);

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
