import { z } from 'zod';
import { Decimal } from 'decimal.js';

const common = {
  event_id: z.uuid(),
  product_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  quantity: z.number().int().positive().max(100000000),
  timestamp: z.iso.datetime({ offset: true })
};
export const eventSchema = z.discriminatedUnion('event_type', [
  z.strictObject({ ...common, event_type: z.literal('purchase'), unit_price: z.number().finite().min(0).max(99999999999999).refine(x => new Decimal(x).decimalPlaces() <= 4, 'At most four decimal places') }),
  z.strictObject({ ...common, event_type: z.literal('sale') })
]);
export type InventoryEvent = z.infer<typeof eventSchema>;

export function parseEvent(value: unknown): InventoryEvent {
  return eventSchema.parse(value);
}
