import type { PriceProps } from '../../domain/prices/price.ts';

export interface PriceJobQueue {
  enqueue(price: PriceProps): Promise<void>;
}
