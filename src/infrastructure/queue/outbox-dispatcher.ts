import { eq, sql } from 'drizzle-orm';
import type { PriceProps } from '../../domain/prices/price.ts';
import { db } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';
import { logger } from '../observability/logger.ts';
import { getPriceQueue } from './price-queue.ts';

let stopping = false;
export function stopOutboxDispatcher(): void {
  stopping = true;
}

export async function runOutboxDispatcher(): Promise<void> {
  while (!stopping) {
    const events = await db.transaction(async (tx) =>
      tx
        .select()
        .from(outboxEvents)
        .where(sql`${outboxEvents.publishedAt} is null`)
        .orderBy(outboxEvents.createdAt)
        .limit(50)
        .for('update', { skipLocked: true }),
    );
    if (!events.length) {
      await Bun.sleep(500);
      continue;
    }
    for (const event of events) {
      try {
        if (event.type !== 'price.record') {
          throw new Error(`Tipo de evento de outbox não suportado: ${event.type}`);
        }
        await getPriceQueue().add('record-price', event.payload as PriceProps, { jobId: event.id });
        await db
          .update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(eq(outboxEvents.id, event.id));
      } catch (error) {
        logger.error({ eventId: event.id, err: error }, 'outbox_dispatch_failed');
        await Bun.sleep(1_000);
        break;
      }
    }
  }
}
