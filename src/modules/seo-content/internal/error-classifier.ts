export const CLASSIFIED_ERROR_ACTIONS = {
  THROTTLE_RATE_LIMIT: "THROTTLE_RATE_LIMIT",
  TRANSIENT_RETRY: "TRANSIENT_RETRY",
  TIMEOUT_RETRY: "TIMEOUT_RETRY",
  TRUNCATED_JSON_RECOMPACT: "TRUNCATED_JSON_RECOMPACT",
  INPUT_TOO_LARGE_REJECT: "INPUT_TOO_LARGE_REJECT",
  IMAGE_NOT_FOUND_DROP: "IMAGE_NOT_FOUND_DROP",
  SAFETY_MANUAL_REVIEW: "SAFETY_MANUAL_REVIEW",
  CIRCUIT_BREAKER_MISSING_MODEL: "CIRCUIT_BREAKER_MISSING_MODEL",
  QUEUE_PAUSE_CREDENTIAL_ERROR: "QUEUE_PAUSE_CREDENTIAL_ERROR",
  FATAL_INVALID_CONFIG: "FATAL_INVALID_CONFIG",
} as const;

export type ClassifiedErrorAction =
  typeof CLASSIFIED_ERROR_ACTIONS[keyof typeof CLASSIFIED_ERROR_ACTIONS];

export interface ClassifiedErrorResolution {
  readonly action: ClassifiedErrorAction;
  readonly isRetryable: boolean;
  readonly maxRetries: number;
  readonly reason: string;
  readonly retryStrategy?: "jitter_backoff" | "immediate" | "recompact_prompt" | "drop_image";
}

/**
 * Standard jitter backoff schedule for rate limits & transient retries:
 * Attempt 1: 5s
 * Attempt 2: 15s
 * Attempt 3: 45s
 * Attempt 4+: 120s
 */
export const DEFAULT_JITTER_SCHEDULE: readonly number[] = Object.freeze([
  5_000,
  15_000,
  45_000,
  120_000,
]);

/**
 * Computes backoff delay with +/- 20% jitter.
 *
 * @param attempt 1-based attempt index (1, 2, 3...)
 * @param baseSchedule Array of base delays in ms (default: [5000, 15000, 45000, 120000])
 * @param randomFn Random function returning [0, 1) (default: Math.random)
 */
export function getJitterBackoffDelayMs(
  attempt: number,
  baseSchedule: readonly number[] = DEFAULT_JITTER_SCHEDULE,
  randomFn: () => number = Math.random,
): number {
  if (baseSchedule.length === 0) {
    return 1000;
  }

  const clampedAttempt = Math.max(1, Math.floor(attempt));
  const scheduleIndex = Math.min(clampedAttempt - 1, baseSchedule.length - 1);
  const baseDelay = baseSchedule[scheduleIndex];

  // +/- 20% jitter: factor in range [0.8, 1.2]
  const jitterFactor = 0.8 + Math.max(0, Math.min(1, randomFn())) * 0.4;
  return Math.round(baseDelay * jitterFactor);
}

interface ExtractedErrorInfo {
  readonly status?: number;
  readonly statusStr?: string;
  readonly text: string;
  readonly finishReason?: string;
  readonly isTimeout: boolean;
}

