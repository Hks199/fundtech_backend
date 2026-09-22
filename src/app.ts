import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { Producer } from 'kafkajs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { parseEvent } from './events.js';
import { createToken, requireAuth, verifyPassword } from './auth.js';
import { publishEvent } from './kafka.js';

const loginSchema = z.strictObject({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024) });
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const pagingSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(1000000).default(0) });

export function createApp(producer: Pick<Producer, 'send'>) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS origin denied'));
  } }));
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(pinoHttp({ logger, genReqId: req => req.headers['x-request-id']?.toString().slice(0, 100) || randomUUID(),
    serializers: { req: req => ({ method: req.method, url: req.url, id: req.id }), res: res => ({ statusCode: res.statusCode }) } }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });

  const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/auth/login', loginLimit, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const supplied = Buffer.from(parsed.data.username);
    const expected = Buffer.from(config.ADMIN_USERNAME);
    const usernameMatches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    const passwordMatches = await verifyPassword(parsed.data.password);
    if (!usernameMatches || !passwordMatches) return res.status(401).json({ error: 'Invalid credentials' });
    res.set('Cache-Control', 'no-store').json({ access_token: await createToken(), token_type: 'Bearer', expires_in: 3600 });
  });

  app.use('/api', requireAuth);
  app.post('/api/events', async (req, res) => {
    const parsed = parseEvent({ ...req.body, event_id: req.body?.event_id || randomUUID() });
    await publishEvent(producer, parsed);
    res.status(202).json({ event_id: parsed.event_id, status: 'queued' });
  });
  app.get('/api/events/:eventId', async (req, res) => {
    const parsed = z.uuid().safeParse(req.params.eventId);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid event ID' });
    const result = await pool.query('SELECT event_id,product_id,event_type,status,reason,occurred_at,processed_at FROM processed_events WHERE event_id=$1', [parsed.data]);
    if (!result.rowCount) return res.status(404).json({ error: 'Event not found' });
    res.json(result.rows[0]);
  });
  app.get('/api/products', async (_req, res) => {
    const result = await pool.query(`SELECT p.id AS product_id,
      COALESCE(SUM(b.remaining_quantity),0)::bigint AS current_quantity,
      COALESCE(SUM(b.remaining_quantity * b.unit_price),0)::text AS total_inventory_cost,
      CASE WHEN COALESCE(SUM(b.remaining_quantity),0)=0 THEN '0' ELSE (SUM(b.remaining_quantity * b.unit_price)/SUM(b.remaining_quantity))::numeric(18,4)::text END AS average_cost_per_unit
      FROM products p LEFT JOIN inventory_batches b ON b.product_id=p.id GROUP BY p.id ORDER BY p.id`);
    res.json({ products: result.rows });
  });
  app.get('/api/products/:productId/batches', async (req, res) => {
    const id = idSchema.safeParse(req.params.productId);
    if (!id.success) return res.status(400).json({ error: 'Invalid product ID' });
    const result = await pool.query('SELECT id,original_quantity,remaining_quantity,unit_price,occurred_at FROM inventory_batches WHERE product_id=$1 ORDER BY occurred_at,id', [id.data]);
    res.json({ batches: result.rows });
  });
  app.get('/api/ledger', async (req, res) => {
    const page = pagingSchema.safeParse(req.query);
    if (!page.success) return res.status(400).json({ error: 'Invalid pagination' });
    const product = req.query.product_id === undefined ? undefined : idSchema.safeParse(req.query.product_id);
    if (product && !product.success) return res.status(400).json({ error: 'Invalid product ID' });
    const result = await pool.query(`SELECT e.event_id,e.product_id,e.event_type,e.status,e.reason,e.occurred_at,e.processed_at,
      COALESCE(b.original_quantity,s.quantity)::integer AS quantity,b.unit_price,s.total_cost,
      CASE WHEN s.id IS NULL THEN NULL ELSE (SELECT json_agg(json_build_object('batch_id',a.batch_id,'quantity',a.quantity,'unit_price',a.unit_price,'cost',a.cost) ORDER BY a.batch_id) FROM sale_allocations a WHERE a.sale_id=s.id) END AS allocations
      FROM processed_events e LEFT JOIN inventory_batches b ON b.event_id=e.event_id LEFT JOIN sales s ON s.event_id=e.event_id
      WHERE ($1::text IS NULL OR e.product_id=$1) ORDER BY e.occurred_at DESC,e.processed_at DESC,e.event_id DESC LIMIT $2 OFFSET $3`,
      [product?.data || null, page.data.limit, page.data.offset]);
    res.json({ entries: result.rows, limit: page.data.limit, offset: page.data.offset });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof Error && 'status' in err && err.status === 413) return res.status(413).json({ error: 'Request too large' });
    if (err instanceof z.ZodError || err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid request' });
    if (err instanceof Error && err.message === 'CORS origin denied') return res.status(403).json({ error: 'Origin denied' });
    (req.log || logger).error({ err }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
