import { Worker } from 'bullmq';
import { Price } from '../../domain/prices/price.ts';
import { DrizzlePriceRepository } from '../database/price-repository-drizzle.ts';
import { RedisCache } from '../cache/redis-cache.ts';
import { logger } from '../observability/logger.ts';
import { getQueueRedis } from './price-queue.ts';

const repository = new DrizzlePriceRepository();
const cache = new RedisCache();
export const priceWorker = new Worker(
  'price-ingestion',
  async (job) => {
    const price = Price.create({ ...job.data, observedAt: new Date(job.data.observedAt) });
    await repository.record(price);
    await cache.deleteByPrefix(`prices:v1:${price.props.productId}:`);
    await cache.deleteByPrefix(`history:v1:${price.props.productId}:`);
    return { stored: true };
  },
  { connection: getQueueRedis(), concurrency: 10 },
);

priceWorker.on('completed', (job) => logger.info({ jobId: job.id }, 'price_ingested'));
priceWorker.on('failed', (job, error) =>
  logger.error({ jobId: job?.id, err: error }, 'price_ingestion_failed'),
);
priceWorker.on('closed', () => {
  void cache.close();
});
