import { z } from 'zod';

export const PricePropsSchema = z
  .object({
    productId: z.string().uuid(),
    storeId: z.string().uuid(),
    priceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    observedAt: z.iso.datetime().transform((value) => new Date(value)),
    source: z.string().min(1).max(64),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();
