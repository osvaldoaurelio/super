import { UnrecoverableError } from 'bullmq';
import { ZodError } from 'zod';
import type { Cache } from '../../application/ports/cache.ts';
import type { OutboxStore } from '../../application/ports/outbox-store.ts';
import type { PriceRepository } from '../../application/ports/price-repository.ts';
import { DomainError } from '../../domain/errors.ts';
import { Price } from '../../domain/prices/price.ts';
import { logger } from '../observability/logger.ts';
import { outboxDeadLettered } from '../observability/metrics.ts';
import { PricePropsSchema } from './price-props-schema.ts';

type PriceJobDeps = {
  repository: Pick<PriceRepository, 'record'>;
  cache: Pick<Cache, 'bumpVersion'>;
  outbox: Pick<OutboxStore, 'markDead'>;
};

function findForeignKeyViolation(error: unknown): { message: string } | undefined {
  let current = error;
  const seen = new Set<object>();
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23503') {
      return {
        message:
          'message' in current && typeof current.message === 'string'
            ? current.message
            : 'Violação de chave estrangeira.',
      };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function isPermanentPriceError(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    error instanceof DomainError ||
    findForeignKeyViolation(error) !== undefined
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
      .join('; ');
  }
  const foreignKeyViolation = findForeignKeyViolation(error);
  if (foreignKeyViolation) return foreignKeyViolation.message;
  return error instanceof Error ? error.message : String(error);
}

export async function processPriceJob(
  data: unknown,
  jobId: string | undefined,
  deps: PriceJobDeps,
): Promise<{ stored: true }> {
  try {
    const price = Price.create(PricePropsSchema.parse(data));
    await deps.repository.record(price);
    await Promise.all([
      deps.cache.bumpVersion(`prices:ver:${price.props.productId}`),
      deps.cache.bumpVersion(`history:ver:${price.props.productId}`),
    ]);
    return { stored: true };
  } catch (error) {
    if (!isPermanentPriceError(error)) throw error;
    if (!jobId) {
      throw new Error('Não é possível enviar um job inválido à DLQ sem seu ID de outbox.', {
        cause: error,
      });
    }

    const markedDead = await deps.outbox.markDead(jobId, errorMessage(error));
    if (markedDead) outboxDeadLettered.inc();
    logger.error({ eventId: jobId, err: error }, 'price_ingestion_moved_to_dead_letter_queue');
    throw new UnrecoverableError('Evento de preço inválido ou com referência inexistente.');
  }
}
