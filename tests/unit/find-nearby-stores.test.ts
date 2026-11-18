import { describe, expect, it, vi } from 'vitest';
import { FindNearbyStores } from '../../src/application/use-cases/find-nearby-stores.ts';
import type { StoreLocator } from '../../src/application/ports/store-locator.ts';

describe('FindNearbyStores', () => {
  it('delegates a valid query to the store locator', async () => {
    const findNearby = vi.fn<StoreLocator['findNearby']>().mockResolvedValue([]);
    const useCase = new FindNearbyStores({ findNearby });
    const query = { latitude: -23.55, longitude: -46.63, radiusKm: 5, limit: 20 };

    await expect(useCase.execute(query)).resolves.toEqual([]);
    expect(findNearby).toHaveBeenCalledWith(query);
  });

  it.each([
    { latitude: -91, longitude: 0, radiusKm: 5, limit: 20 },
    { latitude: 0, longitude: 181, radiusKm: 5, limit: 20 },
    { latitude: 0, longitude: 0, radiusKm: 0, limit: 20 },
    { latitude: 0, longitude: 0, radiusKm: 5, limit: 51 },
  ])('rejects invalid query parameters: %o', (query) => {
    const findNearby = vi.fn<StoreLocator['findNearby']>().mockResolvedValue([]);
    const useCase = new FindNearbyStores({ findNearby });

    expect(() => useCase.execute(query)).toThrowError(
      expect.objectContaining({ code: 'INVALID_GEO_QUERY' }),
    );
    expect(findNearby).not.toHaveBeenCalled();
  });
});
