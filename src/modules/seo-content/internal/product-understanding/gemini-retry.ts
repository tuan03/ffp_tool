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

  // Check nested error object (e.g., Google Cloud REST API body: { error: { code: 429, message: "...", status: "RESOURCE_EXHAUSTED" } })
  if (err.error && typeof err.error === "object" && err.error !== error) {
    if (isGeminiRateLimitOrTransientError(err.error)) {
      return true;
    }
  }

  const rawStatus =
    err.status !== undefined
      ? err.status
      : err.statusCode !== undefined
        ? err.statusCode
        : err.code;

  if (typeof rawStatus === "number") {
    // HTTP status codes
    if ([408, 429, 500, 502, 503, 504].includes(rawStatus)) {
      return true;
    }
    // gRPC status codes: 4 = DEADLINE_EXCEEDED, 8 = RESOURCE_EXHAUSTED, 14 = UNAVAILABLE
    if ([4, 8, 14].includes(rawStatus)) {
      return true;
    }
  } else if (typeof rawStatus === "string") {
    const num = Number(rawStatus);
    if (!Number.isNaN(num) && [408, 429, 500, 502, 503, 504, 4, 8, 14].includes(num)) {
      return true;
    }
    const upper = rawStatus.toUpperCase();
    if (
      upper === "RESOURCE_EXHAUSTED" ||
      upper === "UNAVAILABLE" ||
      upper === "DEADLINE_EXCEEDED"
    ) {
      return true;
    }
  }

  // Gather message fragments across Error instance or plain error objects
  const textFragments: string[] = [];
  if (error instanceof Error) {
    textFragments.push(error.message);
  } else if (typeof err.message === "string") {
    textFragments.push(err.message);
  }

  if (typeof err.details === "string") {
    textFragments.push(err.details);
  }
  if (typeof err.statusText === "string") {
    textFragments.push(err.statusText);
  }
  if (typeof error === "string") {
    textFragments.push(error);
  }

  const upperMessage = textFragments.join(" ").toUpperCase();

  const transientKeywords = [
    "429",
    "RESOURCE_EXHAUSTED",
    "RATE_LIMIT",
    "RATE LIMIT",
    "TOO MANY REQUESTS",
    "QUOTA EXCEEDED",
    "QUOTA_EXCEEDED",
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
          try {
            (error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED] = true;
          } catch {
            // Ignore if error object is frozen or non-extensible
          }
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
