import { GatewayError, mapGraphqlErrorsToGatewayError } from "./errors";
import { createStoreTransport } from "./proxy-transport";
import type { ThrottleManager } from "./throttle-manager";
import type { TokenProvider } from "./token-provider";
import type { GraphQLResponse, HttpTransport, StoreConfig } from "./types";

export interface ShopifyGraphqlClientOptions {
  readonly tokenProvider: TokenProvider;
  readonly throttleManager: ThrottleManager;
  readonly baseTransport?: HttpTransport;
}

export class ShopifyGraphqlClient {
  private readonly tokenProvider: TokenProvider;
  private readonly throttleManager: ThrottleManager;
  private readonly baseTransport: HttpTransport;

  public constructor(options: ShopifyGraphqlClientOptions) {
    this.tokenProvider = options.tokenProvider;
    this.throttleManager = options.throttleManager;
    this.baseTransport = options.baseTransport ?? globalThis.fetch;
  }

  public async query<TData>(
    store: StoreConfig,
    graphqlQuery: string,
    variables?: Record<string, unknown>,
    options?: { requestId?: string; timeoutMs?: number; isWrite?: boolean },
  ): Promise<TData> {
    const maxRetries = 2;
    let maxAttempts = maxRetries;
    let hasRetriedAuth = false;

    const isWrite = Boolean(options?.isWrite);
    const defaultTimeoutMs = isWrite ? 60_000 : 30_000;
    const effectiveTimeoutMs =
      typeof options?.timeoutMs === "number" && options.timeoutMs > 0
        ? options.timeoutMs
        : defaultTimeoutMs;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const throttleStatus = this.throttleManager.check(store.storeId);
      if (throttleStatus.isThrottled) {
        const retryAfterSec = Math.ceil(throttleStatus.retryAfterMs / 1000);
        if (attempt < maxAttempts && throttleStatus.retryAfterMs <= 30000) {
          await new Promise((resolve) => setTimeout(resolve, throttleStatus.retryAfterMs));
          continue;
        }
        throw new GatewayError("Store is currently throttled", "SHOPIFY_THROTTLED", 429, retryAfterSec);
      }

      const token = await this.tokenProvider.getToken(store);
      const transport = createStoreTransport(store, this.baseTransport);
      const endpoint = `https://${store.shopDomain}/admin/api/${store.apiVersion}/graphql.json`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": token,
      };
      if (options?.requestId) {
        headers["X-Request-Id"] = options.requestId;
      }

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeoutMs);

      let response: Response;
      try {
        response = await transport(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: graphqlQuery, variables }),
          signal: abortController.signal,
        });
      } catch (networkErr: unknown) {
        if (abortController.signal.aborted || (networkErr instanceof Error && networkErr.name === "AbortError")) {
          if (isWrite) {
            throw new GatewayError(
              `Shopify GraphQL write mutation timed out after ${effectiveTimeoutMs}ms; write state is unknown`,
              "SHOPIFY_UNKNOWN_WRITE_STATE",
              500,
              undefined,
              networkErr,
              undefined,
              false,
              undefined,
              true,
            );
          }
          throw new GatewayError(
            `Shopify GraphQL query timed out after ${effectiveTimeoutMs}ms`,
            "SHOPIFY_NETWORK_ERROR",
            504,
            undefined,
            networkErr,
          );
        }

        if (isWrite) {
          throw new GatewayError(
            "Network request failed during write mutation; state is unknown",
            "SHOPIFY_UNKNOWN_WRITE_STATE",
            500,
            undefined,
            networkErr,
            undefined,
            false,
            undefined,
            true,
          );
        }
        throw new GatewayError(
          "Network request to Shopify GraphQL failed",
          "SHOPIFY_NETWORK_ERROR",
          502,
          undefined,
          networkErr,
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (
        isWrite &&
        (response.status === 408 ||
          response.status === 499 ||
          response.status === 502 ||
          response.status === 504)
      ) {
        throw new GatewayError(
          `Write request failed with status ${response.status}; write state is unknown`,
          "SHOPIFY_UNKNOWN_WRITE_STATE",
          response.status,
          undefined,
          undefined,
          undefined,
          false,
          undefined,
          true,
        );
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || 2 : 2;
        this.throttleManager.recordHttp429(store.storeId, retryAfterSec);
        const waitMs = retryAfterSec * 1000;
        if (attempt < maxAttempts && waitMs <= 30000) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        throw new GatewayError(
          "Shopify API rate limit exceeded (HTTP 429)",
          "SHOPIFY_THROTTLED",
          429,
          retryAfterSec,
        );
      }

      if (response.status === 401) {
        if (!hasRetriedAuth) {
          hasRetriedAuth = true;
          maxAttempts++;
          this.tokenProvider.invalidate?.(store.storeId);
          continue;
        }
        throw new GatewayError("Invalid Shopify access token (HTTP 401)", "SHOPIFY_AUTH_FAILED", 401);
      }
      if (response.status === 403) {
        throw new GatewayError("Forbidden Shopify access (HTTP 403)", "SHOPIFY_PERMISSION_DENIED", 403);
      }

      let parsed: GraphQLResponse<TData> | undefined;
      let jsonErr: unknown;
      try {
        parsed = (await response.json()) as GraphQLResponse<TData>;
      } catch (err: unknown) {
        jsonErr = err;
      }

      if (parsed?.extensions?.cost) {
        this.throttleManager.recordCost(store.storeId, parsed.extensions.cost);
      }

      if (parsed?.errors && parsed.errors.length > 0) {
        const mappedError = mapGraphqlErrorsToGatewayError(parsed.errors, parsed.extensions?.cost);
        if (mappedError.code === "SHOPIFY_THROTTLED") {
          this.throttleManager.recordThrottled(store.storeId, mappedError.retryAfterSeconds);
          const waitMs = (mappedError.retryAfterSeconds ?? 1) * 1000;
          if (attempt < maxAttempts && waitMs <= 30000) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
        }
        if (mappedError.code === "SHOPIFY_AUTH_FAILED") {
          if (!hasRetriedAuth) {
            hasRetriedAuth = true;
            maxAttempts++;
            this.tokenProvider.invalidate?.(store.storeId);
            continue;
          }
        }
        throw mappedError;
      }

      if (!response.ok) {
        if (options?.isWrite) {
          throw new GatewayError(
            `Shopify write mutation failed with status ${response.status}; write state is unknown`,
            "SHOPIFY_UNKNOWN_WRITE_STATE",
            response.status,
            undefined,
            jsonErr,
            undefined,
            false,
            undefined,
            true,
          );
        }
        throw new GatewayError(
          `Shopify GraphQL endpoint failed with status ${response.status}`,
          "SHOPIFY_NETWORK_ERROR",
          response.status,
          undefined,
          jsonErr,
        );
      }

      if (parsed === undefined) {
        if (options?.isWrite) {
          throw new GatewayError(
            "Failed to parse GraphQL write response JSON; write state is unknown",
            "SHOPIFY_UNKNOWN_WRITE_STATE",
            500,
            undefined,
            jsonErr,
            undefined,
            false,
            undefined,
            true,
          );
        }
        throw new GatewayError(
          "Failed to parse GraphQL response JSON",
          "SHOPIFY_NETWORK_ERROR",
          502,
          undefined,
          jsonErr,
        );
      }

      if (parsed.data === undefined || parsed.data === null) {
        if (options?.isWrite) {
          throw new GatewayError(
            "Shopify GraphQL write response missing data payload; write state is unknown",
            "SHOPIFY_UNKNOWN_WRITE_STATE",
            500,
            undefined,
            undefined,
            undefined,
            false,
            undefined,
            true,
          );
        }
        throw new GatewayError(
          "Shopify GraphQL response missing data payload",
          "SHOPIFY_NETWORK_ERROR",
          502,
        );
      }

      return parsed.data;
    }

    throw new GatewayError("Max retries reached for Shopify request", "SHOPIFY_NETWORK_ERROR", 500);
  }
}
