export type BasketPriceItem = {
  productId: string;
  priceCents: number;
  observedAt: string;
};

export type BasketPriceOffer = {
  productId: string;
  storeId: string;
  storeName: string;
  city: string;
  state: string;
  priceCents: number;
  observedAt: Date;
};

export type BasketStoreTotal = {
  storeId: string;
  storeName: string;
  city: string;
  state: string;
  totalCents: number;
  items: BasketPriceItem[];
};

export interface BasketPriceReader {
  compareMany(
    productIds: string[],
    location?: { city?: string; state?: string },
  ): Promise<BasketPriceOffer[]>;
}
