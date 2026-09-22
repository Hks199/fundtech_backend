import { Decimal } from 'decimal.js';

export interface InventoryBatch {
  id: string | number;
  remaining_quantity: number;
  unit_price: string;
}

export function allocateFifo(batches: InventoryBatch[], quantity: number) {
  let remaining = quantity;
  let total = new Decimal(0);
  const allocations = [];
  for (const batch of batches) {
    if (remaining === 0) break;
    const used = Math.min(remaining, Number(batch.remaining_quantity));
    if (used <= 0) continue;
    const cost = new Decimal(batch.unit_price).mul(used);
    allocations.push({ batchId: batch.id, quantity: used, unitPrice: batch.unit_price, cost: cost.toFixed(4) });
    total = total.plus(cost);
    remaining -= used;
  }
  return { allocations, totalCost: total.toFixed(4), remaining };
}
