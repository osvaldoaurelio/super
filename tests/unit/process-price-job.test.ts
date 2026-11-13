import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { processPriceJob } from '../../src/infrastructure/queue/process-price-job.ts';

describe('processPriceJob', () => {
  const validPayload = {
    productId: '123e4567-e89b-42d3-a456-426614174000',
    storeId: '123e4567-e89b-42d3-a456-426614174001',
    priceCents: 599,
    observedAt: new Date().toISOString(),
    source: 'partner-feed',
    idempotencyKey: 'request-1',
  };

  it('moves permanent payload failures to the DLQ and disables job retries', async () => {
    const repository = { record: vi.fn() };
    const cache = { bumpVersion: vi.fn() };
    const outbox = { markDead: vi.fn().mockResolvedValue(true) };

    await expect(
      processPriceJob({ ...validPayload, priceCents: 0 }, 'event-1', {
        repository,
        cache,
        outbox,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(outbox.markDead).toHaveBeenCalledWith(
      'event-1',
      expect.stringContaining('priceCents: Too small'),
    );
    expect(repository.record).not.toHaveBeenCalled();
  });

  it('leaves transient repository errors retryable', async () => {
    const error = new Error('Postgres indisponível');
    const repository = { record: vi.fn().mockRejectedValue(error) };
    const cache = { bumpVersion: vi.fn() };
    const outbox = { markDead: vi.fn() };

    await expect(
      processPriceJob(validPayload, 'event-1', { repository, cache, outbox }),
    ).rejects.toBe(error);

    expect(outbox.markDead).not.toHaveBeenCalled();
  });
});
