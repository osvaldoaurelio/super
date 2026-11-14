import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Cache } from '../../application/ports/cache.ts';
import type { PriceJobQueue } from '../../application/ports/price-job-queue.ts';
import type { PriceRepository } from '../../application/ports/price-repository.ts';
import { ComparePrices } from '../../application/use-cases/compare-prices.ts';
import { GetPriceHistory } from '../../application/use-cases/get-price-history.ts';
import { SubmitPrice } from '../../application/use-cases/submit-price.ts';
import type { MiddlewareHandler } from 'hono';
import { requireAuth } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';

const Id = z.string().uuid();
const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const Offer = z.object({
  storeId: Id,
  storeName: z.string(),
  city: z.string(),
  state: z.string(),
  priceCents: z.number().int(),
  observedAt: z.string().datetime(),
});
const CompareResponse = z.object({
  data: z.array(Offer),
  meta: z.object({ count: z.number().int() }),
});
const HistoryResponse = z.object({
  data: z.array(z.object({ priceCents: z.number().int(), observedAt: z.string().datetime() })),
  meta: z.object({ count: z.number().int() }),
});
const PriceInput = z.object({
  productId: Id,
  storeId: Id,
  priceCents: z.number().int().positive().max(10_000_000),
  observedAt: z.string().datetime().optional(),
  source: z.string().min(2).max(64),
});
const AcceptedResponse = z.object({
  data: z.object({ status: z.literal('accepted'), idempotencyKey: z.string().uuid() }),
});

const compareRoute = createRoute({
  method: 'get',
  path: '/{productId}/compare',
  tags: ['Prices'],
  request: {
    params: z.object({ productId: Id }),
    query: z.object({
      city: z.string().min(1).max(120).optional(),
      state: z.string().length(2).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Ofertas por menor preço.',
      content: { 'application/json': { schema: CompareResponse } },
    },
    400: {
      description: 'Parâmetros inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
const historyRoute = createRoute({
  method: 'get',
  path: '/{productId}/history',
  tags: ['Prices'],
  request: {
    params: z.object({ productId: Id }),
    query: z.object({
      days: z.coerce.number().int().min(1).max(3650).default(90),
      limit: z.coerce.number().int().min(1).max(1000).default(500),
    }),
  },
  responses: {
    200: {
      description: 'Histórico recente.',
      content: { 'application/json': { schema: HistoryResponse } },
    },
    400: {
      description: 'Parâmetros inválidos.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
export function createPriceRoutes(dependencies: {
  repository: PriceRepository;
  cache: Cache;
  queue: PriceJobQueue;
  rateLimit: MiddlewareHandler<AppEnv>;
}) {
  const compare = new ComparePrices(dependencies.repository, dependencies.cache);
  const history = new GetPriceHistory(dependencies.repository, dependencies.cache);
  const submit = new SubmitPrice(dependencies.queue);
  const routes = new OpenAPIHono<AppEnv>();
  const submitRoute = createRoute({
    method: 'post',
    path: '',
    tags: ['Prices'],
    middleware: [requireAuth, dependencies.rateLimit],
    request: {
      headers: z.object({ 'idempotency-key': z.string().uuid() }),
      body: { content: { 'application/json': { schema: PriceInput } } },
    },
    responses: {
      202: {
        description: 'Preço aceito para processamento assíncrono.',
        content: { 'application/json': { schema: AcceptedResponse } },
      },
      401: {
        description: 'Autenticação necessária.',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      400: {
        description: 'Dados inválidos.',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      429: {
        description: 'Limite de requisições excedido.',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  routes.openapi(compareRoute, async (context) => {
    const { productId } = context.req.valid('param');
    const { city, state } = context.req.valid('query');
    const location: { city?: string; state?: string } = {};
    if (city !== undefined) location.city = city;
    if (state !== undefined) location.state = state;
    const data = await compare.execute({ productId, ...location });
    return context.json(
      {
        data: data.map((offer) => ({ ...offer, observedAt: offer.observedAt.toISOString() })),
        meta: { count: data.length },
      },
      200,
    );
  });
  routes.openapi(historyRoute, async (context) => {
    const { productId } = context.req.valid('param');
    const { days, limit } = context.req.valid('query');
    const data = await history.execute({ productId, days, limit });
    return context.json(
      {
        data: data.map((point) => ({ ...point, observedAt: point.observedAt.toISOString() })),
        meta: { count: data.length },
      },
      200,
    );
  });
  routes.openapi(submitRoute, async (context) => {
    const input = context.req.valid('json');
    const idempotencyKey = context.req.valid('header')['idempotency-key'];
    const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
    await submit.execute({ ...input, observedAt, idempotencyKey });
    return context.json({ data: { status: 'accepted' as const, idempotencyKey } }, 202);
  });
  return routes;
}
