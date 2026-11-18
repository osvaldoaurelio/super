import type { Price } from '../../domain/prices/price.ts';

export type PriceOffer = {
  storeId: string;
  storeName: string;
  city: string;
  state: string;
  priceCents: number;
  observedAt: Date;
};
export type PriceHistoryPoint = {
  id: string;
  priceCents: number;
  priceType: 'regular' | 'promo';
  observedAt: Date;
};
export type PriceHistoryCursor = { observedAt: Date; id: string };

export interface PriceReader {
  compare(
    productId: string,
    location?: { city?: string; state?: string },
    limit?: number,
  ): Promise<PriceOffer[]>;
  history(
    productId: string,
    since: Date,
    limit: number,
    cursor?: PriceHistoryCursor,
  ): Promise<PriceHistoryPoint[]>;
}

export interface PriceWriter {
  record(price: Price): Promise<void>;
}

export interface PriceRepository extends PriceReader, PriceWriter {}
