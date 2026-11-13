import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/infrastructure/database/client.ts';
import {
  currentPrices,
  priceHistory,
  products,
  stores,
} from '../../src/infrastructure/database/schema.ts';
import { closeDatabase } from '../../src/infrastructure/database/client.ts';
import { Price } from '../../src/domain/prices/price.ts';
import { DrizzlePriceRepository } from '../../src/infrastructure/database/price-repository-drizzle.ts';
import { DrizzleOutboxStore } from '../../src/infrastructure/queue/drizzle-outbox-store.ts';
import { processPriceJob } from '../../src/infrastructure/queue/process-price-job.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';
import { outboxEvents } from '../../src/infrastructure/database/schema.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;
describeIntegration('DrizzlePriceRepository (PostgreSQL)', () => {
  const repository = new DrizzlePriceRepository();
  const outbox = new DrizzleOutboxStore();
  let productId = '';
  let storeId = '';
  let staleStoreId = '';
  const outboxIds: string[] = [];
  beforeAll(async () => {
    await runIntegrationSetup();
    const [product] = await db
      .insert(products)
      .values({ name: 'Leite teste', category: 'Laticínios', unit: '1 L' })
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
    if (productId) {
      await db.delete(currentPrices).where(eq(currentPrices.productId, productId));
      await db.delete(priceHistory).where(eq(priceHistory.productId, productId));
      await db.delete(products).where(eq(products.id, productId));
    }
    if (staleStoreId) await db.delete(stores).where(eq(stores.id, staleStoreId));
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
    const offers = await repository.compare(productId);
    expect(offers[0]?.priceCents).toBe(800);
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

  it('moves a price job with a missing foreign key to dead', async () => {
    const missingProductId = crypto.randomUUID();
    const [event] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: { productId: missingProductId },
        idempotencyKey: crypto.randomUUID(),
        status: 'published',
        publishedAt: new Date(),
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error('Fixture de outbox indisponível.');
    outboxIds.push(event.id);

    await expect(
      processPriceJob(
        {
          productId: missingProductId,
          storeId,
          priceCents: 500,
          observedAt: new Date().toISOString(),
          source: 'test',
          idempotencyKey: crypto.randomUUID(),
        },
        event.id,
        {
          repository,
          cache: { bumpVersion: async () => 1 },
          outbox,
        },
      ),
    ).rejects.toMatchObject({ name: 'UnrecoverableError' });

    const [row] = await db
      .select({ status: outboxEvents.status, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(row?.status).toBe('dead');
    expect(row?.lastError).toBeTruthy();
  });
});
