import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { ProductSearch } from '../../application/ports/product-search.ts';
import { SearchProducts } from '../../application/use-cases/search-products.ts';
import type { AppEnv } from '../types.ts';

const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const SearchResponse = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      gtin: z.string().nullable(),
      name: z.string(),
      brand: z.string().nullable(),
      category: z.string(),
      unit: z.string(),
      relevance: z.number().min(0).max(1),
    }),
  ),
  meta: z.object({ count: z.number().int(), nextCursor: z.string().optional() }),
});

const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['Products'],
  request: {
    query: z.object({
      q: z.string().trim().min(3).max(120),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().min(1).max(512).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Produtos encontrados por relevância.',
      content: { 'application/json': { schema: SearchResponse } },
    },
    400: {
      description: 'Parâmetros inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

export function createProductSearchRoutes(dependencies: { productSearch: ProductSearch }) {
  const search = new SearchProducts(dependencies.productSearch);
  const routes = new OpenAPIHono<AppEnv>();

  routes.openapi(searchRoute, async (context) => {
    const { q, limit, cursor } = context.req.valid('query');
    const result = await search.execute({ query: q, limit, ...(cursor ? { cursor } : {}) });
    const meta: { count: number; nextCursor?: string } = { count: result.products.length };
    if (result.nextCursor) meta.nextCursor = result.nextCursor;

    return context.json({ data: result.products, meta }, 200);
  });

  return routes;
}
