import { and, asc, desc, eq, gt, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  PriceRepository,
  PriceOffer,
  PriceHistoryCursor,
  PriceHistoryPoint,
} from '../../application/ports/price-repository.ts';
import { PRICE_FRESHNESS_WINDOW_DAYS, type Price } from '../../domain/prices/price.ts';
import { db, type DatabaseTransaction } from './client.ts';
import { currentPrices, priceHistory, stores } from './schema.ts';
import type { PriceRecordedEvent } from '../queue/price-recorded.ts';

export class DrizzlePriceRepository implements PriceRepository {
  async compare(
    productId: string,
    location: { city?: string; state?: string } = {},
    limit = 100,
  ): Promise<PriceOffer[]> {
    const filters: SQL[] = [
      eq(currentPrices.productId, productId),
      eq(currentPrices.priceType, 'regular'),
      eq(stores.active, true),
    ];
    if (location.city) filters.push(eq(stores.city, location.city));
    if (location.state) filters.push(eq(stores.state, location.state.toUpperCase()));
    filters.push(
      gte(
        currentPrices.observedAt,
        sql`now() - (${PRICE_FRESHNESS_WINDOW_DAYS} * interval '1 day')`,
      ),
    );
    const rows = await db
      .selectDistinctOn([stores.chain], {
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
      .orderBy(asc(stores.chain), asc(currentPrices.priceCents), asc(stores.id))
      .limit(limit);
    return rows.sort(
      (left, right) =>
        left.priceCents - right.priceCents || left.storeId.localeCompare(right.storeId),
    );
  }

  async history(
    productId: string,
    since: Date,
    limit: number,
    cursor?: PriceHistoryCursor,
  ): Promise<PriceHistoryPoint[]> {
    const filters: SQL[] = [
      eq(priceHistory.productId, productId),
      gte(priceHistory.observedAt, since),
    ];
    if (cursor) {
      const afterCursor = or(
        lt(priceHistory.observedAt, cursor.observedAt),
        and(eq(priceHistory.observedAt, cursor.observedAt), lt(priceHistory.id, cursor.id)),
      );
      if (afterCursor) filters.push(afterCursor);
    }
    return db
      .select({
        id: priceHistory.id,
        priceCents: priceHistory.priceCents,
        priceType: priceHistory.priceType,
        observedAt: priceHistory.observedAt,
      })
      .from(priceHistory)
      .where(and(...filters))
      .orderBy(desc(priceHistory.observedAt), desc(priceHistory.id))
      .limit(limit);
  }

  async record(price: Price): Promise<void> {
    await db.transaction((tx) => this.recordInTransaction(tx, price));
  }

  async recordInTransaction(
    tx: DatabaseTransaction,
    price: Price,
  ): Promise<PriceRecordedEvent | null> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${price.props.productId}), hashtext(${price.props.storeId}))`,
    );
    const [previous] = await tx
      .select({ priceCents: currentPrices.priceCents })
      .from(currentPrices)
      .where(
        and(
          eq(currentPrices.productId, price.props.productId),
          eq(currentPrices.storeId, price.props.storeId),
        ),
      )
      .for('update');
    const [inserted] = await tx
      .insert(priceHistory)
      .values({
        productId: price.props.productId,
        storeId: price.props.storeId,
        priceCents: price.props.priceCents,
        priceType: price.props.priceType,
        observedAt: price.props.observedAt,
        source: price.props.source,
        idempotencyKey: price.props.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [priceHistory.source, priceHistory.idempotencyKey],
      })
      .returning({ id: priceHistory.id });
    if (!inserted) return null;
    if (price.props.priceType === 'promo') return null;
    const [updated] = await tx
      .insert(currentPrices)
      .values({
        productId: price.props.productId,
        storeId: price.props.storeId,
        priceCents: price.props.priceCents,
        priceType: 'regular',
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
      })
      .returning({ priceCents: currentPrices.priceCents });
    return {
      productId: price.props.productId,
      storeId: price.props.storeId,
      previousPriceCents: previous?.priceCents ?? null,
      priceCents: price.props.priceCents,
      currentPriceUpdated: updated !== undefined,
      observedAt: price.props.observedAt.toISOString(),
    };
  }
}
