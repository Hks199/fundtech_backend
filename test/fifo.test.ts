import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateFifo } from '../src/fifo.js';
import { parseEvent } from '../src/events.js';

test('sale consumes oldest batches and calculates exact cost', () => {
  const result = allocateFifo([
    { id: 1, remaining_quantity: 10, unit_price: '100.0000' },
    { id: 2, remaining_quantity: 10, unit_price: '120.0000' }
  ], 12);
  assert.equal(result.totalCost, '1240.0000');
  assert.equal(result.remaining, 0);
  assert.deepEqual(result.allocations.map(x => [x.batchId, x.quantity]), [[1, 10], [2, 2]]);
});

test('insufficient stock leaves a shortfall', () => {
  const result = allocateFifo([{ id: 1, remaining_quantity: 2, unit_price: '0.2900' }], 3);
  assert.equal(result.totalCost, '0.5800');
  assert.equal(result.remaining, 1);
});

test('sale cannot supply a purchase price', () => {
  assert.throws(() => parseEvent({ event_id: 'ecac631e-b595-427f-8a70-461877af6141', product_id: 'PRD001', event_type: 'sale', quantity: 1, unit_price: 10, timestamp: '2025-07-12T10:00:00Z' }));
});
