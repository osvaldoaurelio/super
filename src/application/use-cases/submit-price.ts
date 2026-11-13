import type { PriceJobQueue } from '../ports/price-job-queue.ts';
import { Price, type PriceProps } from '../../domain/prices/price.ts';

export class SubmitPrice {
  constructor(private readonly queue: PriceJobQueue) {}
  async execute(input: PriceProps): Promise<void> {
    const price = Price.create(input);
    await this.queue.enqueue(price.props);
  }
}
