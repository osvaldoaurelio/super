import { closeDatabase } from './infrastructure/database/client.ts';
import { RedisCache } from './infrastructure/cache/redis-cache.ts';
import { DrizzlePriceRepository } from './infrastructure/database/price-repository-drizzle.ts';
import { DrizzleOutboxStore } from './infrastructure/queue/drizzle-outbox-store.ts';
import { runOutboxWorker, stopOutboxWorker } from './infrastructure/queue/outbox-worker.ts';
import { logger } from './infrastructure/observability/logger.ts';
import { startTracing, stopTracing } from './infrastructure/observability/tracing.ts';

startTracing();
const cache = new RedisCache();
const worker = runOutboxWorker({
  store: new DrizzleOutboxStore(),
  repository: new DrizzlePriceRepository(),
  cache,
  now: () => new Date(),
}).catch((error: unknown) => logger.fatal({ err: error }, 'outbox_worker_stopped'));
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker_shutdown_started');
  stopOutboxWorker();
  try {
    await worker;
    await Promise.all([cache.close(), closeDatabase(), stopTracing()]);
    process.exit(0);
  } catch (error) {
    logger.fatal({ err: error }, 'worker_shutdown_failed');
    process.exit(1);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info('outbox_worker_ready');
