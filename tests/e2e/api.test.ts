import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.ts';
import { signAccessToken } from '../../src/infrastructure/auth/jwt.ts';
import type { ProductSearch } from '../../src/application/ports/product-search.ts';
import type { StoreLocator } from '../../src/application/ports/store-locator.ts';
import type { RateLimitCounter } from '../../src/http/middleware/rate-limit.ts';
import type {
  PriceAlert,
  PriceAlertRepository,
} from '../../src/application/ports/price-alert-repository.ts';
import type { BasketPriceReader } from '../../src/application/ports/basket-price-reader.ts';
import type { Cache } from '../../src/application/ports/cache.ts';

function createMemoryRateLimitCounter(): RateLimitCounter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async incrementFixedWindow(key, windowSeconds) {
      const now = Date.now();
      let window = windows.get(key);
      if (!window || window.resetAt <= now) {
        window = { count: 0, resetAt: now + windowSeconds * 1_000 };
        windows.set(key, window);
      }
      window.count += 1;
      return {
        count: window.count,
        ttlSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1_000)),
      };
    },
  };
}

describe('REST API end-to-end', () => {
  const app = createApp();
  it('serves liveness and OpenAPI without external services', async () => {
    const health = await app.request('/health/live');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    const spec = await app.request('/openapi.json');
    expect(spec.status).toBe(200);
    const body = (await spec.json()) as { paths?: Record<string, unknown> };
    expect(body.paths).toHaveProperty('/api/v1/prices/{productId}/compare');
    expect(body.paths).toHaveProperty('/api/v1/products/search');
    expect(body.paths).toHaveProperty('/api/v1/stores/nearby');
    expect(body.paths).toHaveProperty('/api/v1/alerts');
    expect(body.paths).toHaveProperty('/api/v1/alerts/{alertId}');
    expect(body.paths).toHaveProperty('/api/v1/baskets/compare');
    const loginPath = body.paths?.['/api/v1/auth/login'] as
      { post?: { responses?: Record<string, unknown> } } | undefined;
    expect(loginPath?.post?.responses).toHaveProperty('429');
  });
  it('rejects an invalid price UUID before touching the database', async () => {
    const response = await app.request('/api/v1/prices/not-a-uuid/compare');
    expect(response.status).toBe(400);
  });
  it('protects price submissions with JWT authentication', async () => {
    const response = await app.request('/api/v1/prices', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        productId: crypto.randomUUID(),
        storeId: crypto.randomUUID(),
        priceCents: 100,
        source: 'test',
      }),
    });
    expect(response.status).toBe(401);
  });

  it('rate limits login and registration by client IP with Retry-After', async () => {
    const limitedApp = createApp({
      rateLimitCounter: createMemoryRateLimitCounter(),
      rateLimitMax: 1,
      rateLimitWindowSeconds: 60,
    });
    const sendAuthRequest = (path: string, clientIp: string) =>
      limitedApp.request(
        `/api/v1/auth/${path}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
        { clientIp },
      );

    expect((await sendAuthRequest('login', '192.0.2.10')).status).toBe(400);
    const limitedLogin = await sendAuthRequest('login', '192.0.2.10');
    expect(limitedLogin.status).toBe(429);
    expect(await limitedLogin.json()).toMatchObject({
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    expect(Number(limitedLogin.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await sendAuthRequest('login', '192.0.2.11')).status).toBe(400);

    expect((await sendAuthRequest('register', '192.0.2.10')).status).toBe(400);
    expect((await sendAuthRequest('register', '192.0.2.10')).status).toBe(429);
  });

  it('rate limits price submissions by authenticated user and client IP', async () => {
    const limitedApp = createApp({
      rateLimitCounter: createMemoryRateLimitCounter(),
      rateLimitMax: 1,
      rateLimitWindowSeconds: 60,
      priceQueue: { enqueue: async () => {} },
    });
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const token = await signAccessToken(userId);
    const otherToken = await signAccessToken(otherUserId);
    const sendPrice = (accessToken: string, clientIp: string) =>
      limitedApp.request(
        '/api/v1/prices',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            productId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            priceCents: 100,
            source: 'test',
          }),
        },
        { clientIp },
      );

    expect((await sendPrice(token, '192.0.2.10')).status).toBe(202);
    const limitedPrice = await sendPrice(token, '192.0.2.10');
    expect(limitedPrice.status).toBe(429);
    expect(Number(limitedPrice.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await sendPrice(token, '192.0.2.11')).status).toBe(202);
    expect((await sendPrice(otherToken, '192.0.2.10')).status).toBe(202);
  });

  it('fails open when the rate-limit store is unavailable', async () => {
    const availableQueue = { enqueue: async () => {} };
    const failOpenApp = createApp({
      rateLimitCounter: {
        incrementFixedWindow: async () => {
          throw new Error('Redis indisponível.');
        },
      },
      priceQueue: availableQueue,
    });
    const token = await signAccessToken(crypto.randomUUID());

    const response = await failOpenApp.request(
      '/api/v1/prices',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          productId: crypto.randomUUID(),
          storeId: crypto.randomUUID(),
          priceCents: 100,
          source: 'test',
        }),
      },
      { clientIp: '192.0.2.10' },
    );

    expect(response.status).toBe(202);
  });

  it('searches products and validates search query parameters', async () => {
    const productSearch: ProductSearch = {
      search: async ({ query }) => [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          gtin: null,
          name: 'Leite Integral',
          brand: 'Fazenda Azul',
          category: 'Laticínios',
          unit: '1 L',
          relevance: query === 'leite' ? 0.95 : 0.8,
        },
      ],
    };
    const searchApp = createApp({ productSearch });

    const response = await searchApp.request('/api/v1/products/search?q=leite&limit=5');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ name: 'Leite Integral', relevance: 0.95 }],
      meta: { count: 1 },
    });
    expect((await searchApp.request('/api/v1/products/search?q=ab')).status).toBe(400);
    expect(
      (await searchApp.request('/api/v1/products/search?q=leite&cursor=not-valid')).status,
    ).toBe(400);
  });

  it('finds nearby stores and validates geographic query parameters', async () => {
    const storeLocator: StoreLocator = {
      findNearby: async () => [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          name: 'Loja Centro',
          chain: 'Mercado Exemplo',
          city: 'São Paulo',
          state: 'SP',
          latitude: -23.55052,
          longitude: -46.633308,
          distanceKm: 0.01,
        },
      ],
    };
    const nearbyApp = createApp({ storeLocator });

    const response = await nearbyApp.request(
      '/api/v1/stores/nearby?lat=-23.55&lng=-46.63&radiusKm=5',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ name: 'Loja Centro', lat: -23.55052, lng: -46.633308, distanceKm: 0.01 }],
      meta: { count: 1 },
    });
    expect((await nearbyApp.request('/api/v1/stores/nearby?lat=91&lng=0&radiusKm=5')).status).toBe(
      400,
    );
    expect((await nearbyApp.request('/api/v1/stores/nearby?lat=0&lng=0&radiusKm=100')).status).toBe(
      400,
    );
  });

  it('protects price-alert CRUD and scopes every operation to the JWT user', async () => {
    const records = new Map<string, PriceAlert & { userId: string }>();
    const priceAlertRepository: PriceAlertRepository = {
      listByUser: async (userId) =>
        [...records.values()].filter((alert) => alert.userId === userId),
      create: async (input) => {
        const alert = {
          id: crypto.randomUUID(),
          productId: input.productId,
          targetPriceCents: input.targetPriceCents,
          active: true,
          channel: input.channel,
          createdAt: new Date(),
          triggeredAt: null,
        };
        records.set(alert.id, { ...alert, userId: input.userId });
        return alert;
      },
      update: async (userId, alertId, input) => {
        const record = records.get(alertId);
        if (!record || record.userId !== userId) return null;
        const alert = {
          ...record,
          ...input,
          ...(input.active === true ? { triggeredAt: null } : {}),
        };
        records.set(alertId, alert);
        return alert;
      },
      delete: async (userId, alertId) => {
        const record = records.get(alertId);
        return record?.userId === userId ? records.delete(alertId) : false;
      },
    };
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const token = await signAccessToken(userId);
    const otherToken = await signAccessToken(otherUserId);
    const alertsApp = createApp({ priceAlertRepository });

    expect((await alertsApp.request('/api/v1/alerts')).status).toBe(401);
    const createResponse = await alertsApp.request('/api/v1/alerts', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        productId: crypto.randomUUID(),
        targetPriceCents: 500,
        channel: 'email',
        userId: otherUserId,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { data: { id: string } };
    expect(records.get(created.data.id)?.userId).toBe(userId);
    expect(
      (
        await alertsApp.request('/api/v1/alerts', {
          headers: { authorization: `Bearer ${otherToken}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await alertsApp.request(`/api/v1/alerts/${created.data.id}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${otherToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ active: false }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await alertsApp.request(`/api/v1/alerts/${created.data.id}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ active: false }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await alertsApp.request(`/api/v1/alerts/${created.data.id}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
  });

  it('compares complete baskets and orders store totals', async () => {
    const firstProductId = '123e4567-e89b-42d3-a456-426614174001';
    const secondProductId = '123e4567-e89b-42d3-a456-426614174002';
    const productIds = [firstProductId, secondProductId];
    const basketPriceReader: BasketPriceReader = {
      compareMany: async () => [
        {
          productId: firstProductId,
          storeId: '123e4567-e89b-42d3-a456-426614174011',
          storeName: 'Loja barata',
          city: 'São Paulo',
          state: 'SP',
          priceCents: 300,
          observedAt: new Date(),
        },
        {
          productId: secondProductId,
          storeId: '123e4567-e89b-42d3-a456-426614174011',
          storeName: 'Loja barata',
          city: 'São Paulo',
          state: 'SP',
          priceCents: 200,
          observedAt: new Date(),
        },
        {
          productId: firstProductId,
          storeId: '123e4567-e89b-42d3-a456-426614174012',
          storeName: 'Loja incompleta',
          city: 'São Paulo',
          state: 'SP',
          priceCents: 100,
          observedAt: new Date(),
        },
      ],
    };
    const cacheValues = new Map<string, unknown>();
    const cache: Cache = {
      get: async <T>(key: string) => (cacheValues.get(key) as T | undefined) ?? null,
      set: async <T>(key: string, value: T) => {
        cacheValues.set(key, value);
      },
      bumpVersion: async () => 1,
    };
    const basketsApp = createApp({ basketPriceReader, cache });
    const response = await basketsApp.request('/api/v1/baskets/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productIds }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ storeName: 'Loja barata', totalCents: 500, items: [{}, {}] }],
      meta: { count: 1 },
    });
    expect(
      (
        await basketsApp.request('/api/v1/baskets/compare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productIds: [firstProductId, firstProductId] }),
        })
      ).status,
    ).toBe(400);
  });
});
