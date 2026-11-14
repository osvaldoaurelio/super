import { and, asc, eq, lt, sql } from 'drizzle-orm';
import {
  OUTBOX_LAST_ERROR_MAX_LENGTH,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEvent,
  type OutboxFailureOutcome,
} from './outbox-types.ts';
import { db, type DatabaseTransaction } from '../database/client.ts';
import { outboxEvents } from '../database/schema.ts';

function truncateError(error: string): string {
  return error.length > OUTBOX_LAST_ERROR_MAX_LENGTH
    ? error.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH)
    : error;
}

export class DrizzleOutboxStore {
  async claimPending(tx: DatabaseTransaction, limit: number): Promise<OutboxEvent[]> {
    return tx
      .select({
        id: outboxEvents.id,
        type: outboxEvents.type,
        payload: outboxEvents.payload,
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.status, 'pending'), lt(outboxEvents.attempts, OUTBOX_MAX_ATTEMPTS)),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });
  }

  async markProcessed(tx: DatabaseTransaction, eventId: string, processedAt: Date): Promise<void> {
    await tx
      .update(outboxEvents)
      .set({ processedAt, status: 'processed' })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, 'pending')));
  }

  async markFailed(
    tx: DatabaseTransaction,
    eventId: string,
    error: string,
  ): Promise<OutboxFailureOutcome> {
    const [row] = await tx
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

  async markDead(tx: DatabaseTransaction, eventId: string, error: string): Promise<boolean> {
    const [row] = await tx
      .update(outboxEvents)
      .set({ status: 'dead', lastError: truncateError(error) })
      .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, 'pending')))
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
