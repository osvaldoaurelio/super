import { describe, expect, it } from 'vitest';
import { Price } from '../../src/domain/prices/price.ts';

describe('Price', () => {
  const valid = {
    productId: 'p1',
    storeId: 's1',
    priceCents: 499,
    observedAt: new Date('2026-01-01T12:00:00Z'),
    source: 'catalog',
    idempotencyKey: 'request-1',
  };

  it('creates a price in integer cents', () => {
    const price = Price.create(valid);
    expect(price.props.priceCents).toBe(499);
    expect(price.props.observedAt).not.toBe(valid.observedAt);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid cents: %s', (priceCents) => {
    expect(() => Price.create({ ...valid, priceCents })).toThrow();
  });

  it('rejects invalid dates', () => {
    expect(() => Price.create({ ...valid, observedAt: new Date('invalid') })).toThrow();
  });

  it('requires product, store, source and idempotency key', () => {
    expect(() => Price.create({ ...valid, productId: '' })).toThrow();
    expect(() => Price.create({ ...valid, idempotencyKey: '' })).toThrow();
  });
});
