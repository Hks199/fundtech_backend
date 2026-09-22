import { transaction } from './db.js';
import { allocateFifo } from './fifo.js';
import type { InventoryBatch } from './fifo.js';
import type { InventoryEvent } from './events.js';

type ProcessResult = { status: 'applied' | 'rejected'; reason?: string | null; duplicate?: boolean };

export async function applyEvent(event: InventoryEvent): Promise<ProcessResult> {
  return transaction(async client => {
    await client.query('INSERT INTO products(id) VALUES ($1) ON CONFLICT DO NOTHING', [event.product_id]);
    const product = await client.query<{ last_event_at: Date | null }>('SELECT last_event_at FROM products WHERE id = $1 FOR UPDATE', [event.product_id]);
    const existing = await client.query<{ status: 'applied' | 'rejected'; reason: string | null }>('SELECT status, reason FROM processed_events WHERE event_id = $1', [event.event_id]);
    if (existing.rowCount) return { duplicate: true, ...existing.rows[0] };

    let reason = null;
    if (product.rows[0].last_event_at && new Date(event.timestamp) < product.rows[0].last_event_at) {
      reason = 'out_of_order_event';
    }

    let allocation: ReturnType<typeof allocateFifo> | undefined;
    if (!reason && event.event_type === 'sale') {
      const batches = await client.query<InventoryBatch>(
        'SELECT id, remaining_quantity, unit_price FROM inventory_batches WHERE product_id = $1 AND remaining_quantity > 0 ORDER BY occurred_at, id FOR UPDATE',
        [event.product_id]
      );
      allocation = allocateFifo(batches.rows, event.quantity);
      if (allocation.remaining > 0) reason = 'insufficient_stock';
    }

    const inserted = await client.query(
      'INSERT INTO processed_events(event_id, product_id, event_type, status, reason, occurred_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
      [event.event_id, event.product_id, event.event_type, reason ? 'rejected' : 'applied', reason, event.timestamp]
    );
    if (!inserted.rowCount) {
      const prior = await client.query<{ status: 'applied' | 'rejected'; reason: string | null }>('SELECT status,reason FROM processed_events WHERE event_id=$1', [event.event_id]);
      return { duplicate: true, ...prior.rows[0] };
    }
    if (reason) {
      if (reason === 'insufficient_stock') {
        await client.query('UPDATE products SET last_event_at = $1 WHERE id = $2', [event.timestamp, event.product_id]);
      }
      return { status: 'rejected', reason };
    }

    if (event.event_type === 'purchase') {
      await client.query(
        'INSERT INTO inventory_batches(product_id,event_id,original_quantity,remaining_quantity,unit_price,occurred_at) VALUES ($1,$2,$3,$3,$4,$5)',
        [event.product_id, event.event_id, event.quantity, event.unit_price, event.timestamp]
      );
    } else {
      if (!allocation) throw new Error('Sale allocation was not calculated');
      const sale = await client.query(
        'INSERT INTO sales(product_id,event_id,quantity,total_cost,occurred_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [event.product_id, event.event_id, event.quantity, allocation.totalCost, event.timestamp]
      );
      for (const row of allocation.allocations) {
        await client.query('UPDATE inventory_batches SET remaining_quantity = remaining_quantity - $1 WHERE id = $2', [row.quantity, row.batchId]);
        await client.query(
          'INSERT INTO sale_allocations(sale_id,batch_id,quantity,unit_price,cost) VALUES ($1,$2,$3,$4,$5)',
          [sale.rows[0].id, row.batchId, row.quantity, row.unitPrice, row.cost]
        );
      }
    }
    await client.query('UPDATE products SET last_event_at = $1 WHERE id = $2', [event.timestamp, event.product_id]);
    return { status: 'applied' };
  });
}
