import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CLIENT_ID: z.string().min(1).default('inventory-backend'),
  KAFKA_GROUP_ID: z.string().min(1).default('inventory-consumer'),
  KAFKA_TOPIC: z.string().min(1).default('inventory-events'),
  KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().min(1).max(1000).default(3),
  KAFKA_SSL: z.enum(['true', 'false']).default('false'),
  KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).default('plain'),
  KAFKA_SASL_USERNAME: z.string().optional(),
  KAFKA_SASL_PASSWORD: z.string().optional(),
  KAFKA_CA_CERT_BASE64: z.string().optional(),
  KAFKA_CLIENT_CERT_BASE64: z.string().optional(),
  KAFKA_CLIENT_KEY_BASE64: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/),
  JWT_SECRET: z.string().min(32),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.string().default('info')
});

const result = schema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid configuration: ${result.error.issues.map(x => x.path.join('.')).join(', ')}`);
}
const raw = result.data;
if (Boolean(raw.KAFKA_SASL_USERNAME) !== Boolean(raw.KAFKA_SASL_PASSWORD)) {
  throw new Error('Both KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required together');
}
if (raw.KAFKA_SASL_USERNAME && raw.KAFKA_SSL !== 'true') {
  throw new Error('KAFKA_SSL must be true when SASL credentials are set');
}
if (raw.KAFKA_CA_CERT_BASE64 && raw.KAFKA_SSL !== 'true') {
  throw new Error('KAFKA_SSL must be true when KAFKA_CA_CERT_BASE64 is set');
}
if (Boolean(raw.KAFKA_CLIENT_CERT_BASE64) !== Boolean(raw.KAFKA_CLIENT_KEY_BASE64)) {
  throw new Error('Both KAFKA_CLIENT_CERT_BASE64 and KAFKA_CLIENT_KEY_BASE64 are required together');
}
if (raw.KAFKA_CLIENT_CERT_BASE64 && raw.KAFKA_SSL !== 'true') {
  throw new Error('KAFKA_SSL must be true when Kafka client certificates are set');
}
if (raw.KAFKA_CLIENT_CERT_BASE64 && raw.KAFKA_SASL_USERNAME) {
  throw new Error('Configure either Kafka client certificates or SASL credentials, not both');
}
if (raw.NODE_ENV === 'production' && (raw.DATABASE_SSL !== 'true' || raw.KAFKA_SSL !== 'true')) {
  throw new Error('Production requires database and Kafka TLS');
}

export const config = {
  ...raw,
  databaseSsl: raw.DATABASE_SSL === 'true',
  kafkaSsl: raw.KAFKA_SSL === 'true',
  trustProxy: raw.TRUST_PROXY === 'true',
  kafkaBrokers: raw.KAFKA_BROKERS.split(',').map(x => x.trim()).filter(Boolean),
  corsOrigins: raw.CORS_ORIGINS.split(',').map(x => x.trim()).filter(Boolean)
};
