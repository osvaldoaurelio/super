import { describe, expect, it, vi } from 'vitest';
import { ComparePrices } from '../../src/application/use-cases/compare-prices.ts';
import type { Cache } from '../../src/application/ports/cache.ts';
import type { PriceRepository } from '../../src/application/ports/price-repository.ts';

function setup() {
  const offers = [
    {
      storeId: 's1',
      storeName: 'Loja 1',
      city: 'São Paulo',
      state: 'SP',
      priceCents: 399,
      observedAt: new Date(),
    },
  ];
  const repository: PriceRepository = {
    compare: vi.fn().mockResolvedValue(offers),
    history: vi.fn().mockResolvedValue([]),
    record: vi.fn(),
  };
  const values = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: vi.fn(async <T>(key: string, value: T) => {
      values.set(key, value);
    }),
    deleteByPrefix: vi.fn(),
  };
  return { useCase: new ComparePrices(repository, cache), repository, cache, offers };
}

describe('ComparePrices', () => {
  it('reads from repository on cache miss and caches result', async () => {
    const { useCase, repository, cache, offers } = setup();
    await expect(
      useCase.execute({ productId: 'p1', city: 'São Paulo', state: 'SP' }),
    ).resolves.toEqual(offers);
    expect(repository.compare).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledOnce();
  });

  it('returns cached result without querying repository', async () => {
    const { useCase, repository, cache } = setup();
    await useCase.execute({ productId: 'p1' });
    await useCase.execute({ productId: 'p1' });
    expect(repository.compare).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledOnce();
  });
});
