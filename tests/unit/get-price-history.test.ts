import { describe, expect, it, vi } from 'vitest';
import { GetPriceHistory } from '../../src/application/use-cases/get-price-history.ts';
import type { Cache } from '../../src/application/ports/cache.ts';
import type {
  PriceHistoryPoint,
  PriceRepository,
} from '../../src/application/ports/price-repository.ts';

describe('GetPriceHistory', () => {
  it('uses the product cache version and preserves the history TTL', async () => {
    const points: PriceHistoryPoint[] = [];
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

    await expect(useCase.execute({ productId: 'p1', days: 30, limit: 25 })).resolves.toBe(points);

    expect(cache.set).toHaveBeenCalledWith('history:v2:p1:4:30:25', points, 300);
    expect(repository.history).toHaveBeenCalledOnce();
  });
});
