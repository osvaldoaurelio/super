import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/client.ts';
import {
  currentPrices,
  outboxEvents,
  priceHistory,
  products,
  stores,
} from '../../src/infrastructure/database/schema.ts';
import { closeDatabase } from '../../src/infrastructure/database/client.ts';
import { Price } from '../../src/domain/prices/price.ts';
import { DrizzlePriceRepository } from '../../src/infrastructure/database/price-repository-drizzle.ts';
import { OutboxPriceQueue } from '../../src/infrastructure/queue/outbox-price-queue.ts';
import { DrizzleOutboxStore } from '../../src/infrastructure/queue/drizzle-outbox-store.ts';
import { processPendingOutboxBatch } from '../../src/infrastructure/queue/outbox-processor.ts';
import { DrizzlePriceAlertRepository } from '../../src/infrastructure/database/price-alert-repository-drizzle.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;
describeIntegration('DrizzlePriceRepository (PostgreSQL)', () => {
  const repository = new DrizzlePriceRepository();
  const outbox = new DrizzleOutboxStore();
  const alertsRepository = new DrizzlePriceAlertRepository();
  let productId = '';
  let storeId = '';
  let staleStoreId = '';
  const duplicateChainStoreIds: string[] = [];
  const auxiliaryProductIds: string[] = [];
  const outboxIds: string[] = [];

  function processorDeps() {
    return {
      store: outbox,
      repository,
      alerts: alertsRepository,
      cache: { bumpVersion: async () => 1, set: async () => {} },
      now: () => new Date(),
    };
  }

  async function drainPriceRecordedEvents(parentEventIds: string[]): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const events = await db
        .select({ id: outboxEvents.id, status: outboxEvents.status })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.type, 'price.recorded'),
            inArray(outboxEvents.idempotencyKey, parentEventIds),
          ),
        );
      outboxIds.push(...events.map((event) => event.id));
      if (events.every((event) => event.status === 'processed')) return;
      await processPendingOutboxBatch(processorDeps());
    }
    throw new Error('Os eventos PriceRecorded não foram consumidos.');
  }

  beforeAll(async () => {
    await runIntegrationSetup();
    const [product] = await db
      .insert(products)
      .values({
        name: 'Leite teste',
        category: 'Laticínios',
        unit: '1 L',
        unitMeasure: 'ml',
        unitQuantity: 1000,
      })
      .returning();
    const [store] = await db
      .insert(stores)
      .values({ name: 'Loja de teste', chain: 'Rede', city: 'São Paulo', state: 'SP' })
      .returning();
    if (!product || !store) throw new Error('Fixtures indisponíveis.');
    productId = product.id;
    storeId = store.id;
  });
  afterAll(async () => {
    if (outboxIds.length) {
      const recordedEvents = await db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.type, 'price.recorded'),
            inArray(outboxEvents.idempotencyKey, outboxIds),
          ),
        );
      outboxIds.push(...recordedEvents.map((event) => event.id));
    }
    if (productId) {
      await db.delete(currentPrices).where(eq(currentPrices.productId, productId));
      await db.delete(priceHistory).where(eq(priceHistory.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    if (auxiliaryProductIds.length) {
      await db.delete(currentPrices).where(inArray(currentPrices.productId, auxiliaryProductIds));
      await db.delete(priceHistory).where(inArray(priceHistory.productId, auxiliaryProductIds));
      await db.delete(products).where(inArray(products.id, auxiliaryProductIds));
    }
    if (staleStoreId) await db.delete(stores).where(eq(stores.id, staleStoreId));
    if (duplicateChainStoreIds.length)
      await db.delete(stores).where(inArray(stores.id, duplicateChainStoreIds));
    if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
    if (outboxIds.length) await db.delete(outboxEvents).where(inArray(outboxEvents.id, outboxIds));
    await closeDatabase();
  });
  it('persists observations and returns comparison and history in centavos', async () => {
    const observedAt = new Date();
    await repository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 725,
        observedAt,
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const offers = await repository.compare(productId, { state: 'SP' });
    expect(offers[0]?.priceCents).toBe(725);
    const history = await repository.history(productId, new Date(Date.now() - 60_000), 20);
    expect(history.some((item) => item.priceCents === 725)).toBe(true);
  });

  it('paginates history by timestamp and ID without repeating observations', async () => {
    const [paginationProduct] = await db
      .insert(products)
      .values({ name: 'Produto para paginação', category: 'Teste', unit: '1 un' })
      .returning({ id: products.id });
    if (!paginationProduct) throw new Error('Produto de paginação indisponível.');
    auxiliaryProductIds.push(paginationProduct.id);
    const observedAt = new Date(Date.now() - 60_000);
    for (const priceCents of [510, 520, 530]) {
      await repository.record(
        Price.create({
          productId: paginationProduct.id,
          storeId,
          priceCents,
          observedAt,
          source: 'pagination-test',
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }

    const firstPage = await repository.history(
      paginationProduct.id,
      new Date(observedAt.getTime() - 1_000),
      2,
    );
    const last = firstPage.at(-1);
    if (!last) throw new Error('Primeira página vazia.');
    const secondPage = await repository.history(
      paginationProduct.id,
      new Date(observedAt.getTime() - 1_000),
      2,
      {
        observedAt: last.observedAt,
        id: last.id,
      },
    );

    expect(firstPage).toHaveLength(2);
    expect(secondPage).toHaveLength(1);
    expect(new Set([...firstPage, ...secondPage].map((point) => point.id)).size).toBe(3);
  });

  it('returns at most one cheapest offer per store chain', async () => {
    const duplicateStores = await db
      .insert(stores)
      .values([
        { name: 'Rede Duplicada A', chain: 'Rede Duplicada', city: 'Campinas', state: 'SP' },
        { name: 'Rede Duplicada B', chain: 'Rede Duplicada', city: 'Campinas', state: 'SP' },
      ])
      .returning();
    duplicateChainStoreIds.push(...duplicateStores.map((store) => store.id));
    const observedAt = new Date();
    for (const [index, store] of duplicateStores.entries()) {
      await repository.record(
        Price.create({
          productId,
          storeId: store.id,
          priceCents: index === 0 ? 450 : 400,
          observedAt,
          source: 'chain-dedup-test',
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }

    const offers = await repository.compare(productId, {}, 100);
    const chainOffers = offers.filter((offer) => duplicateChainStoreIds.includes(offer.storeId));

    expect(chainOffers).toHaveLength(1);
    expect(chainOffers[0]).toMatchObject({
      storeId: duplicateChainStoreIds[1],
      priceCents: 400,
    });
  });
  it('does not replace a current price with an older observation', async () => {
    const old = new Date(Date.now() - 86_400_000);
    const latest = new Date();
    await repository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 800,
        observedAt: latest,
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await repository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 200,
        observedAt: old,
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const offers = await repository.compare(productId, { city: 'São Paulo' });
    expect(offers[0]?.priceCents).toBe(800);
  });

  it('records promotional prices without replacing the regular current price', async () => {
    await repository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 800,
        observedAt: new Date(),
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await repository.record(
      Price.create({
        productId,
        storeId,
        priceCents: 500,
        priceType: 'promo',
        observedAt: new Date(),
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );

    const [current] = await db
      .select({ priceCents: currentPrices.priceCents, priceType: currentPrices.priceType })
      .from(currentPrices)
      .where(and(eq(currentPrices.productId, productId), eq(currentPrices.storeId, storeId)));
    const history = await repository.history(productId, new Date(Date.now() - 60_000), 20);

    expect(current).toMatchObject({ priceCents: 800, priceType: 'regular' });
    expect(history.some((point) => point.priceType === 'promo' && point.priceCents === 500)).toBe(
      true,
    );
  });

  it('does not return current prices outside the freshness window', async () => {
    const [staleStore] = await db
      .insert(stores)
      .values({ name: 'Loja desatualizada', chain: 'Rede', city: 'São Paulo', state: 'SP' })
      .returning();
    if (!staleStore) throw new Error('Fixture indisponível.');
    staleStoreId = staleStore.id;
    await repository.record(
      Price.create({
        productId,
        storeId: staleStoreId,
        priceCents: 100,
        observedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
        source: 'test',
        idempotencyKey: crypto.randomUUID(),
      }),
    );

    const offers = await repository.compare(productId);

    expect(offers.some((offer) => offer.storeId === staleStoreId)).toBe(false);
  });

  it('isolates permanent failures while processing the rest of the batch', async () => {
    const missingProductId = crypto.randomUUID();
    const missingPayload = {
      productId: missingProductId,
      storeId,
      priceCents: 500,
      observedAt: new Date().toISOString(),
      source: 'test',
      idempotencyKey: crypto.randomUUID(),
    };
    const [event] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: missingPayload,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error('Fixture de outbox indisponível.');
    outboxIds.push(event.id);

    const validPayload = {
      ...missingPayload,
      productId,
      idempotencyKey: crypto.randomUUID(),
    };
    const [validEvent] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: validPayload,
        idempotencyKey: crypto.randomUUID(),
      })
      .returning({ id: outboxEvents.id });
    if (!validEvent) throw new Error('Fixture válida de outbox indisponível.');
    outboxIds.push(validEvent.id);

    await expect(
      processPendingOutboxBatch({
        store: outbox,
        repository,
        alerts: alertsRepository,
        cache: { bumpVersion: async () => 1, set: async () => {} },
        now: () => new Date(),
      }),
    ).resolves.toMatchObject({ claimed: 2 });

    const rows = await db
      .select({ status: outboxEvents.status, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, [event.id, validEvent.id]));
    expect(rows.find((row) => row.status === 'dead')?.lastError).toBeTruthy();
    expect(rows.find((row) => row.status === 'processed')).toBeDefined();
    await drainPriceRecordedEvents([event.id, validEvent.id]);
  });

  it('does not duplicate history when a processed outbox event is replayed', async () => {
    const idempotencyKey = crypto.randomUUID();
    const [event] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: {
          productId,
          storeId,
          priceCents: 640,
          observedAt: new Date().toISOString(),
          source: 'test',
          idempotencyKey,
        },
        idempotencyKey: crypto.randomUUID(),
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error('Fixture de outbox indisponível.');
    outboxIds.push(event.id);
    const deps = processorDeps();

    await expect(processPendingOutboxBatch(deps)).resolves.toMatchObject({ claimed: 1 });
    await db
      .update(outboxEvents)
      .set({ status: 'pending', processedAt: null, attempts: 0 })
      .where(eq(outboxEvents.id, event.id));
    await expect(processPendingOutboxBatch(deps)).resolves.toMatchObject({ claimed: 2 });

    const historyRows = await db
      .select({ id: priceHistory.id })
      .from(priceHistory)
      .where(eq(priceHistory.idempotencyKey, idempotencyKey));
    expect(historyRows).toHaveLength(1);
    await drainPriceRecordedEvents([event.id]);
  });

  it('records the same idempotency key independently for different sources', async () => {
    const idempotencyKey = crypto.randomUUID();
    const sourceA = 'source-a';
    const sourceB = 'source-b';
    const queue = new OutboxPriceQueue();
    const observedAt = new Date().toISOString();
    const price = {
      productId,
      storeId,
      priceCents: 640,
      observedAt: new Date(observedAt),
      idempotencyKey,
    };

    await queue.enqueue({ ...price, source: sourceA });
    await queue.enqueue({ ...price, source: sourceA });
    await queue.enqueue({ ...price, source: sourceB });

    const events = await db
      .select({ id: outboxEvents.id, payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        sql`${outboxEvents.type} = 'price.record' and ${outboxEvents.payload}->'price'->>'idempotencyKey' = ${idempotencyKey}`,
      );
    outboxIds.push(...events.map((event) => event.id));
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({
      version: 1,
      price: { idempotencyKey },
    });

    await expect(processPendingOutboxBatch(processorDeps())).resolves.toMatchObject({ claimed: 2 });

    const historyRows = await db
      .select({ source: priceHistory.source })
      .from(priceHistory)
      .where(eq(priceHistory.idempotencyKey, idempotencyKey));
    expect(historyRows.map((row) => row.source).sort()).toEqual([sourceA, sourceB].sort());
    await drainPriceRecordedEvents(events.map((event) => event.id));
  });

  it('records a transient failure and leaves its event retryable', async () => {
    const [event] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: {
          productId,
          storeId,
          priceCents: 640,
          observedAt: new Date().toISOString(),
          source: 'test',
          idempotencyKey: crypto.randomUUID(),
        },
        idempotencyKey: crypto.randomUUID(),
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error('Fixture de outbox indisponível.');
    outboxIds.push(event.id);

    await expect(
      processPendingOutboxBatch({
        ...processorDeps(),
        repository: {
          recordInTransaction: async () => {
            throw new Error('Falha temporária de persistência.');
          },
        },
      }),
    ).resolves.toMatchObject({ claimed: 1, retryableFailures: 1 });

    const [row] = await db
      .select({
        status: outboxEvents.status,
        attempts: outboxEvents.attempts,
        lastError: outboxEvents.lastError,
      })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Falha temporária de persistência.',
    });
    await db.update(outboxEvents).set({ status: 'dead' }).where(eq(outboxEvents.id, event.id));
  });

  it('limits each processing batch to 200 events', async () => {
    const observedAt = new Date();
    const events = await db
      .insert(outboxEvents)
      .values(
        Array.from({ length: 201 }, (_, index) => {
          const idempotencyKey = crypto.randomUUID();
          return {
            type: 'price.record',
            payload: {
              productId,
              storeId,
              priceCents: 500 + index,
              observedAt: observedAt.toISOString(),
              source: 'test',
              idempotencyKey,
            },
            idempotencyKey: crypto.randomUUID(),
          };
        }),
      )
      .returning({ id: outboxEvents.id });
    outboxIds.push(...events.map((event) => event.id));
    const deps = processorDeps();

    await expect(processPendingOutboxBatch(deps)).resolves.toMatchObject({ claimed: 200 });
    await expect(processPendingOutboxBatch(deps)).resolves.toMatchObject({ claimed: 200 });
    await expect(processPendingOutboxBatch(deps)).resolves.toMatchObject({ claimed: 2 });
  });
});
