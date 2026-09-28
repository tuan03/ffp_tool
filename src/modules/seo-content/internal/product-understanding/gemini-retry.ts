import { abortableDelay } from "../provider-runtime";
import {
  classifyError,
  getJitterBackoffDelayMs,
  CLASSIFIED_ERROR_ACTIONS,
  DEFAULT_JITTER_SCHEDULE,
} from "../error-classifier";
import type {
  ClassifiedErrorAction,
  ClassifiedErrorResolution,
} from "../error-classifier";

export {
  classifyError,
  getJitterBackoffDelayMs,
  CLASSIFIED_ERROR_ACTIONS,
  DEFAULT_JITTER_SCHEDULE,
};
export type {
  ClassifiedErrorAction,
  ClassifiedErrorResolution,
};

export const GEMINI_RETRIES_EXHAUSTED = Symbol.for("gemini.retries_exhausted");

export interface GeminiRetryOptions {
  readonly signal?: AbortSignal;
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly backoffMultiplier?: number;
  readonly maxDelayMs?: number;
  readonly jitterMs?: number;
  readonly useJitterSchedule?: boolean;
  readonly baseSchedule?: readonly number[];
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly randomFn?: () => number;
}

/**
 * Determines whether an error from Google Gemini / Vertex AI is a rate limit (429)
 * or transient error that should be retried with exponential backoff.
 */
export function isGeminiRateLimitOrTransientError(
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): boolean {
  if (depth > 5) return false;
  if (error instanceof Error && error.name === "AbortError") return false;
  if (error instanceof Error && error.name === "TimeoutError") return true;
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

  if (typeof error === "object" && error !== null) {
    if (seen.has(error)) {
      return false;
    }
    seen.add(error);
  }

  const err = error as Record<string, unknown>;

  if (err.name === "GeminiGeneratorError" || "isRetryable" in err) {
    if (err.isRetryable === true) {
      return true;
    }
  }

  // Check nested error object (e.g., Google Cloud REST API body: { error: { code: 429, message: "...", status: "RESOURCE_EXHAUSTED" } })
  if (err.error && typeof err.error === "object") {
    if (isGeminiRateLimitOrTransientError(err.error, seen, depth + 1)) {
      return true;
    }
  }

  const resp =
    err.response && typeof err.response === "object"
      ? (err.response as Record<string, unknown>)
      : undefined;

  const rawStatus =
    err.status !== undefined
      ? err.status
      : err.statusCode !== undefined
        ? err.statusCode
        : err.code !== undefined
          ? err.code
          : resp?.status !== undefined
            ? resp.status
            : resp?.statusCode;

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
    textFragments.push(error.name);
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
  if (resp && typeof resp.statusText === "string") {
    textFragments.push(resp.statusText);
  }
  if (typeof error === "string") {
    textFragments.push(error);
  }

  if (resp && resp.data && typeof resp.data === "object") {
    if (isGeminiRateLimitOrTransientError(resp.data, seen, depth + 1)) {
      return true;
    }
  } else if (resp && typeof resp.data === "string") {
    textFragments.push(resp.data);
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
    "502",
    "500",
    "DEADLINE_EXCEEDED",
    "ECONNRESET",
    "ETIMEDOUT",
    "FETCH FAILED",
    "FAILED TO FETCH",
    "FETCH ERROR",
    "NETWORK ERROR",
    "OVERLOADED",
  ];

  for (const keyword of transientKeywords) {
    if (upperMessage.includes(keyword)) {
      return true;
    }
  }

  if (
    (error instanceof TypeError || err.name === "TypeError") &&
    (upperMessage.includes("FETCH") || (typeof err.message === "string" && /fetch/i.test(err.message)))
  ) {
    return true;
  }

  if (err.cause !== undefined && err.cause !== null) {
    if (typeof err.cause === "object") {
      if (isGeminiRateLimitOrTransientError(err.cause, seen, depth + 1)) {
        return true;
      }
    } else if (typeof err.cause === "string") {
      const upperCause = err.cause.toUpperCase();
      for (const keyword of transientKeywords) {
        if (upperCause.includes(keyword)) {
          return true;
        }
      }
    }
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
    ((ms: number) => abortableDelay(ms, options?.signal));
  const randomFn = options?.randomFn ?? Math.random;

  let attempt = 1;
  while (true) {
    options?.signal?.throwIfAborted();
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

      let delayMs: number;
      if (options?.useJitterSchedule || options?.baseSchedule) {
        delayMs = getJitterBackoffDelayMs(
          attempt,
          options.baseSchedule ?? DEFAULT_JITTER_SCHEDULE,
          randomFn,
        );
      } else {
        const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        const jitter = Math.floor(randomFn() * Math.max(0, jitterMs));
        delayMs = Math.min(maxDelayMs, baseDelay + jitter);
      }

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

/**
 * Executes an asynchronous action using classified error handling and jitter backoff.
 * Rejects immediately on non-retryable actions (INPUT_TOO_LARGE_REJECT, FATAL_INVALID_CONFIG,
 * SAFETY_MANUAL_REVIEW, CIRCUIT_BREAKER_MISSING_MODEL, QUEUE_PAUSE_CREDENTIAL_ERROR).
 * Retries on THROTTLE_RATE_LIMIT, TRANSIENT_RETRY, TIMEOUT_RETRY, TRUNCATED_JSON_RECOMPACT
 * using the configured jitter backoff schedule.
 */
export async function executeWithClassifiedRetry<T>(
  action: () => Promise<T>,
  options?: GeminiRetryOptions,
): Promise<T> {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const rawMaxRetries =
    options?.maxRetries ??
    (env?.GEMINI_MAX_RETRIES ? Number(env.GEMINI_MAX_RETRIES) : undefined);
  const maxRetries =
    Number.isInteger(rawMaxRetries) && rawMaxRetries! >= 0 ? rawMaxRetries! : 4;

  const sleepFn =
    options?.sleepFn ??
    ((ms: number) => abortableDelay(ms, options?.signal));
  const randomFn = options?.randomFn ?? Math.random;
  const baseSchedule = options?.baseSchedule ?? DEFAULT_JITTER_SCHEDULE;

  let attempt = 1;
  while (true) {
    options?.signal?.throwIfAborted();
    try {
      return await action();
    } catch (error: unknown) {
      const resolution = classifyError(error);

      // Inner retries exhausted check
      const alreadyExhausted =
        typeof error === "object" &&
        error !== null &&
        Boolean((error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED]);

      const allowedRetries = Math.min(maxRetries, resolution.maxRetries);

      if (!resolution.isRetryable || alreadyExhausted || attempt > allowedRetries) {
        if (typeof error === "object" && error !== null) {
          try {
            (error as Record<symbol, unknown>)[GEMINI_RETRIES_EXHAUSTED] = true;
          } catch {
            // Ignore if error object is frozen or non-extensible
          }
        }
        throw error;
      }

      const delayMs = getJitterBackoffDelayMs(attempt, baseSchedule, randomFn);

      if (options?.onRetry) {
        options.onRetry(error, attempt, delayMs);
      } else {
        console.warn(
          `[Classified Retry] Action: ${resolution.action}. Retrying attempt ${attempt}/${allowedRetries} after ${delayMs}ms. Reason: ${resolution.reason}`,
        );
      }

      await sleepFn(delayMs);
      attempt++;
    }
  }
}

