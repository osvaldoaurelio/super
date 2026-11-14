import type { PriceJobQueue } from '../../application/ports/price-job-queue.ts';
import type { PriceProps } from '../../domain/prices/price.ts';
import { db } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';

export class OutboxPriceQueue implements PriceJobQueue {
  async enqueue(price: PriceProps): Promise<void> {
    await db
      .insert(outboxEvents)
      .values({ type: 'price.record', payload: price, idempotencyKey: price.idempotencyKey })
      .onConflictDoNothing();
  }
}
