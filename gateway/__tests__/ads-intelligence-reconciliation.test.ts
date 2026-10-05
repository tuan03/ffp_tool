import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryStoreRegistry } from "../store-registry";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryThrottleManager } from "../throttle-manager";
import { configureAdsGateway } from "../ads-intelligence/gateway-connection";
import { ShopifyOrdersClient } from "../ads-intelligence/shopify-client";

const period = { since: "2026-09-01", until: "2026-09-30", timezone: "America/Los_Angeles" };
const order = (id: string, refund = "0.00") => ({ node: {
  id, createdAt: "2026-09-15T12:00:00Z", test: false, cancelledAt: null, displayFinancialStatus: "PAID",
  totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
  totalRefundedSet: { shopMoney: { amount: refund, currencyCode: "USD" } },
} });
const page = (edges: ReturnType<typeof order>[], hasNextPage = false, endCursor: string | null = null) => ({ shop: { currencyCode: "USD" }, orders: { edges, pageInfo: { hasNextPage, endCursor } } });
function setup(transport: typeof fetch): ShopifyOrdersClient {
  configureAdsGateway({
    storeRegistry: new InMemoryStoreRegistry([{ storeId: "fixture", shopDomain: "fixture.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture" } }]),
    graphqlClient: new ShopifyGraphqlClient({ tokenProvider: { getToken: async () => "fixture", invalidate() {} }, throttleManager: new InMemoryThrottleManager(), baseTransport: transport }),
  });
  return new ShopifyOrdersClient();
}
const response = (payload: unknown) => new Response(JSON.stringify({ data: payload }), { headers: { "Content-Type": "application/json" } });

test("Shopify paginates and filters refunds, cancelled/test orders and calendar boundaries", async () => {
  let calls = 0;
  const early = order("early"); early.node.createdAt = "2026-09-01T06:00:00Z";
  const testOrder = order("test"); testOrder.node.test = true;
  const refunded = order("refund", "100.00"); refunded.node.displayFinancialStatus = "REFUNDED";
  const client = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls++;
    if (calls === 1) { assert.equal(body.variables.cursor, null); return response(page([early, testOrder, order("one", "35.00")], true, "next")); }
    assert.equal(body.variables.cursor, "next");
    return response(page([order("one", "35.00"), refunded]));
  });
  const summary = await client.getOrderSummary("fixture", period);
  assert.equal(calls, 2); assert.equal(summary.totalOrders, 2);
  assert.equal(summary.netSales, "65.00"); assert.equal(summary.totalRefunds, "135.00");
});
test("Shopify refuses partial pagination instead of reporting incomplete totals", async () => {
  const client = setup(async () => response(page([], true, "repeat")));
  await assert.rejects(client.getOrderSummary("fixture", period), /SHOPIFY_PAGINATION_INCOMPLETE/);
});
test("Shopify propagates GraphQL permission errors without a calibrated ledger", async () => {
  const client = setup(async () => new Response(JSON.stringify({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] })));
  await assert.rejects(client.getOrderSummary("fixture", period));
});

test("Shopify refuses historical totals when read_all_orders is not granted", async () => {
  const client = setup(async () => response({ currentAppInstallation: { accessScopes: [{handle:"read_orders"}] }, shop: {createdAt:"2020-01-01T00:00:00Z"} }));
  await assert.rejects(client.getOrderSummary("fixture", {since:"2020-01-01",until:"2020-12-31"}), /SHOPIFY_HISTORY_ACCESS_REQUIRED/);
});
