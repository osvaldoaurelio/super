import { and, asc, desc, eq, gt, gte, sql, type SQL } from 'drizzle-orm';
import type {
  PriceRepository,
  PriceOffer,
  PriceHistoryPoint,
} from '../../application/ports/price-repository.ts';
import { PRICE_FRESHNESS_WINDOW_DAYS, type Price } from '../../domain/prices/price.ts';
import { db } from './client.ts';
import { currentPrices, priceHistory, stores } from './schema.ts';

export class DrizzlePriceRepository implements PriceRepository {
  async compare(
    productId: string,
    location: { city?: string; state?: string } = {},
  ): Promise<PriceOffer[]> {
    const filters: SQL[] = [eq(currentPrices.productId, productId), eq(stores.active, true)];
    if (location.city) filters.push(eq(stores.city, location.city));
    if (location.state) filters.push(eq(stores.state, location.state.toUpperCase()));
    filters.push(
      gte(
        currentPrices.observedAt,
        sql`now() - (${PRICE_FRESHNESS_WINDOW_DAYS} * interval '1 day')`,
      ),
    );
    const rows = await db
      .select({
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
      .orderBy(asc(currentPrices.priceCents))
      .limit(100);
    return rows;
  }

  async history(productId: string, since: Date, limit: number): Promise<PriceHistoryPoint[]> {
    return db
      .select({ priceCents: priceHistory.priceCents, observedAt: priceHistory.observedAt })
      .from(priceHistory)
      .where(and(eq(priceHistory.productId, productId), gte(priceHistory.observedAt, since)))
      .orderBy(desc(priceHistory.observedAt))
      .limit(limit);
  }

  async record(price: Price): Promise<void> {
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(priceHistory)
        .values({
          productId: price.props.productId,
          storeId: price.props.storeId,
          priceCents: price.props.priceCents,
          observedAt: price.props.observedAt,
          source: price.props.source,
          idempotencyKey: price.props.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: priceHistory.id });
      if (!inserted) return;
      await tx
        .insert(currentPrices)
        .values({
          productId: price.props.productId,
          storeId: price.props.storeId,
          priceCents: price.props.priceCents,
          observedAt: price.props.observedAt,
        })
        .onConflictDoUpdate({
          target: [currentPrices.productId, currentPrices.storeId],
          set: {
            priceCents: price.props.priceCents,
            observedAt: price.props.observedAt,
            updatedAt: new Date(),
          },
          setWhere: gt(sql`excluded.observed_at`, currentPrices.observedAt),
        });
    });
  }
}
