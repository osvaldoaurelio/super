import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { CompareBasket } from '../../src/application/use-cases/compare-basket.ts';
import type { Cache } from '../../src/application/ports/cache.ts';
import { Price } from '../../src/domain/prices/price.ts';
import { db, closeDatabase } from '../../src/infrastructure/database/client.ts';
import {
  currentPrices,
  priceHistory,
  products,
  stores,
} from '../../src/infrastructure/database/schema.ts';
import { DrizzleBasketPriceReader } from '../../src/infrastructure/database/basket-price-reader-drizzle.ts';
import { DrizzlePriceRepository } from '../../src/infrastructure/database/price-repository-drizzle.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;

describeIntegration('basket comparison (PostgreSQL)', () => {
  const productIds: string[] = [];
  const storeIds: string[] = [];

  beforeAll(async () => {
    await runIntegrationSetup();
    const insertedProducts = await db
      .insert(products)
      .values([
        { name: `Cesta A ${crypto.randomUUID()}`, category: 'Teste', unit: 'un' },
        { name: `Cesta B ${crypto.randomUUID()}`, category: 'Teste', unit: 'un' },
      ])
      .returning({ id: products.id });
    const insertedStores = await db
      .insert(stores)
      .values([
        { name: 'Cesta Loja 1', chain: 'Teste', city: 'São Paulo', state: 'SP' },
        { name: 'Cesta Loja 2', chain: 'Teste', city: 'São Paulo', state: 'SP' },
      ])
      .returning({ id: stores.id });
    productIds.push(...insertedProducts.map((product) => product.id));
    storeIds.push(...insertedStores.map((store) => store.id));
    if (productIds.length !== 2 || storeIds.length !== 2) {
      throw new Error('Falha ao criar fixtures da cesta.');
    }

    const repository = new DrizzlePriceRepository();
    const prices = [
      { storeIndex: 0, productIndex: 0, priceCents: 100 },
      { storeIndex: 0, productIndex: 1, priceCents: 200 },
      { storeIndex: 1, productIndex: 0, priceCents: 150 },
      { storeIndex: 1, productIndex: 1, priceCents: 100 },
    ];
    for (const [index, item] of prices.entries()) {
      const productId = productIds[item.productIndex];
      const storeId = storeIds[item.storeIndex];
      if (!productId || !storeId) throw new Error('Fixture de preço incompleta.');
      await repository.record(
        Price.create({
          productId,
          storeId,
          priceCents: item.priceCents,
          observedAt: new Date(Date.now() + index),
          source: 'basket-test',
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
  });

  afterAll(async () => {
    if (productIds.length) {
      await db.delete(currentPrices).where(inArray(currentPrices.productId, productIds));
      await db.delete(priceHistory).where(inArray(priceHistory.productId, productIds));
      await db.delete(products).where(inArray(products.id, productIds));
    }
    if (storeIds.length) await db.delete(stores).where(inArray(stores.id, storeIds));
    await closeDatabase();
  });

  it('totals current prices across products and ranks stores by the lowest basket total', async () => {
    const cacheValues = new Map<string, unknown>();
    const cache: Cache = {
      get: async <T>(key: string) => (cacheValues.get(key) as T | undefined) ?? null,
      set: async <T>(key: string, value: T) => {
        cacheValues.set(key, value);
      },
      bumpVersion: async () => 1,
    };
    const compareBasket = new CompareBasket(new DrizzleBasketPriceReader(), cache);

    const result = await compareBasket.execute({ productIds });

    expect(result.map((store) => store.totalCents)).toEqual([250, 300]);
    expect(result[0]?.items).toHaveLength(2);
  });
});
