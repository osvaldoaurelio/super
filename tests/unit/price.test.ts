import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Price } from '../../src/domain/prices/price.ts';

describe('Price', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const valid = {
    productId: 'p1',
    storeId: 's1',
    priceCents: 499,
    observedAt: now,
    source: 'catalog',
    idempotencyKey: 'request-1',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('rejects observations more than five minutes in the future', () => {
    const observedAt = new Date(now.getTime() + 5 * 60 * 1_000 + 1);
    expect(() => Price.create({ ...valid, observedAt })).toThrowError(
      expect.objectContaining({ code: 'OBSERVED_AT_IN_FUTURE' }),
    );
  });

  it('rejects observations more than 365 days old', () => {
    const observedAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1_000 - 1);
    expect(() => Price.create({ ...valid, observedAt })).toThrowError(
      expect.objectContaining({ code: 'OBSERVED_AT_TOO_OLD' }),
    );
  });

  it.each([
    ['future tolerance', new Date(now.getTime() + 5 * 60 * 1_000)],
    ['maximum age', new Date(now.getTime() - 365 * 24 * 60 * 60 * 1_000)],
  ])('accepts observations at the %s boundary', (_name, observedAt) => {
    expect(() => Price.create({ ...valid, observedAt })).not.toThrow();
  });

  it('requires product, store, source and idempotency key', () => {
    expect(() => Price.create({ ...valid, productId: '' })).toThrow();
    expect(() => Price.create({ ...valid, idempotencyKey: '' })).toThrow();
  });
});
