import { describe, expect, it, vi } from 'vitest';
import type { BasketPriceReader } from '../../src/application/ports/basket-price-reader.ts';
import type { Cache } from '../../src/application/ports/cache.ts';
import { CompareBasket } from '../../src/application/use-cases/compare-basket.ts';
import { DomainError } from '../../src/domain/errors.ts';

function setup() {
  const productIds = ['p1', 'p2'];
  const reader: BasketPriceReader = {
    compareMany: vi.fn().mockResolvedValue([
      {
        productId: 'p1',
        storeId: 'store-b',
        storeName: 'Loja B',
        city: 'São Paulo',
        state: 'SP',
        priceCents: 500,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        productId: 'p2',
        storeId: 'store-b',
        storeName: 'Loja B',
        city: 'São Paulo',
        state: 'SP',
        priceCents: 200,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        productId: 'p1',
        storeId: 'store-a',
        storeName: 'Loja A',
        city: 'São Paulo',
        state: 'SP',
        priceCents: 400,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        productId: 'p2',
        storeId: 'store-a',
        storeName: 'Loja A',
        city: 'São Paulo',
        state: 'SP',
        priceCents: 250,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]),
  };
  const values = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: vi.fn(async <T>(key: string, value: T) => {
      values.set(key, value);
    }),
    bumpVersion: vi.fn(async () => 1),
  };
  return { useCase: new CompareBasket(reader, cache), reader, cache, productIds };
}

describe('CompareBasket', () => {
  it('totals complete baskets and sorts by total price', async () => {
    const { useCase, reader, productIds } = setup();

    await expect(useCase.execute({ productIds })).resolves.toMatchObject([
      { storeId: 'store-a', totalCents: 650 },
      { storeId: 'store-b', totalCents: 700 },
    ]);
    expect(reader.compareMany).toHaveBeenCalledWith(['p1', 'p2'], {});
  });

  it('reuses cached totals and rejects duplicate products', async () => {
    const { useCase, reader, cache, productIds } = setup();
    await cache.set('prices:ver:p1', 1, 60);
    await useCase.execute({ productIds });
    await useCase.execute({ productIds });
    expect(reader.compareMany).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^baskets:v1:/),
      expect.any(Array),
      60,
    );
    await cache.set('prices:ver:p1', 2, 60);
    await useCase.execute({ productIds });
    expect(reader.compareMany).toHaveBeenCalledTimes(2);
    await expect(useCase.execute({ productIds: ['p1', 'p1'] })).rejects.toBeInstanceOf(DomainError);
  });
});
