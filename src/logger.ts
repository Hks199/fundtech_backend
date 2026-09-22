import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'authorization', 'password', 'token', 'KAFKA_SASL_PASSWORD', 'KAFKA_CA_CERT_BASE64', 'KAFKA_CLIENT_CERT_BASE64', 'KAFKA_CLIENT_KEY_BASE64', 'JWT_SECRET'],
    censor: '[redacted]'
  }
});
