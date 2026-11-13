import Redis from 'ioredis';
import type { Cache } from '../../application/ports/cache.ts';
import { env } from '../../config/env.ts';

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

  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client().scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await this.client().unlink(...keys);
      } while (cursor !== '0');
    } catch {
      /* Cache invalidation failure is bounded by TTL. */
    }
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
