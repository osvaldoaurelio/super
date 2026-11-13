import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { PriceJobQueue } from '../../application/ports/price-job-queue.ts';
import type { PriceProps } from '../../domain/prices/price.ts';
import { env } from '../../config/env.ts';
import { db } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';

let connection: Redis | undefined;
let queue: Queue<PriceProps> | undefined;
export function getQueueRedis(): Redis {
  connection ??= new Redis(env.REDIS_QUEUE_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  return connection;
}
export function getPriceQueue(): Queue<PriceProps> {
  queue ??= new Queue<PriceProps>('price-ingestion', {
    connection: getQueueRedis(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800 },
    },
  });
  return queue;
}
export class BullPriceQueue implements PriceJobQueue {
  async enqueue(price: PriceProps): Promise<void> {
    await db
      .insert(outboxEvents)
      .values({ type: 'price.record', payload: price, idempotencyKey: price.idempotencyKey })
      .onConflictDoNothing();
  }
}
