import { DomainError } from '../../domain/errors.ts';
import type { NearbyStoreQuery, StoreLocator } from '../ports/store-locator.ts';

export class FindNearbyStores {
  constructor(private readonly storeLocator: StoreLocator) {}

  execute(query: NearbyStoreQuery) {
    if (
      !Number.isFinite(query.latitude) ||
      query.latitude < -90 ||
      query.latitude > 90 ||
      !Number.isFinite(query.longitude) ||
      query.longitude < -180 ||
      query.longitude > 180 ||
      !Number.isFinite(query.radiusKm) ||
      query.radiusKm < 0.1 ||
      query.radiusKm > 50 ||
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 50
    ) {
      throw new DomainError('Parâmetros de busca geográfica inválidos.', 'INVALID_GEO_QUERY');
    }

    return this.storeLocator.findNearby(query);
  }
}
