import type { Cache } from '../ports/cache.ts';
import type { PriceOffer, PriceRepository } from '../ports/price-repository.ts';

export class ComparePrices {
  constructor(
    private readonly repository: PriceRepository,
    private readonly cache: Cache,
  ) {}

  async execute(input: {
    productId: string;
    city?: string;
    state?: string;
  }): Promise<PriceOffer[]> {
    const version = (await this.cache.get<number>(`prices:ver:${input.productId}`)) ?? 0;
    const key = `prices:v2:${input.productId}:${version}:${input.state ?? '*'}:${input.city ? encodeURIComponent(input.city) : '*'}`;
    const cached = await this.cache.get<PriceOffer[]>(key);
    if (cached) return cached;
    const location: { city?: string; state?: string } = {};
    if (input.city !== undefined) location.city = input.city;
    if (input.state !== undefined) location.state = input.state;
    const offers = await this.repository.compare(input.productId, location);
    await this.cache.set(key, offers, 60);
    return offers;
  }
}
