import { and, asc, eq, gte, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { NearbyStoreQuery, StoreLocator } from '../../application/ports/store-locator.ts';
import { db } from './client.ts';
import { stores } from './schema.ts';

const EARTH_RADIUS_KM = 6_371;
const KM_PER_LATITUDE_DEGREE = 110;

function longitudeBounds(latitude: number, longitude: number, radiusKm: number) {
  const rawLatitudeDelta = radiusKm / KM_PER_LATITUDE_DEGREE;
  const maxAbsoluteLatitude = Math.min(90, Math.abs(latitude) + rawLatitudeDelta);
  if (maxAbsoluteLatitude >= 90) {
    return { min: -180, max: 180 };
  }

  const kmPerLongitudeDegree =
    KM_PER_LATITUDE_DEGREE * Math.cos((maxAbsoluteLatitude * Math.PI) / 180);
  const longitudeDelta = radiusKm / kmPerLongitudeDegree;
  if (longitudeDelta >= 180) return { min: -180, max: 180 };

  const min = longitude - longitudeDelta;
  const max = longitude + longitudeDelta;
  if (min < -180) return { min: min + 360, max, wraps: true as const };
  if (max > 180) return { min, max: max - 360, wraps: true as const };
  return { min, max, wraps: false as const };
}

export class DrizzleStoreLocator implements StoreLocator {
  async findNearby(query: NearbyStoreQuery) {
    const latitudeDelta = query.radiusKm / KM_PER_LATITUDE_DEGREE;
    const minLatitude = Math.max(-90, query.latitude - latitudeDelta);
    const maxLatitude = Math.min(90, query.latitude + latitudeDelta);
    const longitudeRange = longitudeBounds(query.latitude, query.longitude, query.radiusKm);
    const longitudeCondition =
      'wraps' in longitudeRange && longitudeRange.wraps
        ? or(
            gte(stores.longitude, String(longitudeRange.min)),
            lte(stores.longitude, String(longitudeRange.max)),
          )
        : and(
            gte(stores.longitude, String(longitudeRange.min)),
            lte(stores.longitude, String(longitudeRange.max)),
          );
    const distanceKm = sql<number>`(
      ${EARTH_RADIUS_KM} * 2 * asin(sqrt(
        power(sin(radians(${query.latitude} - ${stores.latitude}::double precision) / 2), 2)
        + cos(radians(${query.latitude})) * cos(radians(${stores.latitude}::double precision))
        * power(sin(radians(${query.longitude} - ${stores.longitude}::double precision) / 2), 2)
      ))
    )`;
    const rows = await db
      .select({
        id: stores.id,
        name: stores.name,
        chain: stores.chain,
        city: stores.city,
        state: stores.state,
        latitude: stores.latitude,
        longitude: stores.longitude,
        distanceKm,
      })
      .from(stores)
      .where(
        and(
          eq(stores.active, true),
          isNotNull(stores.latitude),
          isNotNull(stores.longitude),
          gte(stores.latitude, String(minLatitude)),
          lte(stores.latitude, String(maxLatitude)),
          longitudeCondition,
          lte(distanceKm, query.radiusKm),
        ),
      )
      .orderBy(asc(distanceKm), asc(stores.id))
      .limit(query.limit);

    return rows.map((row) => ({
      ...row,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      distanceKm: Math.round(row.distanceKm * 100) / 100,
    }));
  }
}
