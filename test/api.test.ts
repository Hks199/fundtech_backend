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

test('proxy rate limits use X-Forwarded-For and ignore changing Forwarded headers', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const app = createApp({ send: async () => [] });
  app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10', forwarded: `for=198.51.100.${attempt + 1};proto=https` },
        body: '{}'
      });
      assert.equal(response.status, attempt < 5 ? 400 : 429);
      await response.text();
    }
    const otherClient = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11', forwarded: 'for=198.51.100.1;proto=https' },
      body: '{}'
    });
    assert.equal(otherClient.status, 400);
    await otherClient.text();
    const health = await fetch(`${base}/health/live`, { headers: { 'x-forwarded-for': '203.0.113.10', forwarded: 'for=198.51.100.1' } });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(errors.mock.callCount(), 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    errors.mock.restore();
  }
});

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
