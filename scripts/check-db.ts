import { pool } from '../src/db.js';

try {
  const expected = ['products', 'processed_events', 'inventory_batches', 'sales', 'sale_allocations'];
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_catalog.pg_tables
      WHERE schemaname = $1
        AND tablename = ANY($2::text[])
      ORDER BY tablename`,
    ['public', expected]
  );
  const found = result.rows.map(row => row.tablename);
  const missing = expected.filter(table => !found.includes(table));
  if (missing.length) throw new Error(`Missing database tables: ${missing.join(', ')}`);
  process.stdout.write(`Database ready: ${found.join(', ')}\n`);
} finally {
  await pool.end();
}
