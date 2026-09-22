import { Kafka, logLevel } from 'kafkajs';
import type { Producer, SASLOptions } from 'kafkajs';
import type { InventoryEvent } from './events.js';
import { config } from './config.js';
import { logger } from './logger.js';

function decodeBase64(value: string | undefined): string | undefined {
  return value ? Buffer.from(value, 'base64').toString('utf8') : undefined;
}

const kafkaCa = decodeBase64(config.KAFKA_CA_CERT_BASE64);
const clientCert = decodeBase64(config.KAFKA_CLIENT_CERT_BASE64);
const clientKey = decodeBase64(config.KAFKA_CLIENT_KEY_BASE64);
if (kafkaCa && !kafkaCa.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error('KAFKA_CA_CERT_BASE64 must decode to a PEM CA certificate');
}
if (clientCert && !clientCert.includes('-----BEGIN CERTIFICATE-----')) {
  throw new Error('KAFKA_CLIENT_CERT_BASE64 must decode to a PEM client certificate');
}
if (clientKey && (!clientKey.includes('-----BEGIN') || !clientKey.includes('PRIVATE KEY-----'))) {
  throw new Error('KAFKA_CLIENT_KEY_BASE64 must decode to a PEM private key');
}

const ssl = config.kafkaSsl
  ? kafkaCa || clientCert || clientKey
    ? {
        rejectUnauthorized: true,
        ...(kafkaCa ? { ca: [kafkaCa] } : {}),
        ...(clientCert ? { cert: clientCert } : {}),
        ...(clientKey ? { key: clientKey } : {})
      }
    : true
  : false;

const sasl: SASLOptions | undefined = config.KAFKA_SASL_USERNAME && config.KAFKA_SASL_PASSWORD
  ? {
      mechanism: config.KAFKA_SASL_MECHANISM,
      username: config.KAFKA_SASL_USERNAME,
      password: config.KAFKA_SASL_PASSWORD
    } as SASLOptions
  : undefined;

export const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.kafkaBrokers,
  ssl,
  sasl,
  logLevel: logLevel.ERROR,
  logCreator: () => ({ namespace, label, log }) => logger.error({ namespace, label, message: log.message }, 'Kafka')
});

export async function publishEvent(producer: Pick<Producer, 'send'>, event: InventoryEvent): Promise<void> {
  await producer.send({ topic: config.KAFKA_TOPIC, messages: [{ key: event.product_id, value: JSON.stringify(event) }] });
}
