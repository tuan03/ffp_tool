import { GatewayError } from "./errors";
import { normalizeShopDomain, type StoreRegistry } from "./store-registry";
import type { ShopifyGraphqlClient } from "./shopify-graphql-client";
import type { TokenProvider } from "./token-provider";
import type { StoreAuthConfig, StoreConfig, StoreProxyConfig } from "./types";
import { toStoreSummary, type GatewayStoreSummary } from "./operations/store-management";

export type StoreAuthInput =
  | {
      readonly type: "static_access_token";
      readonly accessToken: string;
    }
  | {
      readonly type: "client_credentials";
      readonly clientId: string;
      readonly clientSecret: string;
    };

export interface RegisterStoreInput {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly apiVersion?: string;
  readonly auth: StoreAuthInput;
  readonly proxy?: StoreProxyConfig;
}

export interface UpdateStoreCredentialsInput {
  readonly storeId: string;
  readonly shopDomain?: string;
  readonly auth: StoreAuthInput;
  readonly proxy?: StoreProxyConfig;
  readonly apiVersion?: string;
}

export interface StoreRegistrationResult {
  readonly store: GatewayStoreSummary;
  readonly registered: boolean;
}

export interface StoreUpdateResult {
  readonly store: GatewayStoreSummary;
  readonly updated: boolean;
}

export interface StoreDisconnectResult {
  readonly storeId: string;
  readonly disconnected: boolean;
}

export interface StoreControlPlaneOptions {
  readonly storeRegistry: StoreRegistry;
  readonly tokenProvider: TokenProvider;
  readonly graphqlClient: ShopifyGraphqlClient;
}

const PREFLIGHT_STORE_CONNECTION_QUERY = `
  query StoreConnectionTest {
    shop {
      id
      name
      myshopifyDomain
    }
  }
`;

interface PreflightShopQueryResponse {
  readonly shop?: {
    readonly id?: string | null;
    readonly name?: string | null;
    readonly myshopifyDomain?: string | null;
  } | null;
}

