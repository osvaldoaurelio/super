import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/infrastructure/database/client.ts';
import { outboxEvents } from '../../src/infrastructure/database/schema.ts';
import {
  OUTBOX_LAST_ERROR_MAX_LENGTH,
  OUTBOX_MAX_ATTEMPTS,
} from '../../src/infrastructure/queue/outbox-types.ts';
import { DrizzleOutboxStore } from '../../src/infrastructure/queue/drizzle-outbox-store.ts';
import { runIntegrationSetup } from '../support/integration-setup.ts';

const describeIntegration = process.env['RUN_INTEGRATION'] === '1' ? describe : describe.skip;

describeIntegration('DrizzleOutboxStore (PostgreSQL)', () => {
  const store = new DrizzleOutboxStore();
  const insertedIds: string[] = [];

  async function insertEvent(attempts: number): Promise<string> {
    const [event] = await db
      .insert(outboxEvents)
      .values({
        type: 'price.record',
        payload: { marker: crypto.randomUUID() },
        idempotencyKey: crypto.randomUUID(),
        attempts,
      })
      .returning({ id: outboxEvents.id });
    if (!event) throw new Error('Falha ao criar evento de fixture.');
    insertedIds.push(event.id);
    return event.id;
  }

  beforeAll(async () => {
    await runIntegrationSetup();
  });

  afterAll(async () => {
    if (insertedIds.length) {
      await db.delete(outboxEvents).where(inArray(outboxEvents.id, insertedIds));
    }
    await closeDatabase();
  });

  it('seleciona apenas eventos pendentes com tentativas disponíveis', async () => {
    const healthyId = await insertEvent(0);
    const exhaustedId = await insertEvent(OUTBOX_MAX_ATTEMPTS);

    const ids = (await db.transaction((tx) => store.claimPending(tx, 50))).map((event) => event.id);

    expect(ids).toContain(healthyId);
    expect(ids).not.toContain(exhaustedId);
  });

  it('incrementa attempts, trunca last_error e sinaliza esgotamento', async () => {
    const eventId = await insertEvent(OUTBOX_MAX_ATTEMPTS - 1);
    const longError = 'e'.repeat(OUTBOX_LAST_ERROR_MAX_LENGTH + 100);

    await expect(db.transaction((tx) => store.markFailed(tx, eventId, longError))).resolves.toBe(
      'exhausted',
    );

    const [row] = await db
      .select({ attempts: outboxEvents.attempts, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(row?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(row?.lastError).toBe(longError.slice(0, OUTBOX_LAST_ERROR_MAX_LENGTH));

    const ids = (await db.transaction((tx) => store.claimPending(tx, 50))).map((event) => event.id);
    expect(ids).not.toContain(eventId);
  });

  it('marca como processado, remove do backlog e conta pendentes', async () => {
    const eventId = await insertEvent(0);
    const processedAt = new Date();
    const backlogBefore = await store.countPending();

    await db.transaction((tx) => store.markProcessed(tx, eventId, processedAt));

    const [row] = await db
      .select({ processedAt: outboxEvents.processedAt })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(row?.processedAt?.getTime()).toBe(processedAt.getTime());
    expect(
      (await db.transaction((tx) => store.claimPending(tx, 50))).map((event) => event.id),
    ).not.toContain(eventId);
    await expect(store.countPending()).resolves.toBe(backlogBefore - 1);
    const [processedRow] = await db
      .select({ status: outboxEvents.status })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(processedRow?.status).toBe('processed');
  });

  it('moves an event to dead, excludes it from backlog and counts it', async () => {
    const eventId = await insertEvent(0);
    const deadBefore = await store.countDead();

    await expect(
      db.transaction((tx) => store.markDead(tx, eventId, 'Referência inexistente.')),
    ).resolves.toBe(true);

    const [deadRow] = await db
      .select({ status: outboxEvents.status, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(deadRow?.status).toBe('dead');
    expect(deadRow?.lastError).toBe('Referência inexistente.');
    expect(
      (await db.transaction((tx) => store.claimPending(tx, 50))).map((event) => event.id),
    ).not.toContain(eventId);
    await expect(store.countDead()).resolves.toBe(deadBefore + 1);
    await expect(db.transaction((tx) => store.markDead(tx, eventId, 'Duplicado.'))).resolves.toBe(
      false,
    );
  });
});