function extractErrorInfo(
  error: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): ExtractedErrorInfo {
  if (error === null || error === undefined || depth > 5) {
    return { text: "", isTimeout: false };
  }

  const fragments: string[] = [];
  let status: number | undefined;
  let statusStr: string | undefined;
  let finishReason: string | undefined;
  let isTimeout = false;

  if (typeof error === "object") {
    if (seen.has(error)) {
      return { text: "", isTimeout: false };
    }
    seen.add(error);
  }

  if (error instanceof Error) {
    fragments.push(error.name);
    fragments.push(error.message);
    if (
      error.name === "TimeoutError" ||
      (error.name === "DOMException" && error.message.includes("timed out"))
    ) {
      isTimeout = true;
    }
  }

  if (typeof error === "string") {
    fragments.push(error);
  }

  if (typeof error === "object") {
    const rec = error as Record<string, unknown>;

    if (typeof rec.name === "string") {
      fragments.push(rec.name);
      if (rec.name === "TimeoutError") {
        isTimeout = true;
      }
    }

    if (typeof rec.message === "string") {
      fragments.push(rec.message);
    }
    if (typeof rec.details === "string") {
      fragments.push(rec.details);
    }
    if (typeof rec.statusText === "string") {
      fragments.push(rec.statusText);
    }
    if (typeof rec.finishReason === "string") {
      finishReason = rec.finishReason;
      fragments.push(rec.finishReason);
    }

    // Inspect Axios response object (error.response?.status, error.response?.data)
    if (rec.response && typeof rec.response === "object") {
      const resp = rec.response as Record<string, unknown>;
      if (typeof resp.statusText === "string") {
        fragments.push(resp.statusText);
      }
      const respStatus = resp.status !== undefined ? resp.status : resp.statusCode;
      if (typeof respStatus === "number") {
        status = respStatus;
      } else if (typeof respStatus === "string") {
        const parsed = Number(respStatus);
        if (!Number.isNaN(parsed)) {
          status = parsed;
        } else {
          statusStr = respStatus;
        }
      }

      if (resp.data && typeof resp.data === "object") {
        const nestedData = extractErrorInfo(resp.data, seen, depth + 1);
        fragments.push(nestedData.text);
        if (status === undefined && nestedData.status !== undefined) {
          status = nestedData.status;
        }
        if (statusStr === undefined && nestedData.statusStr !== undefined) {
          statusStr = nestedData.statusStr;
        }
      } else if (typeof resp.data === "string") {
        fragments.push(resp.data);
      }
    }

    const rawStatus =
      status !== undefined
        ? status
        : rec.status !== undefined
          ? rec.status
          : rec.statusCode !== undefined
            ? rec.statusCode
            : rec.code;

    if (typeof rawStatus === "number") {
      status = rawStatus;
    } else if (typeof rawStatus === "string") {
      const parsed = Number(rawStatus);
      if (!Number.isNaN(parsed)) {
        status = parsed;
      } else {
        statusStr = rawStatus;
      }
    }

    // Inspect nested error object (e.g. Google Cloud API body { error: { code: 429, message: ... } })
    if (rec.error && typeof rec.error === "object") {
      const nested = extractErrorInfo(rec.error, seen, depth + 1);
      fragments.push(nested.text);
      if (status === undefined && nested.status !== undefined) {
        status = nested.status;
      }
      if (statusStr === undefined && nested.statusStr !== undefined) {
        statusStr = nested.statusStr;
      }
      if (finishReason === undefined && nested.finishReason !== undefined) {
        finishReason = nested.finishReason;
      }
      if (!isTimeout && nested.isTimeout) {
        isTimeout = true;
      }
    }

    // Inspect nested cause (supports object and string causes, with cycle protection)
    if (rec.cause !== undefined && rec.cause !== null) {
      if (typeof rec.cause === "object") {
        const nested = extractErrorInfo(rec.cause, seen, depth + 1);
        fragments.push(nested.text);
        if (status === undefined && nested.status !== undefined) {
          status = nested.status;
        }
        if (statusStr === undefined && nested.statusStr !== undefined) {
          statusStr = nested.statusStr;
        }
        if (!isTimeout && nested.isTimeout) {
          isTimeout = true;
        }
      } else if (typeof rec.cause === "string") {
        fragments.push(rec.cause);
      }
    }
  }

  return {
    status,
    statusStr,
    text: fragments.join(" ").toUpperCase(),
    finishReason: finishReason?.toUpperCase(),
    isTimeout,
  };
}

/**
 * Classifies an unknown error into one of 10 standard resolution actions.
 */
