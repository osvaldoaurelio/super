export type PriceAlertChannel = 'email' | 'push';

export type PriceAlert = {
  id: string;
  productId: string;
  targetPriceCents: number;
  active: boolean;
  channel: PriceAlertChannel;
  createdAt: Date;
  triggeredAt: Date | null;
};

export type CreatePriceAlertInput = {
  userId: string;
  productId: string;
  targetPriceCents: number;
  channel: PriceAlertChannel;
};

export type UpdatePriceAlertInput = {
  targetPriceCents?: number;
  active?: boolean;
  channel?: PriceAlertChannel;
};

export interface PriceAlertRepository {
  listByUser(userId: string): Promise<PriceAlert[]>;
  create(input: CreatePriceAlertInput): Promise<PriceAlert>;
  update(userId: string, alertId: string, input: UpdatePriceAlertInput): Promise<PriceAlert | null>;
  delete(userId: string, alertId: string): Promise<boolean>;
}
