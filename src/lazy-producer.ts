import type { Producer } from 'kafkajs';

export function lazyProducer(producer: Pick<Producer, 'connect' | 'send'>): Pick<Producer, 'send'> {
  let connection: Promise<void> | undefined;
  return {
    async send(record) {
      // Concurrent requests share initialization. A failed connection can retry
      // on the next request; KafkaJS handles reconnects after a successful start.
      connection ??= producer.connect().catch(error => {
        connection = undefined;
        throw error;
      });
      await connection;
      return producer.send(record);
    }
  };
}
