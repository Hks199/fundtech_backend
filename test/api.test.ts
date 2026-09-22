import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Producer } from 'kafkajs';

const salt = randomBytes(16);
process.env.DATABASE_URL = 'postgres://inventory:inventory@localhost:5432/inventory';
process.env.KAFKA_BROKERS = 'localhost:9092';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD_HASH = `scrypt$${salt.toString('hex')}$${scryptSync('long-test-password', salt, 64).toString('hex')}`;
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');

test('login protects event publishing and validates input', async () => {
  const sent: unknown[] = [];
  const app = createApp({ send: async message => { sent.push(message); return []; } } satisfies Pick<Producer, 'send'>);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const unauthorized = await fetch(`${base}/api/events`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test-admin', password: 'long-test-password' }) });
    assert.equal(login.status, 200);
    const { access_token } = await login.json();
    const headers = { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' };
    const bad = await fetch(`${base}/api/events`, { method: 'POST', headers, body: JSON.stringify({ product_id: 'PRD001', event_type: 'sale', quantity: -1, timestamp: '2025-07-12T10:00:00Z' }) });
    assert.equal(bad.status, 400);
    const good = await fetch(`${base}/api/events`, { method: 'POST', headers, body: JSON.stringify({ product_id: 'PRD001', event_type: 'purchase', quantity: 2, unit_price: 12.5, timestamp: '2025-07-12T10:00:00Z' }) });
    assert.equal(good.status, 202);
    assert.equal(sent.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
