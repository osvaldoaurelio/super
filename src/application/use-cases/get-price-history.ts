import type { Cache } from '../ports/cache.ts';
import type {
  PriceHistoryCursor,
  PriceHistoryPoint,
  PriceReader,
} from '../ports/price-repository.ts';

export type PriceHistoryPage = {
  points: PriceHistoryPoint[];
  nextCursor?: PriceHistoryCursor;
};
export class GetPriceHistory {
  constructor(
    private readonly repository: PriceReader,
    private readonly cache: Cache,
  ) {}

  async execute(input: {
    productId: string;
    days?: number;
    limit?: number;
    cursor?: PriceHistoryCursor;
  }): Promise<PriceHistoryPage> {
    const days = input.days ?? 90;
    const limit = input.limit ?? 500;
    const version = (await this.cache.get<number>(`history:ver:${input.productId}`)) ?? 0;
    const cursorKey = input.cursor
      ? `${input.cursor.observedAt.toISOString()}:${input.cursor.id}`
      : 'first';
    const key = `history:v3:${input.productId}:${version}:${days}:${limit}:${cursorKey}`;
    const cached = await this.cache.get<PriceHistoryPage>(key);
    if (cached) {
      return {
        points: cached.points.map((point) => ({
          ...point,
          observedAt: new Date(`${point.observedAt}`),
        })),
        ...(cached.nextCursor
          ? {
              nextCursor: {
                ...cached.nextCursor,
                observedAt: new Date(`${cached.nextCursor.observedAt}`),
              },
            }
          : {}),
      };
    }
    const rows = await this.repository.history(
      input.productId,
      new Date(Date.now() - days * 86_400_000),
      limit + 1,
      input.cursor,
    );
    const hasMore = rows.length > limit;
    const points = hasMore ? rows.slice(0, limit) : rows;
    const last = points.at(-1);
    const page: PriceHistoryPage = {
      points,
      ...(hasMore && last ? { nextCursor: { observedAt: last.observedAt, id: last.id } } : {}),
    };
    await this.cache.set(key, page, 300);
    return page;
  }
}
