import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.ts';
import { signAccessToken } from '../../src/infrastructure/auth/jwt.ts';
import type { RateLimitCounter } from '../../src/http/middleware/rate-limit.ts';

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
});
