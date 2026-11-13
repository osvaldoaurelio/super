import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url().default('postgres://super:super@localhost:5432/super'),
    REDIS_CACHE_URL: z.string().url().default('redis://localhost:6379/0'),
    REDIS_QUEUE_URL: z.string().url().default('redis://localhost:6380/0'),
    JWT_SECRET: z.string().min(32).default('dev-only-change-me-with-at-least-32-characters'),
    JWT_ISSUER: z.string().default('super-api'),
    JWT_AUDIENCE: z.string().default('super-api-clients'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      value.JWT_SECRET === 'dev-only-change-me-with-at-least-32-characters'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET deve ser substituído em produção.',
      });
    }
  });

export const env = envSchema.parse(process.env);
