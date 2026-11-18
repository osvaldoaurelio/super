import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  BasketPriceOffer,
  BasketPriceReader,
} from '../../application/ports/basket-price-reader.ts';
import { PRICE_FRESHNESS_WINDOW_DAYS } from '../../domain/prices/price.ts';
import { db } from './client.ts';
import { currentPrices, stores } from './schema.ts';

export class DrizzleBasketPriceReader implements BasketPriceReader {
  async compareMany(
    productIds: string[],
    location: { city?: string; state?: string } = {},
  ): Promise<BasketPriceOffer[]> {
    const filters: SQL[] = [
      inArray(currentPrices.productId, productIds),
      eq(stores.active, true),
      gte(
        currentPrices.observedAt,
        sql`now() - (${PRICE_FRESHNESS_WINDOW_DAYS} * interval '1 day')`,
      ),
    ];
    if (location.city) filters.push(eq(stores.city, location.city));
    if (location.state) filters.push(eq(stores.state, location.state.toUpperCase()));

    return db
      .select({
        productId: currentPrices.productId,
        storeId: stores.id,
        storeName: stores.name,
        city: stores.city,
        state: stores.state,
        priceCents: currentPrices.priceCents,
        observedAt: currentPrices.observedAt,
      })
      .from(currentPrices)
      .innerJoin(stores, eq(currentPrices.storeId, stores.id))
      .where(and(...filters))
      .orderBy(currentPrices.productId, currentPrices.priceCents, stores.id);
  }
}
