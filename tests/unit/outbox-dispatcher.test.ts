import { describe, expect, it, vi } from 'vitest';
import {
  OUTBOX_LAST_ERROR_MAX_LENGTH,
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEvent,
  type OutboxFailureOutcome,
  type OutboxStore,
} from '../../src/application/ports/outbox-store.ts';
import { dispatchPendingBatch } from '../../src/infrastructure/queue/outbox-dispatcher.ts';

type FakeRow = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  publishedAt: Date | null;
  lastError: string | null;
};

/**
 * Reproduz em memória a semântica do adaptador Drizzle: só entram na seleção
 * eventos não publicados e com tentativas disponíveis. O filtro real é validado
 * em `tests/integration/outbox-store.test.ts` contra PostgreSQL.
 */
class FakeOutboxStore implements OutboxStore {
  readonly rows: FakeRow[];
  constructor(rows: FakeRow[]) {
    this.rows = rows;
  }

  async claimPending(limit: number): Promise<OutboxEvent[]> {
    return this.rows
      .filter((row) => row.publishedAt === null && row.attempts < OUTBOX_MAX_ATTEMPTS)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        attempts: row.attempts,
      }));
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    const row = this.rows.find((item) => item.id === eventId);
    if (row) row.publishedAt = publishedAt;
  }

  async markFailed(eventId: string, error: string): Promise<OutboxFailureOutcome> {
    const row = this.rows.find((item) => item.id === eventId);
    if (!row) throw new Error(`Evento ${eventId} inexistente no fake.`);
    row.attempts += 1;
    row.lastError = error.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH);
    return row.attempts >= OUTBOX_MAX_ATTEMPTS ? 'exhausted' : 'retry';
  }

  async countPending(): Promise<number> {
    return this.rows.filter((row) => row.publishedAt === null).length;
  }
}

function row(id: string, attempts = 0, payload: unknown = { id }): FakeRow {
  return { id, type: 'price.record', payload, attempts, publishedAt: null, lastError: null };
}

function setup(rows: FakeRow[], failingIds: string[] = []) {
  const store = new FakeOutboxStore(rows);
  const publish = vi.fn(async (event: OutboxEvent) => {
    if (failingIds.includes(event.id)) throw new Error(`falha ao publicar ${event.id}`);
  });
  const sleep = vi.fn(async () => {});
  return {
    store,
    publish,
    sleep,
    deps: { store, publish, sleep, now: () => new Date('2026-01-01T00:00:00.000Z') },
  };
}

describe('dispatchPendingBatch', () => {
  it('publica os eventos seguintes mesmo quando um evento do lote falha', async () => {
    const { deps, store, publish, sleep } = setup([row('a'), row('poison'), row('c')], ['poison']);

    await expect(dispatchPendingBatch(deps)).resolves.toBe(3);

    expect(publish).toHaveBeenCalledTimes(3);
    expect(store.rows.map((item) => item.publishedAt !== null)).toEqual([true, false, true]);
    expect(store.rows[1]?.attempts).toBe(1);
    expect(store.rows[1]?.lastError).toBe('falha ao publicar poison');
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it('incrementa attempts a cada falha e trunca last_error', async () => {
    const longMessage = 'x'.repeat(OUTBOX_LAST_ERROR_MAX_LENGTH + 200);
    const store = new FakeOutboxStore([row('poison')]);
    const deps = {
      store,
      publish: vi.fn(async () => {
        throw new Error(longMessage);
      }),
      sleep: vi.fn(async () => {}),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    };

    await dispatchPendingBatch(deps);
    await dispatchPendingBatch(deps);

    expect(store.rows[0]?.attempts).toBe(2);
    expect(store.rows[0]?.lastError).toBe(longMessage.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH));
  });

  it('deixa de selecionar o evento ao atingir o limite de tentativas', async () => {
    const { deps, store, publish, sleep } = setup([row('poison'), row('healthy')], ['poison']);
    const poison = store.rows[0];
    if (!poison) throw new Error('Fixture ausente.');
    poison.attempts = OUTBOX_MAX_ATTEMPTS - 1;

    await dispatchPendingBatch(deps);

    expect(poison.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(poison.publishedAt).toBeNull();
    expect(sleep).not.toHaveBeenCalled();

    publish.mockClear();
    await dispatchPendingBatch(deps);

    expect(publish).toHaveBeenCalledTimes(0);
    expect(store.rows[1]?.publishedAt).not.toBeNull();
  });

  it('marca como publicado com o horário do relógio injetado', async () => {
    const { deps, store } = setup([row('a')]);

    await dispatchPendingBatch(deps);

    expect(store.rows[0]?.publishedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});
