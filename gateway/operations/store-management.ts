import { GatewayError } from "../errors";
import type { StoreRegistry } from "../store-registry";
import type { StoreConfig } from "../types";

export interface GatewayStoreSummary {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly apiVersion?: string;
  readonly niche?: string;
  readonly authType: "static" | "client_credentials";
  readonly proxyUrl?: string;
}

export function toStoreSummary(config: StoreConfig): GatewayStoreSummary {
  return {
    storeId: config.storeId,
    shopDomain: config.shopDomain,
    apiVersion: config.apiVersion,
    niche: config.niche,
    authType: config.auth.type,
    proxyUrl: config.proxy?.url,
  };
}

export async function executeStoresRegister(
  storeRegistry: StoreRegistry,
  payload: unknown,
): Promise<{ store: GatewayStoreSummary; registered: boolean }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const storeId = typeof p.storeId === "string" ? p.storeId.trim() : "";
  const shopDomain = typeof p.shopDomain === "string" ? p.shopDomain.trim() : "";

  if (!storeId) {
    throw new GatewayError("storeId is required for store registration", "SHOPIFY_INVALID_INPUT", 400);
  }
  if (!shopDomain) {
    throw new GatewayError("shopDomain is required for store registration", "SHOPIFY_INVALID_INPUT", 400);
  }

  const staticToken =
    typeof p.staticToken === "string" && p.staticToken.trim() !== ""
      ? p.staticToken.trim()
      : typeof p.accessToken === "string" && p.accessToken.trim() !== ""
        ? p.accessToken.trim()
        : undefined;

  const clientId = typeof p.clientId === "string" && p.clientId.trim() !== "" ? p.clientId.trim() : undefined;
  const clientSecret =
    typeof p.clientSecret === "string" && p.clientSecret.trim() !== "" ? p.clientSecret.trim() : undefined;

  let authType: "static" | "client_credentials";
  if (p.authType === "client_credentials" || p.authType === "static") {
    authType = p.authType;
  } else if (clientId && clientSecret) {
    authType = "client_credentials";
  } else if (staticToken) {
    authType = "static";
  } else {
    throw new GatewayError(
      "Either staticToken/accessToken or clientId+clientSecret is required for store registration",
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  const niche = typeof p.niche === "string" && p.niche.trim() !== "" ? p.niche.trim() : undefined;
  const apiVersion =
    typeof p.apiVersion === "string" && p.apiVersion.trim() !== "" ? p.apiVersion.trim() : "2026-07";
  const proxyUrl = typeof p.proxyUrl === "string" && p.proxyUrl.trim() !== "" ? p.proxyUrl.trim() : undefined;

  const storeConfig: StoreConfig = {
    storeId,
    shopDomain,
    apiVersion,
    auth: {
      type: authType,
      staticToken,
      clientId,
      clientSecret,
    },
    proxy: proxyUrl ? { url: proxyUrl } : undefined,
    niche,
  };

  storeRegistry.registerStore(storeConfig);

  return {
    store: toStoreSummary(storeConfig),
    registered: true,
  };
}

export async function executeStoresList(
  storeRegistry: StoreRegistry,
  payload: unknown,
): Promise<{ stores: readonly GatewayStoreSummary[]; total: number }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const niche = typeof p.niche === "string" && p.niche.trim() !== "" ? p.niche.trim() : undefined;

  const allStores = await storeRegistry.listStores();
  const filtered = niche ? allStores.filter((s) => s.niche === niche) : allStores;
  const summaries = filtered.map(toStoreSummary);

  return {
    stores: summaries,
    total: summaries.length,
  };
}

export async function executeStoresGet(
  storeRegistry: StoreRegistry,
  payload: unknown,
  defaultStoreId?: string,
): Promise<{ store: GatewayStoreSummary | null }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const targetId =
    typeof p.targetStoreId === "string" && p.targetStoreId.trim() !== ""
      ? p.targetStoreId.trim()
      : defaultStoreId;

  if (!targetId) {
    throw new GatewayError("targetStoreId is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  const store = await storeRegistry.getStore(targetId);
  return {
    store: store ? toStoreSummary(store) : null,
  };
}

export async function executeStoresDisconnect(
  storeRegistry: StoreRegistry,
  payload: unknown,
  defaultStoreId?: string,
): Promise<{ storeId: string; disconnected: boolean }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const targetId =
    typeof p.targetStoreId === "string" && p.targetStoreId.trim() !== ""
      ? p.targetStoreId.trim()
      : defaultStoreId;

  if (!targetId) {
    throw new GatewayError("targetStoreId is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  const exists = await storeRegistry.hasStore(targetId);
  if (exists) {
    storeRegistry.removeStore(targetId);
  }

  return {
    storeId: targetId,
    disconnected: exists,
  };
}
