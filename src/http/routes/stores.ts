import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { StoreLocator } from '../../application/ports/store-locator.ts';
import { FindNearbyStores } from '../../application/use-cases/find-nearby-stores.ts';
import type { AppEnv } from '../types.ts';

const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const NearbyStoresResponse = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      chain: z.string(),
      city: z.string(),
      state: z.string(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      distanceKm: z.number().min(0),
    }),
  ),
  meta: z.object({ count: z.number().int() }),
});

const nearbyRoute = createRoute({
  method: 'get',
  path: '/nearby',
  tags: ['Stores'],
  request: {
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      radiusKm: z.coerce.number().min(0.1).max(50),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: {
    200: {
      description: 'Supermercados ativos próximos, ordenados por distância.',
      content: { 'application/json': { schema: NearbyStoresResponse } },
    },
    400: {
      description: 'Parâmetros inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export function createStoreRoutes(dependencies: { storeLocator: StoreLocator }) {
  const findNearbyStores = new FindNearbyStores(dependencies.storeLocator);
  const routes = new OpenAPIHono<AppEnv>();

  routes.openapi(nearbyRoute, async (context) => {
    const { lat, lng, radiusKm, limit } = context.req.valid('query');
    const stores = await findNearbyStores.execute({
      latitude: lat,
      longitude: lng,
      radiusKm,
      limit,
    });

    return context.json(
      {
        data: stores.map((store) => ({
          id: store.id,
          name: store.name,
          chain: store.chain,
          city: store.city,
          state: store.state,
          lat: store.latitude,
          lng: store.longitude,
          distanceKm: store.distanceKm,
        })),
        meta: { count: stores.length },
      },
      200,
    );
  });

  return routes;
}
