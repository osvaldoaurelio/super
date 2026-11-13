import { DomainError } from '../errors.ts';

export const PRICE_FRESHNESS_WINDOW_DAYS = 30;

const MAX_FUTURE_OBSERVATION_MS = 5 * 60 * 1_000;
const MAX_OBSERVATION_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

export type PriceProps = {
  productId: string;
  storeId: string;
  priceCents: number;
  observedAt: Date;
  source: string;
  idempotencyKey: string;
};

export class Price {
  private constructor(readonly props: PriceProps) {}

  static create(props: PriceProps): Price {
    if (!Number.isSafeInteger(props.priceCents) || props.priceCents <= 0) {
      throw new DomainError('O preço deve ser um inteiro positivo em centavos.', 'INVALID_PRICE');
    }
    if (Number.isNaN(props.observedAt.getTime())) {
      throw new DomainError('A data de observação é inválida.', 'INVALID_DATE');
    }
    const now = Date.now();
    const observedAt = props.observedAt.getTime();
    if (observedAt > now + MAX_FUTURE_OBSERVATION_MS) {
      throw new DomainError(
        'A data de observação não pode estar mais de 5 minutos no futuro.',
        'OBSERVED_AT_IN_FUTURE',
      );
    }
    if (observedAt < now - MAX_OBSERVATION_AGE_MS) {
      throw new DomainError(
        'A data de observação não pode ter mais de 365 dias.',
        'OBSERVED_AT_TOO_OLD',
      );
    }
    if (!props.productId || !props.storeId || !props.source || !props.idempotencyKey) {
      throw new DomainError(
        'Produto, loja, origem e chave de idempotência são obrigatórios.',
        'MISSING_PRICE_FIELDS',
      );
    }
    return new Price({ ...props, observedAt: new Date(props.observedAt) });
  }
}
