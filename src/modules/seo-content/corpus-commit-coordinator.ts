import { CorpusRevisionConflictError } from "./internal/conflict-control/corpus-errors";

export interface SeoCorpusCommitTimings {
  readonly initialSeoMs: number;
  readonly queueWaitMs: number;
  readonly rebaseSeoMs: number;
  readonly registrationMs: number;
  readonly totalMs: number;
}

export interface SeoCorpusCommitResult<TExecution> {
  readonly execution: TExecution;
  readonly revisionRetries: number;
  readonly timings: SeoCorpusCommitTimings;
}

export interface SeoCorpusCommitInput<TExecution> {
  readonly runSeo: () => Promise<TExecution>;
  readonly rebaseSeo?: (previous: TExecution) => Promise<TExecution>;
  readonly corpusKey?: string;
  readonly register: (execution: TExecution) => Promise<unknown>;
  readonly maxRevisionRetries?: number;
  readonly signal?: AbortSignal;
}

function createAbortError(): Error {
  const error = new Error("SEO corpus commit was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

export class SeoCorpusCommitCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  async prepare<TExecution>(input: SeoCorpusCommitInput<TExecution>): Promise<SeoCorpusCommitResult<TExecution>> {
    const startedAt = Date.now();
    throwIfAborted(input.signal);
    let execution = await input.runSeo();
    throwIfAborted(input.signal);
    const initialSeoMs = Date.now() - startedAt;
    let queueWaitMs = 0;
    let rebaseSeoMs = 0;
    let registrationMs = 0;
    // A cohort of 16 workers can require 15 fresh snapshots; allow a second cohort
    // while retaining a hard bound against continuously changing external writers.
    let revisionRetries = 0;
    for (;;) {
      throwIfAborted(input.signal);
      const queuedAt = Date.now();
      try {
        await this.enqueue(input.corpusKey ?? "default", async () => {
          throwIfAborted(input.signal);
          queueWaitMs += Date.now() - queuedAt;
          const registrationStartedAt = Date.now();
          try { await input.register(execution); }
          finally { registrationMs += Date.now() - registrationStartedAt; }
        }, input.signal);
        // Return a successful reservation even if cancellation arrived during the write:
        // the caller must receive its identity to release it in cancellation cleanup.
        return { execution, revisionRetries, timings: {
          initialSeoMs, queueWaitMs, rebaseSeoMs, registrationMs, totalMs: Date.now() - startedAt,
        } };
      } catch (error: unknown) {
        throwIfAborted(input.signal);
        if (!(error instanceof CorpusRevisionConflictError) || revisionRetries >= (input.maxRevisionRetries ?? 32)) throw error;
        revisionRetries++;
        const rebaseStartedAt = Date.now();
        execution = input.rebaseSeo ? await input.rebaseSeo(execution) : await input.runSeo();
        rebaseSeoMs += Date.now() - rebaseStartedAt;
      }
    }
  }

  private async enqueue<T>(key: string, operation: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    let started = false;
    const queued = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      throwIfAborted(signal);
      started = true;
      return operation();
    });
    const tail = queued.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    // Cancel pending work promptly, but let an atomic write finish and return its reservation.
    return new Promise<T>((resolve, reject) => {
      const abort = () => { if (!started) reject(createAbortError()); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      void queued.then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
    });
  }
}
