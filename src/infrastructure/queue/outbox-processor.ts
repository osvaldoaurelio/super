import { ZodError } from 'zod';
import type { Cache } from '../../application/ports/cache.ts';
import { DomainError } from '../../domain/errors.ts';
import { Price } from '../../domain/prices/price.ts';
import { PricePropsSchema } from './price-props-schema.ts';
import { RedisCache } from '../cache/redis-cache.ts';
import { logger } from '../observability/logger.ts';
import { outboxDeadLettered, outboxProcessingFailures } from '../observability/metrics.ts';
import { db } from '../database/client.ts';
import { DrizzlePriceRepository } from '../database/price-repository-drizzle.ts';
import { DrizzleOutboxStore } from './drizzle-outbox-store.ts';
import { type OutboxEvent, type OutboxFailureOutcome } from './outbox-types.ts';

export const OUTBOX_BATCH_SIZE = 200;

export type OutboxBatchResult = {
  claimed: number;
  retryableFailures: number;
};

export type OutboxProcessorDeps = {
  store: Pick<DrizzleOutboxStore, 'claimPending' | 'markProcessed' | 'markFailed' | 'markDead'>;
  repository: Pick<DrizzlePriceRepository, 'recordInTransaction'>;
  cache: Pick<Cache, 'bumpVersion'>;
  now: () => Date;
};

type EventOutcome =
  | { kind: 'processed'; event: OutboxEvent; productId: string }
  | { kind: 'dead'; event: OutboxEvent; error: unknown }
  | {
      kind: 'failed';
      event: OutboxEvent;
      error: unknown;
      attempts: number;
      failure: OutboxFailureOutcome;
    };

export class PermanentOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}

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
    error instanceof PermanentOutboxError ||
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

function parseEvent(event: OutboxEvent): ReturnType<typeof Price.create> {
  if (event.type !== 'price.record') {
    throw new PermanentOutboxError(`Tipo de evento de outbox não suportado: ${event.type}`);
  }
  return Price.create(PricePropsSchema.parse(event.payload));
}

export async function processPendingOutboxBatch(
  deps: OutboxProcessorDeps = createOutboxProcessorDeps(),
  limit = OUTBOX_BATCH_SIZE,
): Promise<OutboxBatchResult> {
  const outcomes = await db.transaction(async (tx): Promise<EventOutcome[]> => {
    const events = await deps.store.claimPending(tx, limit);
    const results: EventOutcome[] = [];

    for (const event of events) {
      try {
        const price = parseEvent(event);
        await tx.transaction(async (eventTx) => {
          await deps.repository.recordInTransaction(eventTx, price);
          await deps.store.markProcessed(eventTx, event.id, deps.now());
        });
        results.push({ kind: 'processed', event, productId: price.props.productId });
      } catch (error) {
        if (isPermanentPriceError(error)) {
          const marked = await deps.store.markDead(tx, event.id, errorMessage(error));
          if (!marked) throw new Error(`Não foi possível mover o evento ${event.id} para dead.`);
          results.push({ kind: 'dead', event, error });
          continue;
        }

        const outcome = await deps.store.markFailed(tx, event.id, errorMessage(error));
        results.push({
          kind: 'failed',
          event,
          error,
          attempts: event.attempts + 1,
          failure: outcome,
        });
      }
    }
    return results;
  });

  const successfulProductIds = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.kind === 'processed') {
      successfulProductIds.add(outcome.productId);
      continue;
    }
    if (outcome.kind === 'dead') {
      outboxDeadLettered.inc();
      outboxProcessingFailures.inc({ outcome: 'dead' });
      logger.error(
        { eventId: outcome.event.id, eventType: outcome.event.type, err: outcome.error },
        'outbox_event_dead',
      );
      continue;
    }
    outboxProcessingFailures.inc({ outcome: outcome.failure });
    logger.error(
      {
        eventId: outcome.event.id,
        eventType: outcome.event.type,
        attempts: outcome.attempts,
        outcome: outcome.failure,
        err: outcome.error,
      },
      outcome.failure === 'exhausted' ? 'outbox_event_exhausted' : 'outbox_processing_failed',
    );
  }

  await Promise.all(
    [...successfulProductIds].flatMap((productId) => [
      deps.cache.bumpVersion(`prices:ver:${productId}`),
      deps.cache.bumpVersion(`history:ver:${productId}`),
    ]),
  );
  if (outcomes.length > 0) {
    logger.info(
      {
        processed: outcomes.filter((outcome) => outcome.kind === 'processed').length,
        dead: outcomes.filter((outcome) => outcome.kind === 'dead').length,
        failed: outcomes.filter((outcome) => outcome.kind === 'failed').length,
      },
      'outbox_batch_processed',
    );
  }
  return {
    claimed: outcomes.length,
    retryableFailures: outcomes.filter(
      (outcome) => outcome.kind === 'failed' && outcome.failure === 'retry',
    ).length,
  };
}

export function createOutboxProcessorDeps(): OutboxProcessorDeps {
  return {
    store: new DrizzleOutboxStore(),
    repository: new DrizzlePriceRepository(),
    cache: new RedisCache(),
    now: () => new Date(),
  };
}
