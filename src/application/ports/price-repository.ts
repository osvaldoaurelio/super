import type { Price } from '../../domain/prices/price.ts';

export type PriceOffer = {
  storeId: string;
  storeName: string;
  city: string;
  state: string;
  priceCents: number;
  observedAt: Date;
};
export type PriceHistoryPoint = { priceCents: number; observedAt: Date };

export interface PriceRepository {
  compare(productId: string, location?: { city?: string; state?: string }): Promise<PriceOffer[]>;
  history(productId: string, since: Date, limit: number): Promise<PriceHistoryPoint[]>;
  record(price: Price): Promise<void>;
}
