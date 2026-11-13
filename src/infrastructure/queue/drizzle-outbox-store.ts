import { and, asc, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  OUTBOX_LAST_ERROR_MAX_LENGTH,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEvent,
  type OutboxFailureOutcome,
  type OutboxStore,
} from '../../application/ports/outbox-store.ts';
import { db } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';

function truncateError(error: string): string {
  return error.length > OUTBOX_LAST_ERROR_MAX_LENGTH
    ? error.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH)
    : error;
}

export class DrizzleOutboxStore implements OutboxStore {
  async claimPending(limit: number): Promise<OutboxEvent[]> {
    return db
      .select({
        id: outboxEvents.id,
        type: outboxEvents.type,
        payload: outboxEvents.payload,
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.status, 'pending'),
          isNull(outboxEvents.publishedAt),
          lt(outboxEvents.attempts, OUTBOX_MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await db
      .update(outboxEvents)
      .set({ publishedAt, status: 'published' })
      .where(
        and(
          eq(outboxEvents.id, eventId),
          eq(outboxEvents.status, 'pending'),
          isNull(outboxEvents.publishedAt),
        ),
      );
  }

  async markFailed(eventId: string, error: string): Promise<OutboxFailureOutcome> {
    const [row] = await db
      .update(outboxEvents)
      .set({
        attempts: sql`${outboxEvents.attempts} + 1`,
        lastError: truncateError(error),
      })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, 'pending')))
      .returning({ attempts: outboxEvents.attempts });
    const attempts = row?.attempts ?? OUTBOX_MAX_ATTEMPTS;
    return attempts >= OUTBOX_MAX_ATTEMPTS ? 'exhausted' : 'retry';
  }

  async markDead(eventId: string, error: string): Promise<boolean> {
    const [row] = await db
      .update(outboxEvents)
      .set({ status: 'dead', lastError: truncateError(error) })
      .where(and(eq(outboxEvents.id, eventId), ne(outboxEvents.status, 'dead')))
      .returning({ id: outboxEvents.id });
    return row !== undefined;
  }

  async countPending(): Promise<number> {
    const [row] = await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'pending'));
    return row?.pending ?? 0;
  }

  async countDead(): Promise<number> {
    const [row] = await db
      .select({ dead: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(eq(outboxEvents.status, 'dead'));
    return row?.dead ?? 0;
  }
}
