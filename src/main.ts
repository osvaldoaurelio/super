import { env } from './config/env.ts';
import { createApp } from './http/app.ts';
import { logger } from './infrastructure/observability/logger.ts';
import { startTracing, stopTracing } from './infrastructure/observability/tracing.ts';
import { closeDatabase } from './infrastructure/database/client.ts';
import { RedisCache } from './infrastructure/cache/redis-cache.ts';

startTracing();
const server = Bun.serve({ fetch: createApp().fetch, port: env.PORT, hostname: '0.0.0.0' });
logger.info({ port: server.port }, 'server_started');
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown_started');
  server.stop(true);
  await Promise.allSettled([closeDatabase(), new RedisCache().close(), stopTracing()]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
