import test from 'node:test';
import assert from 'node:assert/strict';
import { lazyProducer } from '../src/lazy-producer.js';

const record = { topic: 'test', messages: [{ value: 'event' }] };

test('lazy producer shares initialization and waits before publishing', async () => {
  let connections = 0;
  let sends = 0;
  let connected = false;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const producer = lazyProducer({
    connect: async () => { connections++; await pending; connected = true; },
    send: async () => { assert.equal(connected, true); sends++; return []; }
  });
  assert.equal(connections, 0);
  const first = producer.send(record);
  const second = producer.send(record);
  assert.equal(connections, 1);
  assert.equal(sends, 0);
  release();
  await Promise.all([first, second]);
  await producer.send(record);
  assert.equal(connections, 1);
  assert.equal(sends, 3);
});

test('lazy producer retries initialization after failure without publishing', async () => {
  let connections = 0;
  let sends = 0;
  const producer = lazyProducer({
    connect: async () => { if (++connections === 1) throw new Error('offline'); },
    send: async () => { sends++; return []; }
  });
  await assert.rejects(producer.send(record), /offline/);
  assert.equal(sends, 0);
  await producer.send(record);
  assert.equal(connections, 2);
  assert.equal(sends, 1);
});
