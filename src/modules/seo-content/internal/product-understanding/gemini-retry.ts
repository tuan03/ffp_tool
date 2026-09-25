export const GEMINI_RETRIES_EXHAUSTED = Symbol.for("gemini.retries_exhausted");

export interface GeminiRetryOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly maxDelayMs?: number;
  readonly jitterMs?: number;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly randomFn?: () => number;
}

/**
 * Determines whether an error from Google Gemini / Vertex AI is a rate limit (429)
 * or transient error that should be retried with exponential backoff.
 */
export function isGeminiRateLimitOrTransientError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  // If an inner retry runner already exhausted its attempts, do not retry again in the outer wrapper
  if (
    typeof error === "object" &&
    error !== null &&
    (error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED]
  ) {
    return false;
  }

  const err = error as Record<string, unknown>;

  if (err.name === "GeminiGeneratorError" || "isRetryable" in err) {
    if (err.isRetryable === true) {
      return true;
    }
  }

  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
        ? err.statusCode
        : typeof err.code === "number"
          ? err.code
          : undefined;

  if (status !== undefined && [408, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  const upperMessage = message.toUpperCase();

  const transientKeywords = [
    "429",
    "RESOURCE_EXHAUSTED",
    "RATE_LIMIT",
    "RATE LIMIT",
    "TOO MANY REQUESTS",
    "UNAVAILABLE",
    "503",
    "504",
    "DEADLINE_EXCEEDED",
    "ECONNRESET",
    "ETIMEDOUT",
    "FETCH FAILED",
    "OVERLOADED",
  ];

  for (const keyword of transientKeywords) {
    if (upperMessage.includes(keyword)) {
      return true;
    }
  }

  if (err.cause && err.cause !== error) {
    return isGeminiRateLimitOrTransientError(err.cause);
  }

  return false;
}

/**
 * Executes an asynchronous action with exponential backoff retry when rate limited (429)
 * or encountering transient Vertex/Gemini errors.
 */
export async function executeWithExponentialBackoff<T>(
  action: () => Promise<T>,
  options?: GeminiRetryOptions,
): Promise<T> {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;

  const rawMaxRetries =
    options?.maxRetries ??
    (env?.GEMINI_MAX_RETRIES ? Number(env.GEMINI_MAX_RETRIES) : undefined);
  const maxRetries =
    Number.isInteger(rawMaxRetries) && rawMaxRetries! >= 0 ? rawMaxRetries! : 3;

  const rawInitialDelay =
    options?.initialDelayMs ??
    (env?.GEMINI_RETRY_INITIAL_DELAY_MS
      ? Number(env.GEMINI_RETRY_INITIAL_DELAY_MS)
      : undefined);
  const initialDelayMs =
    Number.isInteger(rawInitialDelay) && rawInitialDelay! > 0 ? rawInitialDelay! : 2500;

  const backoffMultiplier = options?.backoffMultiplier ?? 2;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const jitterMs = options?.jitterMs ?? 500;
  const sleepFn =
    options?.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const randomFn = options?.randomFn ?? Math.random;

  let attempt = 1;
  while (true) {
    try {
      return await action();
    } catch (error: unknown) {
      if (attempt > maxRetries || !isGeminiRateLimitOrTransientError(error)) {
        if (typeof error === "object" && error !== null) {
          (error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED] = true;
        }
        throw error;
      }

      const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = Math.floor(randomFn() * Math.max(0, jitterMs));
      const delayMs = Math.min(maxDelayMs, baseDelay + jitter);

      if (options?.onRetry) {
        options.onRetry(error, attempt, delayMs);
      } else {
        console.warn(
          `[Gemini Retry] Rate limited (429/RESOURCE_EXHAUSTED). Retrying attempt ${attempt}/${maxRetries} after ${delayMs}ms...`,
        );
      }

      await sleepFn(delayMs);
      attempt++;
    }
  }
}
