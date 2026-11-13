import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;
describeIntegration('DrizzlePriceRepository (PostgreSQL)', () => {
  const repository = new DrizzlePriceRepository();
  let productId = '';
  let storeId = '';
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
    if (storeId) await db.delete(stores).where(eq(stores.id, storeId));
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
});
