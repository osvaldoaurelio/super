import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import type {
  CreatePriceAlertInput,
  PriceAlertRepository,
  UpdatePriceAlertInput,
} from '../../application/ports/price-alert-repository.ts';
import type { DatabaseTransaction } from './client.ts';
import { db } from './client.ts';
import { alerts, outboxEvents } from './schema.ts';
import type { PriceRecordedEvent } from '../queue/price-recorded.ts';

const PriceAlertChannelSchema = z.enum(['email', 'push']);

function parseChannel<T extends { channel: string }>(
  alert: T,
): Omit<T, 'channel'> & { channel: 'email' | 'push' } {
  return { ...alert, channel: PriceAlertChannelSchema.parse(alert.channel) };
}

export class DrizzlePriceAlertRepository implements PriceAlertRepository {
  async listByUser(userId: string) {
    const result = await db
      .select({
        id: alerts.id,
        productId: alerts.productId,
        targetPriceCents: alerts.targetPriceCents,
        active: alerts.active,
        channel: alerts.channel,
        createdAt: alerts.createdAt,
        triggeredAt: alerts.triggeredAt,
      })
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(asc(alerts.createdAt), asc(alerts.id));
    return result.map(parseChannel);
  }

  async create(input: CreatePriceAlertInput) {
    const [alert] = await db.insert(alerts).values(input).returning({
      id: alerts.id,
      productId: alerts.productId,
      targetPriceCents: alerts.targetPriceCents,
      active: alerts.active,
      channel: alerts.channel,
      createdAt: alerts.createdAt,
      triggeredAt: alerts.triggeredAt,
    });
    if (!alert) throw new Error('Falha ao criar alerta de preço.');
    return parseChannel(alert);
  }

  async update(userId: string, alertId: string, input: UpdatePriceAlertInput) {
    const values: UpdatePriceAlertInput & { triggeredAt?: Date | null } = { ...input };
    if (input.active === true) values.triggeredAt = null;
    const [alert] = await db
      .update(alerts)
      .set(values)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning({
        id: alerts.id,
        productId: alerts.productId,
        targetPriceCents: alerts.targetPriceCents,
        active: alerts.active,
        channel: alerts.channel,
        createdAt: alerts.createdAt,
        triggeredAt: alerts.triggeredAt,
      });
    return alert ? parseChannel(alert) : null;
  }

  async delete(userId: string, alertId: string): Promise<boolean> {
    const deleted = await db
      .delete(alerts)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning({ id: alerts.id });
    return deleted.length > 0;
  }

  async evaluatePriceRecorded(
    tx: DatabaseTransaction,
    eventId: string,
    event: PriceRecordedEvent,
    now: Date,
  ): Promise<void> {
    if (
      !event.currentPriceUpdated ||
      event.previousPriceCents === null ||
      event.priceCents >= event.previousPriceCents
    ) {
      return;
    }

    const candidates = await tx
      .select({
        id: alerts.id,
        userId: alerts.userId,
        productId: alerts.productId,
        targetPriceCents: alerts.targetPriceCents,
        channel: alerts.channel,
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.productId, event.productId),
          eq(alerts.active, true),
          lt(alerts.targetPriceCents, event.previousPriceCents),
          gte(alerts.targetPriceCents, event.priceCents),
        ),
      );

    for (const candidate of candidates) {
      const [triggered] = await tx
        .update(alerts)
        .set({ active: false, triggeredAt: now })
        .where(and(eq(alerts.id, candidate.id), eq(alerts.active, true)))
        .returning({ id: alerts.id });
      if (!triggered) continue;

      await tx
        .insert(outboxEvents)
        .values({
          type: 'price.alert.triggered',
          payload: {
            alertId: candidate.id,
            userId: candidate.userId,
            productId: candidate.productId,
            storeId: event.storeId,
            targetPriceCents: candidate.targetPriceCents,
            priceCents: event.priceCents,
            channel: candidate.channel,
            triggeredAt: now.toISOString(),
          },
          idempotencyKey: `${eventId}:${candidate.id}`,
        })
        .onConflictDoNothing({
          target: [outboxEvents.type, outboxEvents.idempotencyKey],
        });
    }
  }
}
