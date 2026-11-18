import { createHash } from 'node:crypto';
import type { Cache } from '../ports/cache.ts';
import type { BasketPriceReader, BasketStoreTotal } from '../ports/basket-price-reader.ts';
import { DomainError } from '../../domain/errors.ts';

export class CompareBasket {
  constructor(
    private readonly reader: BasketPriceReader,
    private readonly cache: Cache,
  ) {}

  async execute(input: {
    productIds: string[];
    city?: string;
    state?: string;
  }): Promise<BasketStoreTotal[]> {
    const productIds = [...new Set(input.productIds)].sort();
    if (
      productIds.length === 0 ||
      productIds.length > 50 ||
      productIds.length !== input.productIds.length
    ) {
      throw new DomainError('A cesta deve conter de 1 a 50 produtos distintos.', 'INVALID_BASKET');
    }

    const scope = JSON.stringify({
      productIds,
      city: input.city ?? null,
      state: input.state?.toUpperCase() ?? null,
    });
    const productsHash = createHash('sha256').update(scope).digest('hex');
    const versions = await Promise.all(
      productIds.map(async (productId) => {
        return (await this.cache.get<number>(`prices:ver:${productId}`)) ?? 0;
      }),
    );
    const versionHash = createHash('sha256').update(JSON.stringify(versions)).digest('hex');
    const cacheKey = `baskets:v1:${productsHash}:${versionHash}`;
    const cached = await this.cache.get<BasketStoreTotal[]>(cacheKey);
    if (cached) return cached;

    const location: { city?: string; state?: string } = {};
    if (input.city !== undefined) location.city = input.city;
    if (input.state !== undefined) location.state = input.state;
    const offers = await this.reader.compareMany(productIds, location);
    const requestedIds = new Set(productIds);
    const grouped = new Map<
      string,
      {
        storeId: string;
        storeName: string;
        city: string;
        state: string;
        items: Map<string, { productId: string; priceCents: number; observedAt: Date }>;
      }
    >();
    for (const offer of offers) {
      if (!requestedIds.has(offer.productId)) continue;
      let store = grouped.get(offer.storeId);
      if (!store) {
        store = {
          storeId: offer.storeId,
          storeName: offer.storeName,
          city: offer.city,
          state: offer.state,
          items: new Map(),
        };
        grouped.set(offer.storeId, store);
      }
      store.items.set(offer.productId, {
        productId: offer.productId,
        priceCents: offer.priceCents,
        observedAt: offer.observedAt,
      });
    }
    const totals = [...grouped.values()]
      .filter((store) => store.items.size === productIds.length)
      .map((store) => {
        const items = productIds.map((productId) => {
          const item = store.items.get(productId);
          if (!item) throw new Error('Preço da cesta desapareceu durante a totalização.');
          return item;
        });
        return {
          storeId: store.storeId,
          storeName: store.storeName,
          city: store.city,
          state: store.state,
          totalCents: items.reduce((total, item) => total + item.priceCents, 0),
          items: items.map((item) => ({
            ...item,
            observedAt: item.observedAt.toISOString(),
          })),
        };
      })
      .sort(
        (left, right) =>
          left.totalCents - right.totalCents || left.storeId.localeCompare(right.storeId),
      );
    await this.cache.set(cacheKey, totals, 60);
    return totals;
  }
}
