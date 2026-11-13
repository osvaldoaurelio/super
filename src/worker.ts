import { closeDatabase } from './infrastructure/database/client.ts';
import { getQueueRedis, getPriceQueue } from './infrastructure/queue/price-queue.ts';
import { priceWorker } from './infrastructure/queue/price-worker.ts';
import {
  runOutboxDispatcher,
  stopOutboxDispatcher,
} from './infrastructure/queue/outbox-dispatcher.ts';
import { logger } from './infrastructure/observability/logger.ts';
import { startTracing, stopTracing } from './infrastructure/observability/tracing.ts';

startTracing();
const dispatcher = runOutboxDispatcher().catch((error: unknown) =>
  logger.fatal({ err: error }, 'outbox_dispatcher_stopped'),
);
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker_shutdown_started');
  stopOutboxDispatcher();
  await Promise.race([dispatcher, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
  await Promise.allSettled([
    priceWorker.close(),
    getPriceQueue().close(),
    getQueueRedis().quit(),
    closeDatabase(),
    stopTracing(),
  ]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
priceWorker.on('ready', () => logger.info('price_worker_ready'));
