import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { BasketPriceReader } from '../../application/ports/basket-price-reader.ts';
import type { Cache } from '../../application/ports/cache.ts';
import { CompareBasket } from '../../application/use-cases/compare-basket.ts';
import type { AppEnv } from '../types.ts';

const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const ProductIds = z
  .array(z.string().uuid())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
const CompareBasketInput = z.object({
  productIds: ProductIds,
  city: z.string().min(1).max(120).optional(),
  state: z.string().length(2).optional(),
});
const CompareBasketResponse = z.object({
  data: z.array(
    z.object({
      storeId: z.string().uuid(),
      storeName: z.string(),
      city: z.string(),
      state: z.string(),
      totalCents: z.number().int(),
      items: z.array(
        z.object({
          productId: z.string().uuid(),
          priceCents: z.number().int(),
          observedAt: z.string().datetime(),
        }),
      ),
    }),
  ),
  meta: z.object({ count: z.number().int() }),
});

const compareBasketRoute = createRoute({
  method: 'post',
  path: '/compare',
  tags: ['Baskets'],
  request: { body: { content: { 'application/json': { schema: CompareBasketInput } } } },
  responses: {
    200: {
      description: 'Lojas com todos os produtos da cesta, ordenadas pelo menor total.',
      content: { 'application/json': { schema: CompareBasketResponse } },
    },
    400: {
      description: 'Cesta ou local inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export function createBasketRoutes(dependencies: { reader: BasketPriceReader; cache: Cache }) {
  const compare = new CompareBasket(dependencies.reader, dependencies.cache);
  const routes = new OpenAPIHono<AppEnv>();
  routes.openapi(compareBasketRoute, async (context) => {
    const { productIds, city, state } = context.req.valid('json');
    const location: { city?: string; state?: string } = {};
    if (city !== undefined) location.city = city;
    if (state !== undefined) location.state = state;
    const totals = await compare.execute({ productIds, ...location });
    return context.json({ data: totals, meta: { count: totals.length } }, 200);
  });
  return routes;
}
