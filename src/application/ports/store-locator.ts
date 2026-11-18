export type NearbyStoreQuery = {
  latitude: number;
  longitude: number;
  radiusKm: number;
  limit: number;
};

export type NearbyStore = {
  id: string;
  name: string;
  chain: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
};

export interface StoreLocator {
  findNearby(query: NearbyStoreQuery): Promise<NearbyStore[]>;
}
