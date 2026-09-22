import { kafka } from '../src/kafka.js';
import { config } from '../src/config.js';
import { logger } from '../src/logger.js';

const admin = kafka.admin();
try {
  await admin.connect();
  await admin.createTopics({ waitForLeaders: true, topics: [
    { topic: config.KAFKA_TOPIC, numPartitions: config.KAFKA_TOPIC_PARTITIONS },
    { topic: `${config.KAFKA_TOPIC}-invalid`, numPartitions: config.KAFKA_TOPIC_PARTITIONS }
  ] });
  logger.info('Kafka topics ready');
} finally {
  await admin.disconnect();
}
