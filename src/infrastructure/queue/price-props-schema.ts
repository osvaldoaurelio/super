import { z } from 'zod';

const PricePropsObjectSchema = z
  .object({
    productId: z.uuid(),
    storeId: z.uuid(),
    priceCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    priceType: z.enum(['regular', 'promo']).default('regular'),
    observedAt: z.iso.datetime().transform((value) => new Date(value)),
    source: z.string().min(1).max(64),
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict();

export const PricePropsSchema = PricePropsObjectSchema;
export const PriceJobSchema = z
  .object({
    version: z.literal(1),
    price: PricePropsObjectSchema,
    traceparent: z
      .string()
      .regex(/^(?!ff)[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i)
      .refine((value) => {
        const [, traceId, parentId] = value.split('-');
        return traceId !== '0'.repeat(32) && parentId !== '0'.repeat(16);
      })
      .optional(),
  })
  .strict();
