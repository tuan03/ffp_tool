import { GatewayError } from "../errors";
import type { StoreRegistry } from "../store-registry";
import type { StoreConfig } from "../types";

export interface GatewayStoreSummary {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly apiVersion?: string;
  readonly authType: "static" | "client_credentials";
  readonly connected?: boolean;
}

export function toStoreSummary(config: StoreConfig, connected?: boolean): GatewayStoreSummary {
  return {
    storeId: config.storeId,
    shopDomain: config.shopDomain,
    apiVersion: config.apiVersion,
    authType: config.auth.type,
    connected,
  };
}

/**
 * Data Plane: Lists stores in safe summary format.
 * Credentials and sensitive proxy details are never exposed.
 * niche is not supported.
 */
export async function executeStoresList(
  storeRegistry: StoreRegistry,
  _payload?: unknown,
): Promise<{ stores: readonly GatewayStoreSummary[]; total: number }> {
  const allStores = await storeRegistry.listStores();
  const summaries = allStores.map((s) => toStoreSummary(s, undefined));

  return {
    stores: summaries,
    total: summaries.length,
  };
}

/**
 * Data Plane: Gets a single store in safe summary format.
 * Credentials and sensitive proxy details are never exposed.
 */
export async function executeStoresGet(
  storeRegistry: StoreRegistry,
  payload: unknown,
  defaultStoreId?: string,
): Promise<{ store: GatewayStoreSummary | null }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const targetId =
    typeof p.targetStoreId === "string" && p.targetStoreId.trim() !== ""
      ? p.targetStoreId.trim()
      : typeof p.storeId === "string" && p.storeId.trim() !== ""
      ? p.storeId.trim()
      : defaultStoreId && defaultStoreId !== "system"
      ? defaultStoreId.trim()
      : undefined;

  if (!targetId || targetId === "") {
    throw new GatewayError("targetStoreId is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  const store = await storeRegistry.getStore(targetId);
  return {
    store: store ? toStoreSummary(store, undefined) : null,
  };
}
