import {
  createSuggestCacheKey,
  defaultGoogleSuggestCache,
  InMemoryGoogleSuggestCache,
  type GoogleSuggestCache,
} from "./search-suggestions-cache";
import {
  GoogleSuggestBlockedError,
  GoogleSuggestError,
  GoogleSuggestRateLimitError,
} from "./search-suggestion-errors";

export interface GoogleSuggestConfig {
  readonly language?: string;
  readonly country?: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly fetchFn?: typeof fetch;
  /**
   * Optional cache for autocomplete suggestions.
   * Defaults to a new InMemoryGoogleSuggestCache instance. Pass null to disable caching,
   * or pass defaultGoogleSuggestCache for a shared application-wide cache.
   */
  readonly cache?: GoogleSuggestCache | null;
}

export interface GoogleSuggestRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly bypassCache?: boolean;
}

export interface GoogleSuggestClient {
  getSuggestions(
    query: string,
    options?: GoogleSuggestRequestOptions,
  ): Promise<readonly string[]>;
}

export const DEFAULT_GOOGLE_SUGGEST_ENDPOINT =
  "https://suggestqueries.google.com/complete/search";
export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveEnvValue(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

export class UnofficialGoogleSuggestClient implements GoogleSuggestClient {
  readonly language: string;
  readonly country: string;
  readonly endpoint: string;
  readonly defaultTimeoutMs: number;
  readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly cache?: GoogleSuggestCache;

  constructor(config?: GoogleSuggestConfig) {
    this.language =
      config?.language ??
      resolveEnvValue("SEO_SEARCH_LANGUAGE") ??
      "en";
    this.country =
      config?.country ??
      resolveEnvValue("SEO_SEARCH_COUNTRY") ??
      "us";
    this.endpoint = config?.endpoint ?? DEFAULT_GOOGLE_SUGGEST_ENDPOINT;
    this.defaultTimeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.fetchFn = config?.fetchFn ?? fetch;
    this.cache =
      config?.cache === null
        ? undefined
        : (config?.cache ?? new InMemoryGoogleSuggestCache());
  }

  async getSuggestions(
    query: string,
    options?: GoogleSuggestRequestOptions,
  ): Promise<readonly string[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const cacheKey = createSuggestCacheKey(
      trimmedQuery,
      this.language,
      this.country,
    );

    if (!options?.bypassCache && this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    // Retry loop: max 2 attempts (1 initial + 1 retry on retryable error)
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const results = await this.executeRequest(
          trimmedQuery,
          timeoutMs,
          options?.signal,
        );

        if (this.cache) {
          this.cache.set(cacheKey, results);
        }

        return results;
      } catch (err) {
        lastError = err;
        const isRetryable = this.isRetryableError(err);
        if (!isRetryable || attempt >= 2) {
          throw err;
        }
        await sleep(this.retryDelayMs);
      }
    }

    throw lastError;
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof GoogleSuggestBlockedError) {
      return false;
    }
    if (err instanceof GoogleSuggestRateLimitError) {
      return true;
    }
    if (err instanceof GoogleSuggestError) {
      return err.isRetryable;
    }
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        // Caller abort should never be retried
        return false;
      }
      if (err.name === "TimeoutError") {
        return true;
      }
      if (err instanceof TypeError) {
        // Network connection error
        return true;
      }
    }
    return false;
  }

  private async executeRequest(
    query: string,
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<readonly string[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set("client", "firefox");
    url.searchParams.set("hl", this.language);
    url.searchParams.set("gl", this.country);
    url.searchParams.set("q", query);

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let didTimeout = false;
    let didParentAbort = false;

    const onParentAbort = (): void => {
      didParentAbort = true;
      controller.abort();
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        throw new GoogleSuggestError("Request was aborted before execution", {
          isRetryable: false,
        });
      }
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      });
    } catch (fetchErr) {
      if (didParentAbort || parentSignal?.aborted) {
        throw new GoogleSuggestError("Google suggest request was aborted", {
          isRetryable: false,
          cause: fetchErr,
        });
      }
      if (didTimeout) {
        throw new GoogleSuggestError(
          `Google suggest request timed out after ${timeoutMs}ms`,
          { status: 408, isRetryable: true, cause: fetchErr },
        );
      }
      throw new GoogleSuggestError(
        `Google suggest network error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        { isRetryable: true, cause: fetchErr },
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 403) {
        throw new GoogleSuggestBlockedError(
          "Google suggest request blocked (403)",
        );
      }
      if (status === 429) {
        throw new GoogleSuggestRateLimitError(
          "Google suggest rate limit exceeded (429)",
        );
      }
      if (status === 408 || status === 502 || status === 503 || status === 504) {
        throw new GoogleSuggestError(
          `Google suggest transient server error (${status})`,
          { status, isRetryable: true },
        );
      }
      // Non-retryable HTTP errors (400, 401, 404, other 4xx)
      throw new GoogleSuggestError(
        `Google suggest request failed with HTTP ${status}`,
        { status, isRetryable: status >= 500 },
      );
    }

    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch (parseErr) {
      throw new GoogleSuggestError(
        "Failed to parse Google suggest JSON response",
        { isRetryable: false, cause: parseErr },
      );
    }

    // Defensive parsing: must be array of length >= 2, and root[1] must be string array
    if (
      !Array.isArray(rawData) ||
      rawData.length < 2 ||
      !Array.isArray(rawData[1]) ||
      !rawData[1].every((item) => typeof item === "string")
    ) {
      throw new GoogleSuggestError(
        "Malformed Google suggest response: expected [query, string[]]",
        { isRetryable: false },
      );
    }

    return rawData[1];
  }
}
