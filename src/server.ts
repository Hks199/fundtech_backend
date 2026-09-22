import { config } from './config.js';
import { logger } from './logger.js';
import { kafka } from './kafka.js';
import { pool } from './db.js';
import { createApp } from './app.js';

const producer = kafka.producer({ allowAutoTopicCreation: false });
try {
  await producer.connect();
} catch (error) {
  logger.error({ brokers: config.kafkaBrokers, error: error instanceof Error ? error.message : String(error) },
    'Cannot start API: Kafka is unavailable. Start the local services with docker compose up -d, or correct KAFKA_BROKERS.');
  await pool.end();
  process.exit(1);
}
const server = createApp(producer).listen(config.PORT, () => logger.info({ port: config.PORT }, 'API listening'));

async function shutdown() {
  logger.info('Shutting down API');
  server.close();
  await producer.disconnect();
  await pool.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
