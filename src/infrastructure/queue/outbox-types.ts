export const OUTBOX_MAX_ATTEMPTS = 10;

export const OUTBOX_LAST_ERROR_MAX_LENGTH = 500;

export type OutboxEvent = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
};

export type OutboxFailureOutcome = 'retry' | 'exhausted';
