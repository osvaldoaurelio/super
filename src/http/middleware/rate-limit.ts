import type { Context, MiddlewareHandler } from 'hono';
import { logger } from '../../infrastructure/observability/logger.ts';
import type { AppEnv } from '../types.ts';

export type RateLimitCounter = {
  incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<{
    count: number;
    ttlSeconds: number;
  }>;
};

type RateLimitOptions = {
  scope: string;
  max: number;
  windowSeconds: number;
  counter: RateLimitCounter;
  identifier: (context: Context<AppEnv>) => string | undefined;
};

export function createRateLimitMiddleware({
  scope,
  max,
  windowSeconds,
  counter,
  identifier,
}: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const identity = identifier(context);
    if (!identity) {
      logger.warn({ scope }, 'rate_limit_client_ip_unavailable');
      await next();
      return;
    }

    try {
      const { count, ttlSeconds } = await counter.incrementFixedWindow(
        `rl:${scope}:${identity}`,
        windowSeconds,
      );
      if (count > max) {
        context.header('Retry-After', String(Math.max(1, ttlSeconds)));
        return context.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Limite de requisições excedido.',
            },
          },
          429,
        );
      }
    } catch (error) {
      logger.warn({ err: error, scope }, 'rate_limit_store_unavailable');
    }

    await next();
  };
}
