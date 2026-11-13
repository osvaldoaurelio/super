/**
 * Contrato de persistência da outbox transacional consumido pelo dispatcher.
 *
 * `attempts` limita quantas vezes um evento pode falhar antes de sair da
 * seleção, garantindo que um evento envenenado não bloqueie os demais.
 */
export const OUTBOX_MAX_ATTEMPTS = 10;

/** Tamanho máximo de `last_error` persistido (evita linhas gigantes). */
export const OUTBOX_LAST_ERROR_MAX_LENGTH = 500;

export type OutboxEvent = {
  id: string;
  type: string;
  payload: unknown;
  /** Tentativas de publicação já falhas no momento da leitura. */
  attempts: number;
};

export type OutboxFailureOutcome = 'retry' | 'exhausted';

export interface OutboxStore {
  /** Eventos ainda não publicados e com tentativas disponíveis, mais antigos primeiro. */
  claimPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(eventId: string, publishedAt: Date): Promise<void>;
  /** Registra a falha e informa se o evento ainda pode ser tentado novamente. */
  markFailed(eventId: string, error: string): Promise<OutboxFailureOutcome>;
  /** Quantidade de eventos pendentes de publicação (inclui os esgotados). */
  countPending(): Promise<number>;
}
