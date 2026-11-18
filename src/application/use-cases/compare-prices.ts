import type { Cache } from '../ports/cache.ts';
import type { PriceOffer, PriceReader } from '../ports/price-repository.ts';
import { DomainError } from '../../domain/errors.ts';

export class ComparePrices {
  constructor(
    private readonly repository: PriceReader,
    private readonly cache: Cache,
  ) {}

  async execute(input: {
    productId: string;
    city?: string;
    state?: string;
    limit?: number;
  }): Promise<PriceOffer[]> {
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError('O limite de ofertas deve estar entre 1 e 100.', 'INVALID_LIMIT');
    }
    const version = (await this.cache.get<number>(`prices:ver:${input.productId}`)) ?? 0;
    const key = `prices:v3:${input.productId}:${version}:${input.state ?? '*'}:${input.city ? encodeURIComponent(input.city) : '*'}:${limit}`;
    const cached = await this.cache.get<PriceOffer[]>(key);
    if (cached) {
      return cached.map((offer) => ({ ...offer, observedAt: new Date(`${offer.observedAt}`) }));
    }
    const location: { city?: string; state?: string } = {};
    if (input.city !== undefined) location.city = input.city;
    if (input.state !== undefined) location.state = input.state;
    const offers = await this.repository.compare(input.productId, location, limit);
    await this.cache.set(key, offers, 60);
    return offers;
  }
}
