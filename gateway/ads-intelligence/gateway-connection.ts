import { createHash } from "node:crypto";
import type { StoreConfig } from "../types";
import type { StoreRegistry } from "../store-registry";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { adsIntelligenceCache } from "./cache";

interface AdsGatewayConnection {
  readonly storeRegistry: Pick<StoreRegistry, "getStore" | "listStores">;
  readonly graphqlClient: ShopifyGraphqlClient;
}
const storeSignatures = new Map<string, string>();
let connection: AdsGatewayConnection | undefined;

export function configureAdsGateway(next: AdsGatewayConnection): void {
  connection = next;
  storeSignatures.clear();
  adsIntelligenceCache.invalidate();
}

export function getAdsGateway(): AdsGatewayConnection {
  if (!connection) throw new Error("ADS_GATEWAY_NOT_CONFIGURED");
  return connection;
}

export async function listAdsGatewayStores(): Promise<readonly { storeId: string; shopDomain: string; hasProxy: boolean }[]> {
  const stores = await getAdsGateway().storeRegistry.listStores();
  return stores.map(store => ({ storeId: store.storeId, shopDomain: store.shopDomain, hasProxy: Boolean(store.proxy) }));
}

export async function getAdsGatewayStore(storeId: string): Promise<StoreConfig> {
  const store = await getAdsGateway().storeRegistry.getStore(storeId);
  if (!store) { adsIntelligenceCache.invalidate(`${storeId}:`); throw new Error("ADS_STORE_NOT_REGISTERED"); }
  const signature = createHash("sha256").update(JSON.stringify(store)).digest("hex");
  if (storeSignatures.get(storeId) !== signature) {
    adsIntelligenceCache.invalidate(`${storeId}:`);
    storeSignatures.set(storeId, signature);
  }
  return store;
}

export async function assertAdsStoreDomain(storeId: string, expectedDomain: string): Promise<void> {
  const store = await getAdsGatewayStore(storeId);
  if (store.shopDomain !== expectedDomain) throw new Error("ADS_STORE_MAPPING_MISMATCH");
}
