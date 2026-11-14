import { logger } from '../observability/logger.ts';
import { outboxBacklog, outboxDeadEvents } from '../observability/metrics.ts';
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
  store: Pick<DrizzleOutboxStore, 'countPending' | 'countDead'>,
): Promise<void> {
  const [pending, dead] = await Promise.all([store.countPending(), store.countDead()]);
  outboxBacklog.set(pending);
  outboxDeadEvents.set(dead);
}

export async function runOutboxWorker(
  deps: OutboxProcessorDeps = createOutboxProcessorDeps(),
): Promise<void> {
  let lastMetricsRefresh = 0;
  while (!stopping) {
    try {
      const { claimed, retryableFailures } = await processPendingOutboxBatch(deps);
      const now = Date.now();
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
