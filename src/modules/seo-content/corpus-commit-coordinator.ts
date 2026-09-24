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

async function awaitQueueWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
  });
}

export class SeoCorpusCommitCoordinator {
  private queue: Promise<void> = Promise.resolve();

  async prepare<TExecution>(
    input: SeoCorpusCommitInput<TExecution>,
  ): Promise<SeoCorpusCommitResult<TExecution>> {
    const startedAt = Date.now();
    throwIfAborted(input.signal);
    let execution = await input.runSeo();
    throwIfAborted(input.signal);
    const initialSeoMs = Date.now() - startedAt;
    const queuedAt = Date.now();

    return this.enqueue(async () => {
      throwIfAborted(input.signal);
      const queueWaitMs = Date.now() - queuedAt;
      const maxRevisionRetries = input.maxRevisionRetries ?? 8;
      let revisionRetries = 0;
      let rebaseSeoMs = 0;
      let registrationMs = 0;

      for (;;) {
        throwIfAborted(input.signal);
        const registrationStartedAt = Date.now();
        try {
          await input.register(execution);
          throwIfAborted(input.signal);
          registrationMs += Date.now() - registrationStartedAt;
          return {
            execution,
            revisionRetries,
            timings: {
              initialSeoMs,
              queueWaitMs,
              rebaseSeoMs,
              registrationMs,
              totalMs: Date.now() - startedAt,
            },
          };
        } catch (error: unknown) {
          registrationMs += Date.now() - registrationStartedAt;
          if (
            !(error instanceof CorpusRevisionConflictError)
            || revisionRetries >= maxRevisionRetries
          ) {
            throw error;
          }
          revisionRetries += 1;
          const rebaseStartedAt = Date.now();
          throwIfAborted(input.signal);
          execution = await input.runSeo();
          throwIfAborted(input.signal);
          rebaseSeoMs += Date.now() - rebaseStartedAt;
        }
      }
    }, input.signal);
  }

  private async enqueue<T>(operation: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return awaitQueueWithAbort(result, signal);
  }
}
