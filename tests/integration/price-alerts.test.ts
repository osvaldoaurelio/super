import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/infrastructure/database/client.ts';
import {
  alerts,
  currentPrices,
  outboxEvents,
  priceHistory,
  products,
  stores,
  users,
} from '../../src/infrastructure/database/schema.ts';
import { Price } from '../../src/domain/prices/price.ts';
import { DrizzlePriceRepository } from '../../src/infrastructure/database/price-repository-drizzle.ts';
import { DrizzlePriceAlertRepository } from '../../src/infrastructure/database/price-alert-repository-drizzle.ts';
import { DrizzleOutboxStore } from '../../src/infrastructure/queue/drizzle-outbox-store.ts';
import { OutboxPriceQueue } from '../../src/infrastructure/queue/outbox-price-queue.ts';
import { processPendingOutboxBatch } from '../../src/infrastructure/queue/outbox-processor.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;

describeIntegration('price alerts (PostgreSQL)', () => {
  const productRepository = new DrizzlePriceRepository();
  const alertRepository = new DrizzlePriceAlertRepository();
  const outboxStore = new DrizzleOutboxStore();
  const outboxIds: string[] = [];
  let userId = '';
  let productId = '';
  let storeId = '';
  let activeAlertId = '';
  let inactiveAlertId = '';

  beforeAll(async () => {
    await runIntegrationSetup();
    const [user] = await db
      .insert(users)
      .values({
        email: `price-alert-${crypto.randomUUID()}@example.test`,
        passwordHash: 'integration-test',
      })
      .returning({ id: users.id });
    const [product] = await db
      .insert(products)
      .values({ name: 'Produto para alerta', category: 'Teste', unit: 'un' })
      .returning({ id: products.id });
    const [store] = await db
      .insert(stores)
      .values({ name: 'Loja para alerta', chain: 'Teste', city: 'São Paulo', state: 'SP' })
      .returning({ id: stores.id });
    if (!user || !product || !store) throw new Error('Falha ao criar fixtures de alerta.');
    userId = user.id;
    productId = product.id;
    storeId = store.id;

    const [activeAlert] = await db
      .insert(alerts)
      .values({ userId, productId, targetPriceCents: 700, channel: 'email' })
      .returning({ id: alerts.id });
    const [inactiveAlert] = await db
      .insert(alerts)
      .values({ userId, productId, targetPriceCents: 700, channel: 'push', active: false })
      .returning({ id: alerts.id });
    if (!activeAlert || !inactiveAlert) throw new Error('Falha ao criar alertas de teste.');
    activeAlertId = activeAlert.id;
    inactiveAlertId = inactiveAlert.id;

    await productRepository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 1_000,
        observedAt: new Date(Date.now() - 60_000),
        source: 'alert-test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
  });

  afterAll(async () => {
    if (outboxIds.length) {
      await db.delete(outboxEvents).where(inArray(outboxEvents.id, outboxIds));
    }
    if (activeAlertId || inactiveAlertId) {
      await db
        .delete(alerts)
        .where(inArray(alerts.id, [activeAlertId, inactiveAlertId].filter(Boolean)));
    }
    if (productId) {
      await db.delete(currentPrices).where(eq(currentPrices.productId, productId));
      await db.delete(priceHistory).where(eq(priceHistory.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  });

  it('publishes a trigger only when an active threshold is crossed downward', async () => {
    const idempotencyKey = crypto.randomUUID();
    await new OutboxPriceQueue().enqueue({
      productId,
      storeId,
      priceCents: 600,
      observedAt: new Date(),
      source: 'alert-test',
      idempotencyKey,
    });

    const [priceEvent] = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'price.record'),
          sql`${outboxEvents.payload}->>'idempotencyKey' = ${idempotencyKey}`,
        ),
      );
    if (!priceEvent) throw new Error('Evento de preço não foi criado.');
    outboxIds.push(priceEvent.id);

    const processorDeps = {
      store: outboxStore,
      repository: productRepository,
      alerts: alertRepository,
      cache: { bumpVersion: async () => 1 },
      now: () => new Date(),
    };
    await processPendingOutboxBatch(processorDeps);

    const [recordedEvent] = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'price.recorded'),
          eq(outboxEvents.idempotencyKey, priceEvent.id),
        ),
      );
    if (!recordedEvent) throw new Error('Evento PriceRecorded não foi publicado.');
    outboxIds.push(recordedEvent.id);
    await processPendingOutboxBatch(processorDeps);

    const [activeAlert] = await db
      .select({ active: alerts.active, triggeredAt: alerts.triggeredAt })
      .from(alerts)
      .where(eq(alerts.id, activeAlertId));
    const [inactiveAlert] = await db
      .select({ active: alerts.active, triggeredAt: alerts.triggeredAt })
      .from(alerts)
      .where(eq(alerts.id, inactiveAlertId));
    const triggeredEvents = await db
      .select({ id: outboxEvents.id, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'price.alert.triggered'),
          sql`${outboxEvents.payload}->>'alertId' = ${activeAlertId}`,
        ),
      );
    outboxIds.push(...triggeredEvents.map((event) => event.id));

    expect(activeAlert?.active).toBe(false);
    expect(activeAlert?.triggeredAt).toBeInstanceOf(Date);
    expect(inactiveAlert).toMatchObject({ active: true, triggeredAt: null });
    expect(triggeredEvents).toHaveLength(1);
    expect(triggeredEvents[0]?.payload).toMatchObject({
      alertId: activeAlertId,
      targetPriceCents: 700,
      priceCents: 600,
      channel: 'email',
    });
  });
});
