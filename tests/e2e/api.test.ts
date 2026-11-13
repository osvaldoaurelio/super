import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.ts';

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
});
