import { GatewayError } from "./errors";
import type { StoreConfig } from "./types";

export function normalizeShopDomain(domain: string): string {
  let normalized = domain.trim().toLowerCase();
  normalized = normalized.replace(/^https?:\/\//, "");
  normalized = normalized.replace(/\/.*$/, "");
  normalized = normalized.replace(/:\d+$/, "");
  if (!normalized.includes(".")) {
    normalized = `${normalized}.myshopify.com`;
  }
  return normalized;
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

export interface StoreRegistry {
  getStore(storeId: string): Promise<StoreConfig | undefined> | StoreConfig | undefined;
  listStores(): Promise<readonly StoreConfig[]> | readonly StoreConfig[];
  registerStore(config: StoreConfig): void;
  removeStore(storeId: string): void;
  hasStore(storeId: string): boolean;
}

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
