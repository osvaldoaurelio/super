import { DomainError } from '../errors.ts';

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
    if (!props.productId || !props.storeId || !props.source || !props.idempotencyKey) {
      throw new DomainError(
        'Produto, loja, origem e chave de idempotência são obrigatórios.',
        'MISSING_PRICE_FIELDS',
      );
    }
    return new Price({ ...props, observedAt: new Date(props.observedAt) });
  }
}
