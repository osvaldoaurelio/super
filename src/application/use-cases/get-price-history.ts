import type { Cache } from '../ports/cache.ts';
import type { PriceHistoryPoint, PriceRepository } from '../ports/price-repository.ts';

export class GetPriceHistory {
  constructor(
    private readonly repository: PriceRepository,
    private readonly cache: Cache,
  ) {}

  async execute(input: {
    productId: string;
    days?: number;
    limit?: number;
  }): Promise<PriceHistoryPoint[]> {
    const days = input.days ?? 90;
    const limit = input.limit ?? 500;
    const key = `history:v1:${input.productId}:${days}:${limit}`;
    const cached = await this.cache.get<PriceHistoryPoint[]>(key);
    if (cached) return cached;
    const points = await this.repository.history(
      input.productId,
      new Date(Date.now() - days * 86_400_000),
      limit,
    );
    await this.cache.set(key, points, 300);
    return points;
  }
}
