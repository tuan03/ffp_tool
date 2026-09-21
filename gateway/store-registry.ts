import { GatewayError } from "./errors";
import type { StoreConfig } from "./types";

export interface StoreRegistry {
  getStore(storeId: string): Promise<StoreConfig | undefined> | StoreConfig | undefined;
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
    if (!config.storeId || config.storeId.trim() === "") {
      throw new GatewayError("Store ID cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    if (!config.shopDomain || config.shopDomain.trim() === "") {
      throw new GatewayError("Shop domain cannot be empty", "SHOPIFY_INVALID_INPUT", 400);
    }
    this.stores.set(config.storeId, { ...config });
  }

  public getStore(storeId: string): StoreConfig | undefined {
    return this.stores.get(storeId);
  }

  public removeStore(storeId: string): void {
    this.stores.delete(storeId);
  }

  public hasStore(storeId: string): boolean {
    return this.stores.has(storeId);
  }
}
