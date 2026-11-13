import { randomUUID } from 'node:crypto';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { logger } from '../infrastructure/observability/logger.ts';
import {
  httpDuration,
  httpRequests,
  metricsRegistry,
} from '../infrastructure/observability/metrics.ts';
import { authRoutes } from './routes/auth.ts';
import { createPriceRoutes } from './routes/prices.ts';
import { DrizzlePriceRepository } from '../infrastructure/database/price-repository-drizzle.ts';
import { RedisCache } from '../infrastructure/cache/redis-cache.ts';
import { BullPriceQueue } from '../infrastructure/queue/price-queue.ts';
import { DomainError } from '../domain/errors.ts';
import type { AppEnv } from './types.ts';

export function createApp() {
  const app = new OpenAPIHono<AppEnv>();
  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id')?.slice(0, 128) || randomUUID();
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);
    const started = performance.now();
    const tracer = trace.getTracer('super-api');
    await tracer.startActiveSpan('http.server', async (span) => {
      span.setAttribute('http.request.method', context.req.method);
      try {
        await next();
        const route = context.req.routePath ?? 'unmatched';
        span.setAttribute('http.route', route);
        span.setAttribute('http.response.status_code', context.res.status);
        if (context.res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        const route = context.req.routePath ?? 'unmatched';
        const status = String(context.res.status);
        httpRequests.inc({ method: context.req.method, route, status });
        httpDuration.observe(
          { method: context.req.method, route },
          (performance.now() - started) / 1000,
        );
        span.end();
        logger.info(
          {
            requestId,
            method: context.req.method,
            route,
            status: context.res.status,
            durationMs: Math.round(performance.now() - started),
          },
          'http_request',
        );
      }
    });
  });
  app.onError((error, context) => {
    if (error instanceof DomainError) {
      return context.json({ error: { code: error.code, message: error.message } }, 400);
    }
    logger.error({ requestId: context.get('requestId'), err: error }, 'request_failed');
    return context.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } },
      500,
    );
  });
  app.notFound((context) =>
    context.json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }, 404),
  );
  app.get('/health/live', (context) => context.json({ status: 'ok' }));
  app.get('/health/worker', async (context) => {
    try {
      const { getQueueRedis } = await import('../infrastructure/queue/price-queue.ts');
      const connection = getQueueRedis();
      if (connection.status === 'wait') await connection.connect();
      await connection.ping();
      return context.json({ status: 'ok' });
    } catch {
      return context.json({ status: 'error' }, 503);
    }
  });
  app.get('/health/ready', async (context) => {
    const checks: Record<string, string> = {};
    try {
      const { sqlClient } = await import('../infrastructure/database/client.ts');
      await sqlClient`select 1`;
      checks['postgres'] = 'ok';
    } catch {
      checks['postgres'] = 'error';
    }
    try {
      const { RedisCache } = await import('../infrastructure/cache/redis-cache.ts');
      const redis = new RedisCache();
      await redis.ping();
      await redis.close();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }
    const ready = Object.values(checks).every((value) => value === 'ok');
    return context.json({ status: ready ? 'ok' : 'error', checks }, ready ? 200 : 503);
  });
  app.get('/metrics', async (context) => {
    const token = process.env['METRICS_TOKEN'];
    if (token && context.req.header('authorization') !== `Bearer ${token}`) {
      return context.json(
        { error: { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' } },
        401,
      );
    }
    context.header('Content-Type', metricsRegistry.contentType);
    return context.body(await metricsRegistry.metrics());
  });
  app.route('/api/v1/auth', authRoutes);
  app.route(
    '/api/v1/prices',
    createPriceRoutes({
      repository: new DrizzlePriceRepository(),
      cache: new RedisCache(),
      queue: new BullPriceQueue(),
    }),
  );
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Super API',
      version: '1.0.0',
      description: 'API de comparação e histórico de preços de supermercados.',
    },
    servers: [{ url: '/api/v1' }],
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));
  return app;
}
