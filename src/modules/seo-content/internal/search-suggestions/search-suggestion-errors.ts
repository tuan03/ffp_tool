export class GoogleSuggestError extends Error {
  readonly status?: number;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options?: {
      readonly status?: number;
      readonly isRetryable?: boolean;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "GoogleSuggestError";
    this.status = options?.status;
    this.isRetryable = options?.isRetryable ?? false;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export class GoogleSuggestRateLimitError extends GoogleSuggestError {
  constructor(message = "Google suggest rate limit exceeded (429)", cause?: unknown) {
    super(message, { status: 429, isRetryable: true, cause });
    this.name = "GoogleSuggestRateLimitError";
  }
}

export class GoogleSuggestBlockedError extends GoogleSuggestError {
  constructor(message = "Google suggest request blocked (403)", cause?: unknown) {
    super(message, { status: 403, isRetryable: false, cause });
    this.name = "GoogleSuggestBlockedError";
  }
}
