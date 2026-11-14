import Redis from 'ioredis';
import type { Cache } from '../../application/ports/cache.ts';
import { env } from '../../config/env.ts';
import { logger } from '../observability/logger.ts';

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export class RedisCache implements Cache {
  private redis: Redis | undefined;
  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis(env.REDIS_CACHE_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 3_000,
        lazyConnect: true,
      });
      this.redis.on('error', (error: Error) => {
        logger.debug({ err: error }, 'redis_cache_connection_error');
      });
    }
    return this.redis;
  }

  async ping(): Promise<void> {
    await this.client().ping();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client().get(key);
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client().set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* Redis is an optimization, not a source of truth. */
    }
  }

  async bumpVersion(key: string): Promise<number> {
    try {
      return await this.client().incr(key);
    } catch (error) {
      logger.warn({ err: error, key }, 'cache_version_bump_failed');
      return 0;
    }
  }

  async incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const result: unknown = await this.client().eval(FIXED_WINDOW_SCRIPT, 1, key, windowSeconds);
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      typeof result[0] !== 'number' ||
      !Number.isSafeInteger(result[0]) ||
      typeof result[1] !== 'number' ||
      !Number.isSafeInteger(result[1]) ||
      result[1] < 0
    ) {
      throw new Error('Resposta Redis inválida ao incrementar contador de rate limit.');
    }
    return { count: result[0], ttlSeconds: result[1] };
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
