import { z } from 'zod';

export const PriceRecordedSchema = z
  .object({
    productId: z.string().uuid(),
    storeId: z.string().uuid(),
    previousPriceCents: z.number().int().positive().nullable(),
    priceCents: z.number().int().positive(),
    currentPriceUpdated: z.boolean(),
    observedAt: z.iso.datetime(),
  })
  .strict();

export type PriceRecordedEvent = z.infer<typeof PriceRecordedSchema>;
