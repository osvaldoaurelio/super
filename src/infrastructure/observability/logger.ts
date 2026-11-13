import pino from 'pino';
import { env } from '../../config/env.ts';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'super-api', environment: env.NODE_ENV },
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.passwordHash'],
    censor: '[REDACTED]',
  },
});
