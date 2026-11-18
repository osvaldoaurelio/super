import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Cache } from '../../application/ports/cache.ts';
import type { PriceJobQueue } from '../../application/ports/price-job-queue.ts';
import type { PriceReader } from '../../application/ports/price-repository.ts';
import { ComparePrices } from '../../application/use-cases/compare-prices.ts';
import { GetPriceHistory } from '../../application/use-cases/get-price-history.ts';
import { SubmitPrice } from '../../application/use-cases/submit-price.ts';
import type { MiddlewareHandler } from 'hono';
import { requireAuth } from '../middleware/auth.ts';
import type { AppEnv } from '../types.ts';
import { priceServedAge } from '../../infrastructure/observability/metrics.ts';

const Id = z.uuid();
const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const Offer = z.object({
  storeId: Id,
  storeName: z.string(),
  city: z.string(),
  state: z.string(),
  priceCents: z.number().int(),
  observedAt: z.iso.datetime(),
});
const CompareResponse = z.object({
  data: z.array(Offer),
  meta: z.object({ count: z.number().int() }),
});
const HistoryResponse = z.object({
  data: z.array(
    z.object({
      priceCents: z.number().int(),
      priceType: z.enum(['regular', 'promo']),
      observedAt: z.iso.datetime(),
    }),
  ),
  meta: z.object({ count: z.number().int(), nextCursor: z.string().optional() }),
});
const PriceInput = z.object({
  productId: Id,
  storeId: Id,
  priceCents: z.number().int().positive().max(10_000_000),
  priceType: z.enum(['regular', 'promo']).default('regular'),
  observedAt: z.iso.datetime().optional(),
  source: z.string().min(2).max(64),
});
const AcceptedResponse = z.object({
  data: z.object({ status: z.literal('accepted'), idempotencyKey: z.uuid() }),
});
const PriceCursor = z
  .string()
  .min(1)
  .max(256)
  .transform((value, context) => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const decoded = Buffer.from(value, 'base64url').toString('utf8');
      if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error();
      const separator = decoded.indexOf('|');
      if (separator < 0 || decoded.indexOf('|', separator + 1) >= 0) throw new Error();
      const observedAt = new Date(decoded.slice(0, separator));
      const id = z.uuid().parse(decoded.slice(separator + 1));
      if (
        Number.isNaN(observedAt.getTime()) ||
        observedAt.toISOString() !== decoded.slice(0, separator)
      )
        throw new Error();
      return { observedAt, id };
    } catch {
      context.addIssue({ code: 'custom', message: 'Cursor inválido.' });
      return z.NEVER;
    }
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
      limit: z.coerce.number().int().min(1).max(100).default(100),
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
      cursor: PriceCursor.optional(),
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
  repository: PriceReader;
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
      headers: z.object({ 'idempotency-key': z.uuid() }),
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
    const { city, state, limit } = context.req.valid('query');
    const location: { city?: string; state?: string } = {};
    if (city !== undefined) location.city = city;
    if (state !== undefined) location.state = state;
    const data = await compare.execute({ productId, ...location, limit });
    priceServedAge.set(
      data.reduce(
        (maximum, offer) => Math.max(maximum, (Date.now() - offer.observedAt.getTime()) / 1000),
        0,
      ),
    );
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
    const { days, limit, cursor } = context.req.valid('query');
    const page = await history.execute({
      productId,
      days,
      limit,
      ...(cursor ? { cursor } : {}),
    });
    const nextCursor = page.nextCursor
      ? Buffer.from(
          `${page.nextCursor.observedAt.toISOString()}|${page.nextCursor.id}`,
          'utf8',
        ).toString('base64url')
      : undefined;
    return context.json(
      {
        data: page.points.map(({ priceCents, priceType, observedAt }) => ({
          priceCents,
          priceType,
          observedAt: observedAt.toISOString(),
        })),
        meta: { count: page.points.length, ...(nextCursor ? { nextCursor } : {}) },
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