function mapAuthInputToStoreAuthConfig(auth: StoreAuthInput): StoreAuthConfig {
  if (!auth || typeof auth !== "object") {
    throw new GatewayError("Authentication configuration is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  if (auth.type === "static_access_token") {
    const token = typeof auth.accessToken === "string" ? auth.accessToken.trim() : "";
    if (!token) {
      throw new GatewayError("accessToken cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    return {
      type: "static",
      staticToken: token,
    };
  }

  if (auth.type === "client_credentials") {
    const clientId = typeof auth.clientId === "string" ? auth.clientId.trim() : "";
    const clientSecret = typeof auth.clientSecret === "string" ? auth.clientSecret.trim() : "";
    if (!clientId) {
      throw new GatewayError("clientId cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (!clientSecret) {
      throw new GatewayError("clientSecret cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    return {
      type: "client_credentials",
      clientId,
      clientSecret,
    };
  }

  throw new GatewayError("Unsupported authentication type", "SHOPIFY_INVALID_INPUT", 400);
}

/**
 * Server-only Store Control Plane.
 * Manages store onboarding, credential storage, preflight verification,
 * and token cache invalidation.
 * Not exposed to the React browser module.
 */
export class StoreControlPlane {
  private readonly storeRegistry: StoreRegistry;
  private readonly tokenProvider: TokenProvider;
  private readonly graphqlClient: ShopifyGraphqlClient;

  public constructor(options: StoreControlPlaneOptions) {
    this.storeRegistry = options.storeRegistry;
    this.tokenProvider = options.tokenProvider;
    this.graphqlClient = options.graphqlClient;
  }

  /**
   * Preflight verifies credentials against Shopify Admin GraphQL before persisting.
   */
  private async verifyStoreCredentials(storeConfig: StoreConfig): Promise<void> {
    try {
      const response = await this.graphqlClient.query<PreflightShopQueryResponse>(
        storeConfig,
        PREFLIGHT_STORE_CONNECTION_QUERY,
        {},
        { isWrite: false },
      );

      if (!response?.shop?.id && !response?.shop?.myshopifyDomain) {
        throw new GatewayError(
          "Shopify preflight connection test returned empty shop response",
          "SHOPIFY_AUTH_FAILED",
          401,
        );
      }
    } catch (err: unknown) {
      // Invalidate token cache in case a bad/half-exchanged token was cached
      this.tokenProvider.invalidate?.(storeConfig.storeId);

      if (err instanceof GatewayError) {
        throw err;
      }

      // Ensure no raw secrets are leaked in the error
      throw new GatewayError(
        "Shopify credential preflight verification failed",
        "SHOPIFY_AUTH_FAILED",
        401,
        undefined,
        err,
      );
    }
  }

  /**
   * Registers a store after strict domain normalization and preflight credential verification.
   */
  public async registerStore(input: RegisterStoreInput): Promise<StoreRegistrationResult> {
    if (!input || typeof input !== "object") {
      throw new GatewayError("Registration input must be an object", "SHOPIFY_INVALID_INPUT", 400);
    }

    const storeId = typeof input.storeId === "string" ? input.storeId.trim() : "";
    if (!storeId) {
      throw new GatewayError("storeId is required for store registration", "SHOPIFY_INVALID_INPUT", 400);
    }

    const normalizedDomain = normalizeShopDomain(input.shopDomain);
    const storeAuth = mapAuthInputToStoreAuthConfig(input.auth);
    const apiVersion =
      typeof input.apiVersion === "string" && input.apiVersion.trim() !== ""
        ? input.apiVersion.trim()
        : "2026-07";

    const candidateConfig: StoreConfig = {
      storeId,
      shopDomain: normalizedDomain,
      apiVersion,
      auth: storeAuth,
      proxy: input.proxy,
    };

    // If re-registering existing store, invalidate existing cache first
    this.tokenProvider.invalidate?.(storeId);

    // Preflight verification before persisting
    await this.verifyStoreCredentials(candidateConfig);

    // Persist to registry
    try {
      await this.storeRegistry.registerStore(candidateConfig);
    } catch (persistErr: unknown) {
      this.tokenProvider.invalidate?.(storeId);
      throw persistErr;
    }

    return {
      store: toStoreSummary(candidateConfig, true),
      registered: true,
    };
  }

  /**
   * Updates credentials for an existing store after preflight verification.
   */
  public async updateStoreCredentials(
    input: UpdateStoreCredentialsInput,
  ): Promise<StoreUpdateResult> {
    if (!input || typeof input !== "object") {
      throw new GatewayError("Update input must be an object", "SHOPIFY_INVALID_INPUT", 400);
    }

    const storeId = typeof input.storeId === "string" ? input.storeId.trim() : "";
    if (!storeId) {
      throw new GatewayError("storeId is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    const existing = await this.storeRegistry.getStore(storeId);
    if (!existing) {
      throw new GatewayError(`Store not found: ${storeId}`, "SHOPIFY_NOT_FOUND", 404);
    }

    const shopDomain =
      typeof input.shopDomain === "string" && input.shopDomain.trim() !== ""
        ? normalizeShopDomain(input.shopDomain)
        : existing.shopDomain;
    const storeAuth = mapAuthInputToStoreAuthConfig(input.auth);
    const apiVersion =
      typeof input.apiVersion === "string" && input.apiVersion.trim() !== ""
        ? input.apiVersion.trim()
        : existing.apiVersion;

    const candidateConfig: StoreConfig = {
      ...existing,
      shopDomain,
      apiVersion,
      auth: storeAuth,
      proxy: input.proxy !== undefined ? input.proxy : existing.proxy,
    };

    // Invalidate token cache before testing new credentials
    this.tokenProvider.invalidate?.(storeId);

    // Preflight verification with new credentials
    await this.verifyStoreCredentials(candidateConfig);

    // Update in store registry
    try {
      await this.storeRegistry.updateStore(candidateConfig);
    } catch (persistErr: unknown) {
      this.tokenProvider.invalidate?.(storeId);
      throw persistErr;
    }

    return {
      store: toStoreSummary(candidateConfig, true),
      updated: true,
    };
  }

  /**
   * Disconnects a store from the registry and purges cached tokens.
   */
  public async disconnectStore(storeId: string): Promise<StoreDisconnectResult> {
    const trimmedId = typeof storeId === "string" ? storeId.trim() : "";
    if (!trimmedId) {
      throw new GatewayError("storeId is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    // Invalidate token cache before removal
    this.tokenProvider.invalidate?.(trimmedId);

    const exists = await this.storeRegistry.hasStore(trimmedId);
    if (exists) {
      await this.storeRegistry.removeStore(trimmedId);
    }

    // Invalidate token cache after removal
    this.tokenProvider.invalidate?.(trimmedId);

    return {
      storeId: trimmedId,
      disconnected: exists,
    };
  }

  /**
   * Retrieves a sanitized store summary (never exposes secrets or tokens).
   */
  public async getStore(storeId: string): Promise<{ store: GatewayStoreSummary | null }> {
    const trimmedId = typeof storeId === "string" ? storeId.trim() : "";
    if (!trimmedId) {
      throw new GatewayError("storeId is required", "SHOPIFY_INVALID_INPUT", 400);
    }

    const store = await this.storeRegistry.getStore(trimmedId);
    return {
      store: store ? toStoreSummary(store, true) : null,
    };
  }

  /**
   * Lists all stores with sanitized summaries (never exposes secrets or tokens).
   */
  public async listStores(): Promise<{ stores: readonly GatewayStoreSummary[]; total: number }> {
    const all = await this.storeRegistry.listStores();
    const summaries = all.map((s) => toStoreSummary(s, true));
    return {
      stores: summaries,
      total: summaries.length,
    };
  }
}
