import { createHash } from 'node:crypto';
import { context, propagation } from '@opentelemetry/api';
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
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: {
          version: 1,
          price: {
            ...price,
            priceType: price.priceType ?? 'regular',
            observedAt: price.observedAt.toISOString(),
          },
          ...(carrier['traceparent'] ? { traceparent: carrier['traceparent'] } : {}),
        },
        idempotencyKey: getScopedIdempotencyKey(price.source, price.idempotencyKey),
      })
      .onConflictDoNothing({
        target: [outboxEvents.type, outboxEvents.idempotencyKey],
      });
  }
}
