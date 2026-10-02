import type { SeoProviderCircuitRecord } from "../persistence/repositories";
import type { SeoProviderRuntime } from "./seo-provider-registry";

export interface SeoProviderCircuitStore {
  get(providerId: string, model: string): Promise<SeoProviderCircuitRecord | undefined>;
  tryAcquireProbe(providerId: string, model: string, now: number, probeLeaseMs?: number): Promise<boolean>;
  recordFailure(
    providerId: string,
    model: string,
    now: number,
    error: Readonly<Record<string, unknown>>,
    failureThreshold: number,
    resetTimeoutMs: number,
  ): Promise<SeoProviderCircuitRecord>;
  recordSuccess(providerId: string, model: string, now: number): Promise<void>;
}

export interface SeoProviderCircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly resetTimeoutMs?: number;
}

export class SeoProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  public constructor(
    private readonly store: SeoProviderCircuitStore,
    options: SeoProviderCircuitBreakerOptions = {},
  ) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.resetTimeoutMs = Math.max(1_000, options.resetTimeoutMs ?? 60_000);
  }

  public async execute<T>(providerId: string, model: string, operation: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const current = await this.store.get(providerId, model);
    if (current?.state === "open" && (current.retryAfter ?? Number.MAX_SAFE_INTEGER) > now) {
      throw new Error(`SEO provider circuit is open for ${providerId}/${model}`);
    }
    if (current?.state === "open" || current?.state === "half_open") {
      const acquired = await this.store.tryAcquireProbe(providerId, model, now);
      if (!acquired) throw new Error(`SEO provider circuit probe is already running for ${providerId}/${model}`);
    }
    try {
      const result = await operation();
      if (current && (current.state !== "closed" || current.failureCount > 0)) {
        await this.store.recordSuccess(providerId, model, Date.now());
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      await this.store.recordFailure(
        providerId,
        model,
        now,
        { message: error instanceof Error ? error.message : String(error) },
        this.failureThreshold,
        this.resetTimeoutMs,
      );
      throw error;
    }
  }

  public async executeWithFallbackObservation<T>(
    providerId: string,
    model: string,
    operation: () => Promise<{ readonly result: T; readonly primaryFailure?: unknown }>,
  ): Promise<T> {
    const result = await this.execute(providerId, model, async () => {
      const outcome = await operation();
      if (outcome.primaryFailure !== undefined) {
        const error = outcome.primaryFailure instanceof Error
          ? outcome.primaryFailure
          : new Error(String(outcome.primaryFailure));
        error.name = "ObservedProviderFailure";
        throw new ProviderFallbackSucceededError(outcome.result, error);
      }
      return outcome.result;
    }).catch((error: unknown) => {
      if (error instanceof ProviderFallbackSucceededError) return error.result as T;
      throw error;
    });
    return result;
  }
}

class ProviderFallbackSucceededError extends Error {
  public constructor(readonly result: unknown, cause: Error) {
    super(cause.message, { cause });
    this.name = "ProviderFallbackSucceededError";
  }
}

export function protectSeoProviderRuntime(
  runtime: SeoProviderRuntime,
  circuitBreaker: SeoProviderCircuitBreaker,
): SeoProviderRuntime {
  const execute = <T>(stage: "b1" | "b2" | "b4" | "b5", operation: () => Promise<T>) =>
    stage === "b4"
      ? circuitBreaker.execute(runtime.providerId, runtime.model, operation)
      : circuitBreaker.executeWithFallbackObservation(runtime.providerId, runtime.model, async () => ({
          result: await operation(),
          primaryFailure: runtime.consumePrimaryFailure?.(stage),
        }));
  return {
    ...runtime,
    imageAnalyzer: { analyze: input => execute("b1", () => runtime.imageAnalyzer.analyze(input)) },
    shoppingContextAnalyzer: { analyze: input => execute("b2", () => runtime.shoppingContextAnalyzer.analyze(input)) },
    keywordConflictAnalyzer: { analyze: input => execute("b4", () => runtime.keywordConflictAnalyzer.analyze(input)) },
    contentGenerator: { generate: input => execute("b5", () => runtime.contentGenerator.generate(input)) },
  };
}