export function classifyError(error: unknown): ClassifiedErrorResolution {
  const info = extractErrorInfo(error);
  const text = info.text;
  const status = info.status;
  const statusStr = info.statusStr ?? "";

  // 1. QUEUE_PAUSE_CREDENTIAL_ERROR
  // Missing ADC credentials, auth token expiration, unauthenticated access
  if (
    status === 401 ||
    statusStr === "UNAUTHENTICATED" ||
    text.includes("COULD NOT LOAD THE DEFAULT CREDENTIALS") ||
    text.includes("APPLICATION DEFAULT CREDENTIALS") ||
    text.includes("DEFAULT APPLICATION CREDENTIALS") ||
    text.includes("UNAUTHENTICATED") ||
    text.includes("INVALID_GRANT") ||
    text.includes("GCP_PROJECT_ID") ||
    text.includes("UNAUTHORIZED") ||
    text.includes("AUTH_TOKEN_EXPIRED") ||
    (status === 403 && text.includes("CREDENTIAL"))
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.QUEUE_PAUSE_CREDENTIAL_ERROR,
      isRetryable: false,
      maxRetries: 0,
      reason: "Authentication / GCP ADC credentials error. Entire queue paused for operator inspection.",
    };
  }

  // 2. CIRCUIT_BREAKER_MISSING_MODEL
  // 404 specifically for Gemini model resource, not for an image or item
  const isModelMissing =
    (status === 404 ||
      statusStr === "NOT_FOUND" ||
      text.includes("404") ||
      text.includes("NOT FOUND") ||
      text.includes("NOT_FOUND")) &&
    (text.includes("MODELS/") ||
      text.includes("MODEL NOT FOUND") ||
      text.includes("PUBLISHER MODEL") ||
      text.includes("NOT FOUND FOR MODEL") ||
      text.includes("UNKNOWN MODEL") ||
      text.includes("IS NOT FOUND FOR API VERSION") ||
      /MODELS\/.*NOT FOUND/i.test(text));

  if (isModelMissing) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.CIRCUIT_BREAKER_MISSING_MODEL,
      isRetryable: false,
      maxRetries: 0,
      reason: "Target model endpoint does not exist. Circuit breaker triggered to halt queue hammering.",
    };
  }

  // 3. IMAGE_NOT_FOUND_DROP
  // 404 or fetch failure for a specific product image
  if (
    text.includes("IMAGE 404") ||
    text.includes("IMAGE READ FAILED") ||
    text.includes("IMAGE NOT FOUND") ||
    text.includes("IMAGE FETCH FAILED") ||
    text.includes("IMAGE DOWNLOAD FAILED") ||
    text.includes("CORRUPTED IMAGE BUFFER") ||
    text.includes("FAILED TO LOAD IMAGE") ||
    ((status === 404 || text.includes("ENOTFOUND")) &&
      (text.includes(".JPG") ||
        text.includes(".PNG") ||
        text.includes(".WEBP") ||
        text.includes("IMAGE") ||
        text.includes("PHOTO")))
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.IMAGE_NOT_FOUND_DROP,
      isRetryable: false,
      maxRetries: 0,
      retryStrategy: "drop_image",
      reason: "Image asset returned 404 or corrupted buffer. Dropping failed image and continuing with remaining images.",
    };
  }

  // 4. SAFETY_MANUAL_REVIEW
  // Gemini safety refusal
  if (
    info.finishReason === "SAFETY" ||
    text.includes("BLOCK_REASON_SAFETY") ||
    text.includes("SAFETY_RATINGS") ||
    text.includes("SAFETY_BLOCK") ||
    text.includes("HARM_CATEGORY") ||
    text.includes("BLOCKED BY SAFETY FILTERS") ||
    text.includes("FILTERED DUE TO SAFETY")
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.SAFETY_MANUAL_REVIEW,
      isRetryable: false,
      maxRetries: 0,
      reason: "Gemini generation refused due to safety policy. Marked for manual operator review.",
    };
  }

  // 5. INPUT_TOO_LARGE_REJECT
  // Payload size exceeds model or server context limit
  if (
    status === 413 ||
    text.includes("PAYLOAD TOO LARGE") ||
    text.includes("REQUEST ENTITY TOO LARGE") ||
    text.includes("REQUEST PAYLOAD SIZE EXCEEDS") ||
    text.includes("EXCEEDS MAXIMUM ALLOWED LENGTH") ||
    text.includes("INPUT TOO LARGE") ||
    text.includes("CONTEXT WINDOW EXCEEDED") ||
    text.includes("INPUT TOKEN LIMIT EXCEEDED")
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.INPUT_TOO_LARGE_REJECT,
      isRetryable: false,
      maxRetries: 0,
      reason: "Input payload exceeds model context window or HTTP size limit. Rejected without retry.",
    };
  }

  // 6. TRUNCATED_JSON_RECOMPACT
  // Incomplete JSON generation caused by max output tokens
  if (
    info.finishReason === "MAX_TOKENS" ||
    text.includes("UNEXPECTED END OF JSON INPUT") ||
    text.includes("UNEXPECTED END OF INPUT") ||
    text.includes("UNTERMINATED STRING IN JSON") ||
    text.includes("TRUNCATED JSON") ||
    text.includes("OUTPUT WAS TRUNCATED")
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.TRUNCATED_JSON_RECOMPACT,
      isRetryable: true,
      maxRetries: 1,
      retryStrategy: "recompact_prompt",
      reason: "Generated JSON was truncated by output token limit. Recompacting prompt and increasing tokens.",
    };
  }

  // 7. TIMEOUT_RETRY
  // HTTP, stage, or request timeout
  if (
    info.isTimeout ||
    status === 408 ||
    status === 4 || // gRPC DEADLINE_EXCEEDED
    statusStr === "DEADLINE_EXCEEDED" ||
    text.includes("TIMED OUT") ||
    text.includes("TIMEOUT") ||
    text.includes("DEADLINE_EXCEEDED") ||
    text.includes("ETIMEDOUT") ||
    text.includes("ESOCKETTIMEDOUT")
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.TIMEOUT_RETRY,
      isRetryable: true,
      maxRetries: 3,
      retryStrategy: "jitter_backoff",
      reason: "Request or stage timed out. Retrying with fresh timeout.",
    };
  }

  // 8. THROTTLE_RATE_LIMIT
  // Gemini 429 / Quota / Concurrency rate limits
  if (
    status === 429 ||
    status === 8 || // gRPC RESOURCE_EXHAUSTED
    statusStr === "RESOURCE_EXHAUSTED" ||
    text.includes("RESOURCE_EXHAUSTED") ||
    text.includes("RATE_LIMIT") ||
    text.includes("RATE LIMIT") ||
    text.includes("TOO MANY REQUESTS") ||
    text.includes("QUOTA EXCEEDED") ||
    text.includes("QUOTA_EXCEEDED") ||
    text.includes("429")
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.THROTTLE_RATE_LIMIT,
      isRetryable: true,
      maxRetries: 4,
      retryStrategy: "jitter_backoff",
      reason: "Gemini 429 quota or concurrency limit reached. Backing off with jitter and throttling concurrency.",
    };
  }

  // 9. TRANSIENT_RETRY
  // Gemini 5xx / Service unavailable / Network connection reset / Browser fetch failure
  if (
    (status !== undefined && [500, 502, 503, 504].includes(status)) ||
    status === 14 || // gRPC UNAVAILABLE
    statusStr === "UNAVAILABLE" ||
    text.includes("UNAVAILABLE") ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("502") ||
    text.includes("500") ||
    text.includes("ECONNRESET") ||
    text.includes("FETCH FAILED") ||
    text.includes("FAILED TO FETCH") ||
    text.includes("FETCH ERROR") ||
    text.includes("NETWORK ERROR") ||
    text.includes("OVERLOADED") ||
    ((error instanceof TypeError || text.includes("TYPEERROR")) && text.includes("FETCH"))
  ) {
    return {
      action: CLASSIFIED_ERROR_ACTIONS.TRANSIENT_RETRY,
      isRetryable: true,
      maxRetries: 3,
      retryStrategy: "jitter_backoff",
      reason: "Gemini transient upstream error (5xx / unavailable / network). Retrying with backoff.",
    };
  }

  // 10. FATAL_INVALID_CONFIG / BAD REQUEST
  // Invalid parameters, bad configuration, or permanent client errors
  return {
    action: CLASSIFIED_ERROR_ACTIONS.FATAL_INVALID_CONFIG,
    isRetryable: false,
    maxRetries: 0,
    reason: "Fatal configuration error, invalid argument, or permanent client refusal. Retrying will not succeed.",
  };
}
