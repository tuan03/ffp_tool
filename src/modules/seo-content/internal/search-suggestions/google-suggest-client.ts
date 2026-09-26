import { abortableDelay, runProviderRequest, type ProviderRequestOptions } from "../provider-runtime";
import { SingleFlight } from "../single-flight";
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

export interface GoogleSuggestRequestOptions extends ProviderRequestOptions {
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
  private readonly inFlight = new SingleFlight<readonly string[]>();
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
    options?.signal?.throwIfAborted();
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
        options?.onMetric?.({ cacheHit: true });
        return cached;
      }
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    return this.inFlight.join(cacheKey, async signal => {
      // Retry loop: max 2 attempts (1 initial + 1 retry on retryable error)
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const results = await runProviderRequest("suggest", requestSignal => this.executeRequest(
            trimmedQuery, requestSignal,
          ), { ...options, signal, timeoutMs });

          if (this.cache) {
            this.cache.set(cacheKey, results);
          }

          return results;
        } catch (err) {
          lastError = err;
          const isRetryable = this.isRetryableError(err);
          if (!isRetryable || attempt >= 2) {
            if (err instanceof Error && err.name === "TimeoutError") {
              throw new GoogleSuggestError(`Google suggest request timed out after ${timeoutMs}ms`, { status: 408, isRetryable: true, cause: err });
            }
            throw err;
          }
          options?.onMetric?.({ retryWaitMs: this.retryDelayMs });
          await abortableDelay(this.retryDelayMs, signal);
        }
      }

      throw lastError;
    }, options?.signal);
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
    parentSignal: AbortSignal,
  ): Promise<readonly string[]> {
    parentSignal?.throwIfAborted();
    const url = new URL(this.endpoint);
    url.searchParams.set("client", "firefox");
    url.searchParams.set("hl", this.language);
    url.searchParams.set("gl", this.country);
    url.searchParams.set("q", query);


    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        method: "GET",
        signal: parentSignal,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      });
    } catch (fetchErr) {
      parentSignal.throwIfAborted();
      throw new GoogleSuggestError(
        `Google suggest network error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        { isRetryable: true, cause: fetchErr },
      );
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
      parentSignal.throwIfAborted();
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

    parentSignal.throwIfAborted();
    return rawData[1];
  }
}

let sharedClient: UnofficialGoogleSuggestClient | undefined;
export function getSharedGoogleSuggestClient(): UnofficialGoogleSuggestClient {
  return sharedClient ??= new UnofficialGoogleSuggestClient({ cache: defaultGoogleSuggestCache });
}
