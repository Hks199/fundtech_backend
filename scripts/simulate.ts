import { randomUUID } from 'node:crypto';
import { kafka, publishEvent } from '../src/kafka.js';
import { logger } from '../src/logger.js';
import { parseEvent } from '../src/events.js';

const producer = kafka.producer({ allowAutoTopicCreation: false });
const product_id = process.argv[2] || 'PRD001';
const operations: Array<{ event_type: 'purchase'; quantity: number; unit_price: number } | { event_type: 'sale'; quantity: number }> = [
  { event_type: 'purchase', quantity: 10, unit_price: 100 },
  { event_type: 'purchase', quantity: 8, unit_price: 120 },
  { event_type: 'sale', quantity: 12 },
  { event_type: 'purchase', quantity: 20, unit_price: 110 },
  { event_type: 'sale', quantity: 5 },
  { event_type: 'purchase', quantity: 3, unit_price: 125 },
  { event_type: 'sale', quantity: 4 },
  { event_type: 'purchase', quantity: 7, unit_price: 130 }
];
try {
  await producer.connect();
  for (const [index, operation] of operations.entries()) {
    const event = parseEvent({ event_id: randomUUID(), product_id, ...operation,
      timestamp: new Date(Date.now() + index * 1000).toISOString(),
    });
    await publishEvent(producer, event);
    logger.info({ event }, 'Published');
  }
} finally {
  await producer.disconnect();
}
