import { Worker } from 'bullmq';
import { DrizzlePriceRepository } from '../database/price-repository-drizzle.ts';
import { DrizzleOutboxStore } from './drizzle-outbox-store.ts';
import { RedisCache } from '../cache/redis-cache.ts';
import { logger } from '../observability/logger.ts';
import { getQueueRedis } from './price-queue.ts';
import { processPriceJob } from './process-price-job.ts';

const repository = new DrizzlePriceRepository();
const outbox = new DrizzleOutboxStore();
const cache = new RedisCache();
export const priceWorker = new Worker(
  'price-ingestion',
  async (job) => processPriceJob(job.data, job.id, { repository, cache, outbox }),
  { connection: getQueueRedis(), concurrency: 10 },
);

priceWorker.on('completed', (job) => logger.info({ jobId: job.id }, 'price_ingested'));
priceWorker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, err: error }, 'price_ingestion_failed'),
);
priceWorker.on('closed', () => {
  void cache.close();
});
