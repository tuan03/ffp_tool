import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryStoreRegistry } from "../store-registry";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryThrottleManager } from "../throttle-manager";
import { ShopifyOrdersClient } from "../ads-intelligence/shopify-client";
import { assertAdsStoreDomain, configureAdsGateway, listAdsGatewayStores } from "../ads-intelligence/gateway-connection";
import type { StoreConfig } from "../types";

const store: StoreConfig = { storeId: "new-shop", shopDomain: "new-shop.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture-secret" } };
const emptyPage = { shop: { currencyCode: "USD" }, orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } };

test("Ads discovers stores added to the shared registry without env or Ads profiles", async () => {
  const registry = new InMemoryStoreRegistry([]);
  const client = new ShopifyGraphqlClient({ tokenProvider: { getToken: async () => "fixture", invalidate() {} }, throttleManager: new InMemoryThrottleManager() });
  configureAdsGateway({ storeRegistry: registry, graphqlClient: client });
  assert.deepEqual(await listAdsGatewayStores(), []);
  registry.registerStore(store);
  const stores = await listAdsGatewayStores();
  assert.equal(stores[0]?.storeId, "new-shop");
  assert.doesNotMatch(JSON.stringify(stores), /fixture-secret|staticToken|clientSecret/);
  registry.removeStore("new-shop");
  assert.deepEqual(await listAdsGatewayStores(), []);
});

test("Ads reads Shopify through Gateway token provider and rejects unknown stores without samples", async () => {
  const registry = new InMemoryStoreRegistry([store]);
  let usedDomain = "";
  const client = new ShopifyGraphqlClient({
    tokenProvider: { getToken: async selected => { usedDomain = selected.shopDomain; return "fixture"; }, invalidate() {} },
    throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => new Response(JSON.stringify({ data: String(init?.body).includes("AdsHistoryAccess") ? {currentAppInstallation:{accessScopes:[{handle:"read_all_orders"}]},shop:{createdAt:"2020-01-01T00:00:00Z"}} : emptyPage }), { headers: { "Content-Type": "application/json" } }),
  });
  configureAdsGateway({ storeRegistry: registry, graphqlClient: client });
  const summary = await new ShopifyOrdersClient().getOrderSummary("new-shop");
  assert.equal(usedDomain, store.shopDomain);
  assert.equal(summary.totalOrders, 0);
  assert.equal(summary.status, "CONNECTED");
  await assertAdsStoreDomain("new-shop", store.shopDomain);
  await assert.rejects(assertAdsStoreDomain("new-shop", "other.myshopify.com"), /ADS_STORE_MAPPING_MISMATCH/);
  await assert.rejects(new ShopifyOrdersClient().getOrderSummary("absent"), /ADS_STORE_NOT_REGISTERED/);
});
