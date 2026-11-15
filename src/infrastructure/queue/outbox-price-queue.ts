import { createHash } from 'node:crypto';
import type { PriceJobQueue } from '../../application/ports/price-job-queue.ts';
import type { PriceProps } from '../../domain/prices/price.ts';
import { db } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';

function getScopedIdempotencyKey(source: string, idempotencyKey: string): string {
  return createHash('sha256')
    .update(JSON.stringify([source, idempotencyKey]))
    .digest('hex');
}

export class OutboxPriceQueue implements PriceJobQueue {
  async enqueue(price: PriceProps): Promise<void> {
    await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: price,
        idempotencyKey: getScopedIdempotencyKey(price.source, price.idempotencyKey),
      })
      .onConflictDoNothing({
        target: [outboxEvents.type, outboxEvents.idempotencyKey],
      });
  }
}
