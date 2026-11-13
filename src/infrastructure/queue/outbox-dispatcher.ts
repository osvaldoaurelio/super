import type { OutboxEvent, OutboxStore } from '../../application/ports/outbox-store.ts';
import { logger } from '../observability/logger.ts';
import {
  outboxBacklog,
  outboxDeadEvents,
  outboxDeadLettered,
  outboxDispatchFailures,
} from '../observability/metrics.ts';
import { DrizzleOutboxStore } from './drizzle-outbox-store.ts';
import { getPriceQueue } from './price-queue.ts';
import { PricePropsSchema } from './price-props-schema.ts';

/** Eventos lidos por ciclo do dispatcher. */
export const OUTBOX_BATCH_SIZE = 50;
const IDLE_SLEEP_MS = 500;
const FAILURE_SLEEP_MS = 1_000;
const STORE_FAILURE_SLEEP_MS = 5_000;
const BACKLOG_REFRESH_MS = 15_000;

export type OutboxPublisher = (event: OutboxEvent) => Promise<void>;

export class PermanentOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}

export type OutboxDispatcherDeps = {
  store: OutboxStore;
  publish: OutboxPublisher;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publica um lote de eventos pendentes.
 *
 * Uma falha de publicação incrementa `attempts` do evento e segue para o próximo:
 * o evento envenenado não bloqueia os demais e, ao atingir `OUTBOX_MAX_ATTEMPTS`,
 * deixa de ser selecionado.
 *
 * @returns quantidade de eventos lidos do store neste lote.
 */
export async function dispatchPendingBatch(
  deps: OutboxDispatcherDeps,
  limit = OUTBOX_BATCH_SIZE,
): Promise<number> {
  const events = await deps.store.claimPending(limit);
  for (const event of events) {
    try {
      await deps.publish(event);
      await deps.store.markPublished(event.id, deps.now());
    } catch (error) {
      if (error instanceof PermanentOutboxError) {
        const markedDead = await deps.store.markDead(event.id, error.message);
        if (markedDead) outboxDeadLettered.inc();
        outboxDispatchFailures.inc({ outcome: 'dead' });
        logger.error({ eventId: event.id, eventType: event.type, err: error }, 'outbox_event_dead');
        continue;
      }
      const outcome = await deps.store.markFailed(event.id, toErrorMessage(error));
      outboxDispatchFailures.inc({ outcome });
      logger.error(
        {
          eventId: event.id,
          eventType: event.type,
          attempts: event.attempts + 1,
          outcome,
          err: error,
        },
        outcome === 'exhausted' ? 'outbox_event_exhausted' : 'outbox_dispatch_failed',
      );
      if (outcome === 'retry') await deps.sleep(FAILURE_SLEEP_MS);
    }
  }
  return events.length;
}

export async function refreshOutboxBacklog(store: OutboxStore): Promise<void> {
  const [pending, dead] = await Promise.all([store.countPending(), store.countDead()]);
  outboxBacklog.set(pending);
  outboxDeadEvents.set(dead);
}

let stopping = false;
export function stopOutboxDispatcher(): void {
  stopping = true;
}

export async function runOutboxDispatcher(
  deps: OutboxDispatcherDeps = createOutboxDispatcherDeps(),
): Promise<void> {
  let lastBacklogRefresh = 0;
  while (!stopping) {
    try {
      const processed = await dispatchPendingBatch(deps, OUTBOX_BATCH_SIZE);
      const now = deps.now().getTime();
      if (now - lastBacklogRefresh >= BACKLOG_REFRESH_MS) {
        lastBacklogRefresh = now;
        await refreshOutboxBacklog(deps.store);
      }
      if (processed === 0) await deps.sleep(IDLE_SLEEP_MS);
    } catch (error) {
      logger.error({ err: error }, 'outbox_dispatch_loop_failed');
      await deps.sleep(STORE_FAILURE_SLEEP_MS);
    }
  }
}

async function publishOutboxEvent(event: OutboxEvent): Promise<void> {
  if (event.type !== 'price.record') {
    throw new PermanentOutboxError(`Tipo de evento de outbox não suportado: ${event.type}`);
  }
  const parsed = PricePropsSchema.safeParse(event.payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
      .join('; ');
    throw new PermanentOutboxError(`Payload inválido: ${issues}`);
  }
  await getPriceQueue().add('record-price', parsed.data, { jobId: event.id });
}

export function createOutboxDispatcherDeps(): OutboxDispatcherDeps {
  return {
    store: new DrizzleOutboxStore(),
    publish: publishOutboxEvent,
    sleep: (ms) => Bun.sleep(ms),
    now: () => new Date(),
  };
}
