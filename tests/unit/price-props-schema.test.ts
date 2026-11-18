import { describe, expect, it } from 'vitest';
import {
  PriceJobSchema,
  PricePropsSchema,
} from '../../src/infrastructure/queue/price-props-schema.ts';

describe('PricePropsSchema', () => {
  const validPayload = {
    productId: '123e4567-e89b-42d3-a456-426614174000',
    storeId: '123e4567-e89b-42d3-a456-426614174001',
    priceCents: 599,
    priceType: 'promo',
    observedAt: '2026-11-13T12:00:00.000Z',
    source: 'partner-feed',
    idempotencyKey: 'request-1',
  };

  it('validates queue JSON and converts observedAt to Date', () => {
    const parsed = PricePropsSchema.parse(validPayload);

    expect(parsed.observedAt).toEqual(new Date(validPayload.observedAt));
    expect(parsed.priceType).toBe('promo');
  });

  it('defaults legacy payloads to regular prices', () => {
    expect(PricePropsSchema.parse({ ...validPayload, priceType: undefined }).priceType).toBe(
      'regular',
    );
  });

  it('accepts a versioned price job with a valid traceparent', () => {
    const job = PriceJobSchema.parse({
      version: 1,
      price: validPayload,
      traceparent: '00-123e4567e89b42d3a456426614174000-123e4567e89b42d3-01',
    });
    expect(job.version).toBe(1);
    expect(job.price.observedAt).toEqual(new Date(validPayload.observedAt));
  });

  it.each([
    ['missing product ID', { ...validPayload, productId: undefined }],
    ['invalid store ID', { ...validPayload, storeId: 'not-a-uuid' }],
    ['non-positive price', { ...validPayload, priceCents: 0 }],
    ['invalid observation date', { ...validPayload, observedAt: 'not-a-date' }],
    ['extra field', { ...validPayload, unexpected: true }],
  ])('rejects %s', (_description, payload) => {
    expect(PricePropsSchema.safeParse(payload).success).toBe(false);
  });
});
