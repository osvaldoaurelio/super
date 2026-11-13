import Redis from 'ioredis';
import type { Cache } from '../../application/ports/cache.ts';
import { env } from '../../config/env.ts';
import { logger } from '../observability/logger.ts';

export class RedisCache implements Cache {
  private redis: Redis | undefined;
  private client(): Redis {
    this.redis ??= new Redis(env.REDIS_CACHE_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      lazyConnect: true,
    });
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

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
