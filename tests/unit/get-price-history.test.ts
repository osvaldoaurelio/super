import { describe, expect, it, vi } from 'vitest';
import { GetPriceHistory } from '../../src/application/use-cases/get-price-history.ts';
import type { Cache } from '../../src/application/ports/cache.ts';
import type {
  PriceHistoryPoint,
  PriceRepository,
} from '../../src/application/ports/price-repository.ts';

describe('GetPriceHistory', () => {
  it('uses the product cache version and preserves the history TTL', async () => {
    const points: PriceHistoryPoint[] = [
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        priceCents: 500,
        priceType: 'regular',
        observedAt: new Date(),
      },
    ];
    const repository: PriceRepository = {
      compare: vi.fn().mockResolvedValue([]),
      history: vi.fn().mockResolvedValue(points),
      record: vi.fn(),
    };
    const values = new Map<string, unknown>([['history:ver:p1', 4]]);
    const cache: Cache = {
      get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
      set: vi.fn(),
      bumpVersion: vi.fn(async () => 1),
    };
    const useCase = new GetPriceHistory(repository, cache);

    await expect(useCase.execute({ productId: 'p1', days: 30, limit: 25 })).resolves.toMatchObject({
      points,
    });

    expect(cache.set).toHaveBeenCalledWith('history:v3:p1:4:30:25:first', { points }, 300);
    expect(repository.history).toHaveBeenCalledWith('p1', expect.any(Date), 26, undefined);
  });

  it('uses the last returned item as a cursor when another page exists', async () => {
    const points: PriceHistoryPoint[] = [
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        priceCents: 500,
        priceType: 'regular',
        observedAt: new Date(),
      },
      {
        id: '123e4567-e89b-42d3-a456-426614174001',
        priceCents: 600,
        priceType: 'promo',
        observedAt: new Date(),
      },
    ];
    const repository: PriceRepository = {
      compare: vi.fn().mockResolvedValue([]),
      history: vi.fn().mockResolvedValue(points),
      record: vi.fn(),
    };
    const cache: Cache = {
      get: vi.fn(async () => null),
      set: vi.fn(),
      bumpVersion: vi.fn(async () => 1),
    };

    await expect(
      new GetPriceHistory(repository, cache).execute({ productId: 'p1', limit: 1 }),
    ).resolves.toMatchObject({
      points: [points[0]],
      nextCursor: { id: points[0]?.id, observedAt: points[0]?.observedAt },
    });
  });
});
