import { GatewayError } from "./errors";
import type { StoreConfig } from "./types";

/**
 * Normalizes and validates a Shopify shop domain.
 *
 * Supported formats:
 * - "capozen" -> "capozen.myshopify.com"
 * - "capozen.myshopify.com" -> "capozen.myshopify.com"
 * - "https://capozen.myshopify.com" -> "capozen.myshopify.com"
 * - "https://admin.shopify.com/store/capozen" -> "capozen.myshopify.com"
 *
 * Rejects:
 * - Empty or whitespace string
 * - "admin.shopify.com" (cannot be used without store path)
 * - Custom domains not ending with ".myshopify.com"
 * - Invalid subdomain handles or ambiguous formats
 */
export function normalizeShopDomain(rawDomain: string): string {
  if (typeof rawDomain !== "string") {
    throw new GatewayError("Shop domain must be a string", "SHOPIFY_INVALID_INPUT", 400);
  }
  const trimmed = rawDomain.trim();
  if (!trimmed) {
    throw new GatewayError("Shop domain cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
  }

  const handleRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

  // Handle https://admin.shopify.com/store/<store-slug>
  const adminPattern = /^(?:https?:\/\/)?admin\.shopify\.com(?::\d+)?\/store\/([a-zA-Z0-9-]+)(?:[/?#].*)?$/i;
  const adminMatch = trimmed.match(adminPattern);
  if (adminMatch) {
    const slug = adminMatch[1].toLowerCase();
    if (!handleRegex.test(slug)) {
      throw new GatewayError(
        `Invalid Shopify store handle in admin URL: "${slug}"`,
        "SHOPIFY_INVALID_INPUT",
        400,
      );
    }
    return `${slug}.myshopify.com`;
  }

  // Explicitly reject bare admin.shopify.com or admin.shopify.com/* without valid store slug
  if (/^(?:https?:\/\/)?admin\.shopify\.com(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) {
    throw new GatewayError(
      "admin.shopify.com cannot be used directly as a shop domain; provide the store handle or full store URL",
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  // Strip protocol
  let normalized = trimmed.replace(/^https?:\/\//i, "");

  // Strip path, query, hash, and port
  normalized = normalized.replace(/[/?#].*$/, "");
  normalized = normalized.replace(/:\d+$/, "");
  normalized = normalized.toLowerCase();

  // If no dots, treat as subdomain/handle: e.g. "capozen" -> "capozen.myshopify.com"
  if (!normalized.includes(".")) {
    if (!handleRegex.test(normalized)) {
      throw new GatewayError(
        `Invalid Shopify store handle: "${rawDomain}"`,
        "SHOPIFY_INVALID_INPUT",
        400,
      );
    }
    return `${normalized}.myshopify.com`;
  }

  // If contains dots, must end with .myshopify.com
  if (!normalized.endsWith(".myshopify.com")) {
    throw new GatewayError(
      `Shop domain must end with .myshopify.com: "${rawDomain}"`,
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  // Check the prefix before .myshopify.com
  const prefix = normalized.slice(0, -".myshopify.com".length);
  if (!prefix || !handleRegex.test(prefix)) {
    throw new GatewayError(
      `Invalid Shopify store subdomain: "${prefix}" in "${rawDomain}"`,
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  return `${prefix}.myshopify.com`;
}

function deepCloneAndFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  const copy = Array.isArray(obj) ? [...obj] : { ...(obj as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    (copy as Record<string, unknown>)[key] = deepCloneAndFreeze(
      (copy as Record<string, unknown>)[key],
    );
  }
  return Object.freeze(copy) as T;
}

/**
 * Persistence abstraction for registered store configurations.
 * Designed so a future DatabaseStoreRegistry, Redis, or encrypted persistence
 * can replace InMemoryStoreRegistry without changing callers.
 */
export interface StoreRegistry {
  getStore(storeId: string): Promise<StoreConfig | undefined> | StoreConfig | undefined;
  listStores(): Promise<readonly StoreConfig[]> | readonly StoreConfig[];
  registerStore(config: StoreConfig): Promise<void> | void;
  updateStore(config: StoreConfig): Promise<void> | void;
  removeStore(storeId: string): Promise<void> | void;
  hasStore(storeId: string): Promise<boolean> | boolean;
}

/**
 * In-memory registry implementation for tests and local development.
 * Note: InMemoryStoreRegistry is development-only and loses dynamically registered stores on restart.
 */
export class InMemoryStoreRegistry implements StoreRegistry {
  private readonly stores = new Map<string, StoreConfig>();

  public constructor(initialStores?: readonly StoreConfig[]) {
    if (initialStores) {
      for (const store of initialStores) {
        this.registerStore(store);
      }
    }
  }

  public registerStore(config: StoreConfig): void {
    if (!config || typeof config !== "object") {
      throw new GatewayError("Store configuration must be an object", "SHOPIFY_INVALID_INPUT", 400);
    }
    const storeId = config.storeId?.trim();
    if (!storeId) {
      throw new GatewayError("Store ID cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    const shopDomain = config.shopDomain?.trim();
    if (!shopDomain) {
      throw new GatewayError("Shop domain cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    const apiVersion = config.apiVersion?.trim() || "2026-07";

    const normalizedStore: StoreConfig = {
      ...config,
      storeId,
      shopDomain: normalizeShopDomain(shopDomain),
      apiVersion,
    };

    this.stores.set(storeId, deepCloneAndFreeze(normalizedStore));
  }

  public updateStore(config: StoreConfig): void {
    if (!config || typeof config !== "object") {
      throw new GatewayError("Store configuration must be an object", "SHOPIFY_INVALID_INPUT", 400);
    }
    const storeId = config.storeId?.trim();
    if (!storeId || !this.stores.has(storeId)) {
      throw new GatewayError(`Store not found: ${storeId}`, "SHOPIFY_NOT_FOUND", 404);
    }
    const shopDomain = config.shopDomain?.trim();
    if (!shopDomain) {
      throw new GatewayError("Shop domain cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    const apiVersion = config.apiVersion?.trim() || "2026-07";

    const normalizedStore: StoreConfig = {
      ...config,
      storeId,
      shopDomain: normalizeShopDomain(shopDomain),
      apiVersion,
    };

    this.stores.set(storeId, deepCloneAndFreeze(normalizedStore));
  }

  public getStore(storeId: string): StoreConfig | undefined {
    return this.stores.get(storeId);
  }

  public listStores(): readonly StoreConfig[] {
    return Array.from(this.stores.values());
  }

  public removeStore(storeId: string): void {
    this.stores.delete(storeId);
  }

  public hasStore(storeId: string): boolean {
    return this.stores.has(storeId);
  }
}
