import { GatewayError } from "./errors";
import { createStoreTransport } from "./proxy-transport";
import type { HttpTransport, StoreConfig } from "./types";

export interface TokenProvider {
  getToken(store: StoreConfig): Promise<string>;
  invalidate(storeId: string): void;
}

export class StaticAccessTokenProvider implements TokenProvider {
  public async getToken(store: StoreConfig): Promise<string> {
    const token = store.auth.staticToken?.trim();
    if (!token) {
      throw new GatewayError("Static access token is missing or empty", "SHOPIFY_AUTH_FAILED", 401);
    }
    return token;
  }

  public invalidate(_storeId: string): void {}
}

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface ClientCredentialsTokenProviderOptions {
  readonly transport?: HttpTransport;
  readonly clock?: () => number;
  readonly timeoutMs?: number;
}

export class ClientCredentialsTokenProvider implements TokenProvider {
  private readonly cache = new Map<string, CachedToken>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly baseTransport: HttpTransport;
  private readonly clock: () => number;
  private readonly defaultTtlMs = 86_400_000; // 24 hours
  private readonly safetyBufferMs = 300_000; // 5 minutes
  private readonly timeoutMs: number;

  public constructor(options?: ClientCredentialsTokenProviderOptions) {
    this.baseTransport = options?.transport ?? globalThis.fetch;
    this.clock = options?.clock ?? Date.now;
    this.timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 15_000;
  }

  public async getToken(store: StoreConfig): Promise<string> {
    const clientId = store.auth.clientId?.trim();
    const clientSecret = store.auth.clientSecret?.trim();
    if (!clientId || !clientSecret) {
      throw new GatewayError("Client ID and Client Secret are required", "SHOPIFY_AUTH_FAILED", 401);
    }

    const storeId = store.storeId.trim();
    const cached = this.cache.get(storeId);
    const now = this.clock();
    if (cached && cached.expiresAtMs > now) {
      return cached.token;
    }

    const existingPromise = this.inFlight.get(storeId);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = this.fetchAndCacheToken(store, storeId, clientId, clientSecret);
    this.inFlight.set(storeId, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlight.delete(storeId);
    }
  }

  private async fetchAndCacheToken(
    store: StoreConfig,
    storeId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    const now = this.clock();

    const transport = createStoreTransport(store, this.baseTransport);
    const tokenUrl = `https://${store.shopDomain}/admin/oauth/access_token`;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await transport(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }),
        signal: abortController.signal,
      });
    } catch (networkErr: unknown) {
      if (abortController.signal.aborted || (networkErr instanceof Error && networkErr.name === "AbortError")) {
        throw new GatewayError(
          "Shopify OAuth token exchange timed out",
          "SHOPIFY_NETWORK_ERROR",
          504,
          undefined,
          networkErr,
        );
      }
      throw new GatewayError("Failed to reach Shopify OAuth endpoint", "SHOPIFY_NETWORK_ERROR", 502, undefined, networkErr);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = await response.text();
        if (bodyText.toLowerCase().includes("shop_not_permitted")) {
          throw new GatewayError(
            "Shopify store is not permitted for client app (shop_not_permitted)",
            "SHOPIFY_AUTH_FAILED",
            401,
          );
        }

        const json = JSON.parse(bodyText);
        if (json && typeof json === "object") {
          const errVal = (json.error || json.error_code || "") as string;
          const descVal = (json.error_description || json.message || "") as string;
          if (errVal || descVal) {
            throw new GatewayError(
              `Shopify OAuth authentication failed: ${errVal || response.status}`,
              "SHOPIFY_AUTH_FAILED",
              401,
            );
          }
        }
      } catch (err: unknown) {
        if (err instanceof GatewayError) {
          throw err;
        }
      }
      throw new GatewayError(
        `Shopify OAuth token exchange failed with status ${response.status}`,
        "SHOPIFY_AUTH_FAILED",
        401,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (parseErr: unknown) {
      throw new GatewayError("Failed to parse Shopify OAuth response", "SHOPIFY_NETWORK_ERROR", 502, undefined, parseErr);
    }

    const tokenObj = body as Record<string, unknown>;
    const accessToken = typeof tokenObj.access_token === "string" ? tokenObj.access_token : undefined;
    if (!accessToken) {
      throw new GatewayError("Shopify OAuth response missing access_token", "SHOPIFY_AUTH_FAILED", 401);
    }

    const rawExpiresIn = typeof tokenObj.expires_in === "number" ? tokenObj.expires_in : undefined;
    // Cache strictly according to actual expires_in returned by Shopify minus 5-minute safety buffer
    const effectiveTtlMs = rawExpiresIn !== undefined
      ? Math.max(60_000, rawExpiresIn * 1000 - this.safetyBufferMs)
      : Math.max(60_000, this.defaultTtlMs - this.safetyBufferMs);

    this.cache.set(storeId, {
      token: accessToken,
      expiresAtMs: now + effectiveTtlMs,
    });

    return accessToken;
  }

  public invalidate(storeId: string): void {
    const trimmed = storeId.trim();
    this.cache.delete(trimmed);
    this.inFlight.delete(trimmed);
  }
}

export class CompositeTokenProvider implements TokenProvider {
  private readonly staticProvider = new StaticAccessTokenProvider();
  private readonly clientCredsProvider: ClientCredentialsTokenProvider;

  public constructor(options?: { transport?: HttpTransport; clock?: () => number }) {
    this.clientCredsProvider = new ClientCredentialsTokenProvider(options);
  }

  public async getToken(store: StoreConfig): Promise<string> {
    if (store.auth.type === "client_credentials") {
      return this.clientCredsProvider.getToken(store);
    }
    return this.staticProvider.getToken(store);
  }

  public invalidate(storeId: string): void {
    this.clientCredsProvider.invalidate(storeId);
  }
}
