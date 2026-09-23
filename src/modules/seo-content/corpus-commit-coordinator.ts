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
}

export class SeoCorpusCommitCoordinator {
  private queue: Promise<void> = Promise.resolve();

  async prepare<TExecution>(
    input: SeoCorpusCommitInput<TExecution>,
  ): Promise<SeoCorpusCommitResult<TExecution>> {
    const startedAt = Date.now();
    let execution = await input.runSeo();
    const initialSeoMs = Date.now() - startedAt;
    const queuedAt = Date.now();

    return this.enqueue(async () => {
      const queueWaitMs = Date.now() - queuedAt;
      const maxRevisionRetries = input.maxRevisionRetries ?? 8;
      let revisionRetries = 0;
      let rebaseSeoMs = 0;
      let registrationMs = 0;

      for (;;) {
        const registrationStartedAt = Date.now();
        try {
          await input.register(execution);
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
          execution = await input.runSeo();
          rebaseSeoMs += Date.now() - rebaseStartedAt;
        }
      }
    });
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
