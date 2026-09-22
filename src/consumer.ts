import { ZodError } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import { kafka } from './kafka.js';
import { pool } from './db.js';
import { parseEvent } from './events.js';
import { applyEvent } from './inventory.js';

const consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID, allowAutoTopicCreation: false });
const producer = kafka.producer({ allowAutoTopicCreation: false });
await producer.connect();
await consumer.connect();
await consumer.subscribe({ topic: config.KAFKA_TOPIC, fromBeginning: true });
logger.info({ topic: config.KAFKA_TOPIC }, 'Consumer started');

await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 3, eachMessage: async ({ topic, partition, message }) => {
  let event;
  try {
    event = parseEvent(JSON.parse(message.value?.toString('utf8') || ''));
    if (message.key?.toString('utf8') !== event.product_id) throw new Error('Kafka key must equal product_id');
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof ZodError || error instanceof Error && error.message === 'Kafka key must equal product_id')) throw error;
    await producer.send({ topic: `${config.KAFKA_TOPIC}-invalid`, messages: [{ key: message.key, value: message.value || Buffer.from(''), headers: { reason: Buffer.from('invalid_event') } }] });
    logger.warn({ topic, partition, offset: message.offset, err: error }, 'Invalid event sent to dead letter topic');
    await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    return;
  }
  const result = await applyEvent(event);
  logger.info({ eventId: event.event_id, productId: event.product_id, result }, 'Event processed');
  await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
} });

async function shutdown() {
  logger.info('Shutting down consumer');
  await consumer.disconnect();
  await producer.disconnect();
  await pool.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
