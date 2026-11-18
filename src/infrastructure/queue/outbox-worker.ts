import { logger } from '../observability/logger.ts';
import { outboxBacklog, outboxDeadEvents, priceIngestionLag } from '../observability/metrics.ts';
import { DrizzleOutboxStore } from './drizzle-outbox-store.ts';
import {
  createOutboxProcessorDeps,
  processPendingOutboxBatch,
  type OutboxProcessorDeps,
} from './outbox-processor.ts';

const IDLE_SLEEP_MS = 500;
const RETRY_SLEEP_MS = 1_000;
const FAILURE_SLEEP_MS = 5_000;
const METRICS_REFRESH_MS = 15_000;

let stopping = false;

export function stopOutboxWorker(): void {
  stopping = true;
}

export async function refreshOutboxMetrics(
  store: Pick<DrizzleOutboxStore, 'countPending' | 'countDead' | 'oldestPendingCreatedAt'>,
): Promise<void> {
  const [pending, dead, oldestPending] = await Promise.all([
    store.countPending(),
    store.countDead(),
    store.oldestPendingCreatedAt(),
  ]);
  outboxBacklog.set(pending);
  outboxDeadEvents.set(dead);
  priceIngestionLag.set(
    oldestPending ? Math.max(0, (Date.now() - oldestPending.getTime()) / 1000) : 0,
  );
}

export async function runOutboxWorker(
  deps: OutboxProcessorDeps = createOutboxProcessorDeps(),
): Promise<void> {
  let lastMetricsRefresh = 0;
  while (!stopping) {
    try {
      const { claimed, retryableFailures } = await processPendingOutboxBatch(deps);
      const now = Date.now();
      await deps.cache.set('worker:heartbeat', now, 30);
      if (now - lastMetricsRefresh >= METRICS_REFRESH_MS) {
        await refreshOutboxMetrics(new DrizzleOutboxStore());
        lastMetricsRefresh = now;
      }
      if (retryableFailures > 0) await Bun.sleep(RETRY_SLEEP_MS);
      else if (claimed === 0) await Bun.sleep(IDLE_SLEEP_MS);
    } catch (error) {
      logger.error({ err: error }, 'outbox_worker_loop_failed');
      await Bun.sleep(FAILURE_SLEEP_MS);
    }
  }
}
