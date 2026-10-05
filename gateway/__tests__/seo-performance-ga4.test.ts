import assert from "node:assert/strict";
import test from "node:test";

import { Ga4DataClient, assertGa4PropertyId, createGa4PanelContract, resolveGa4ItemMapping } from "../seo-performance/ga4-client";
import type { Ga4ItemMappingEvidence, Ga4RunReportRequest } from "../seo-performance/ga4-contracts";

const input = {
  propertyId: "123456789",
  hostnameScope: "Store.Example.com.",
  streamId: "987654321",
  startDate: "2026-09-01",
  endDate: "2026-09-28",
} as const;

const dimensions = ["date", "landingPage", "eventName", "itemId", "sessionSource", "sessionMedium", "hostName", "streamId"];
const metrics = ["sessions", "totalUsers", "engagedSessions", "eventCount", "purchaseRevenue", "itemsViewed", "itemsAddedToCart", "itemsCheckedOut", "itemsPurchased", "itemRevenue"];

function reportRequest(init?: RequestInit): Ga4RunReportRequest {
  return JSON.parse(String(init?.body)) as unknown as Ga4RunReportRequest;
}

function availableMetadata(): object {
  return {
    dimensions: dimensions.map(apiName => ({ apiName, uiName: apiName, description: `${apiName} description` })),
    metrics: metrics.map(apiName => ({ apiName, uiName: apiName, description: `${apiName} description` })),
  };
}

function compatible(body: Ga4RunReportRequest): object {
  return {
    dimensionCompatibilities: body.dimensions.map(dimension => ({ dimensionMetadata: { apiName: dimension.name }, compatibility: "COMPATIBLE" })),
    metricCompatibilities: body.metrics.map(metric => ({ metricMetadata: { apiName: metric.name }, compatibility: "COMPATIBLE" })),
  };
}

function page(body: Ga4RunReportRequest): object {
  const offset = Number(body.offset);
  const rows = offset === 0 ? [{
    dimensionValues: [{ value: "20260901" }, { value: "/products/blanket" }],
    metricValues: [{ value: "10" }, { value: "8" }, { value: "6" }],
  }, {
    dimensionValues: [{ value: "20260902" }, { value: "/products/blanket" }],
    metricValues: [{ value: "12" }, { value: "9" }, { value: "7" }],
  }] : [{
    dimensionValues: [{ value: "20260903" }, { value: "(other)" }],
    metricValues: [{ value: "4" }, { value: "4" }, { value: "2" }],
  }];
  return {
    dimensionHeaders: body.dimensions.map(dimension => ({ name: dimension.name })),
    metricHeaders: body.metrics.map(metric => ({ name: metric.name })),
    rows,
    rowCount: 3,
    metadata: {
      timeZone: "Asia/Ho_Chi_Minh",
      currencyCode: "USD",
      subjectToThresholding: offset === 0,
      samplingMetadatas: offset === 0 ? [{ samplesReadCount: "80", samplingSpaceSize: "100" }] : [],
      dataLossFromOtherRow: offset > 0,
    },
    propertyQuota: { tokensPerDay: { remaining: offset === 0 ? 999 : 998 } },
  };
}

function createFetcher(requests: Array<{ readonly url: string; readonly init?: RequestInit }>): typeof fetch {
  return async (url, init) => {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, init });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-token");
    if (requestUrl.endsWith("/metadata")) return new Response(JSON.stringify(availableMetadata()));
    const body = reportRequest(init);
    if (requestUrl.endsWith(":checkCompatibility")) return new Response(JSON.stringify(compatible(body)));
    return new Response(JSON.stringify(page(body)));
  };
}

test("GA4 panel contracts keep organic acquisition, stable dimensions and panel semantics separate", () => {
  const landing = createGa4PanelContract("landing_engagement", input);
  const events = createGa4PanelContract("event_activity", input);
  const revenue = createGa4PanelContract("landing_revenue", input);
  const items = createGa4PanelContract("item_performance", input);

  assert.deepEqual(landing.dimensions, ["date", "landingPage"]);
  assert.deepEqual(landing.metrics, ["sessions", "totalUsers", "engagedSessions"]);
  assert.deepEqual(revenue.metrics, ["purchaseRevenue"]);
  assert.deepEqual(items.metrics, ["itemsViewed", "itemsAddedToCart", "itemsCheckedOut", "itemsPurchased", "itemRevenue"]);
  assert.deepEqual(landing.request.orderBys.map(order => order.dimension.dimensionName), landing.dimensions);
  assert.deepEqual(landing.request.dimensionFilter.andGroup?.expressions.slice(0, 4), [
    { filter: { fieldName: "sessionSource", stringFilter: { matchType: "EXACT", value: "google", caseSensitive: false } } },
    { filter: { fieldName: "sessionMedium", stringFilter: { matchType: "EXACT", value: "organic", caseSensitive: false } } },
    { filter: { fieldName: "hostName", stringFilter: { matchType: "EXACT", value: "store.example.com", caseSensitive: false } } },
    { filter: { fieldName: "streamId", stringFilter: { matchType: "EXACT", value: "987654321", caseSensitive: false } } },
  ]);
  assert.deepEqual(events.request.dimensionFilter.andGroup?.expressions.at(-1), {
    filter: { fieldName: "eventName", inListFilter: { values: ["view_item", "add_to_cart", "begin_checkout", "purchase"], caseSensitive: true } },
  });
  assert.notDeepEqual(events.request.metrics, items.request.metrics);
});

test("GA4 validates numeric property IDs before transport", async () => {
  assert.equal(assertGa4PropertyId(" 123456789 "), "123456789");
  assert.throws(() => assertGa4PropertyId("properties/123"), /GA4_PROPERTY_ID_INVALID/);
  assert.throws(() => assertGa4PropertyId("0"), /GA4_PROPERTY_ID_INVALID/);
  let calls = 0;
  const client = new Ga4DataClient(async () => "token", async () => { calls += 1; return new Response("{}"); });
  await assert.rejects(client.getMetadata("not-numeric"), /GA4_PROPERTY_ID_INVALID/);
  assert.equal(calls, 0);
});

test("GA4 reads metadata, checks compatibility and paginates by returned row count", async () => {
  const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const client = new Ga4DataClient(async () => "access-token", createFetcher(requests));
  const result = await client.landingEngagement({ ...input, pageSize: 2 });

  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0], {
    dimensions: { date: "20260901", landingPage: "/products/blanket" },
    metrics: { sessions: "10", totalUsers: "8", engagedSessions: "6" },
  });
  assert.deepEqual(requests.filter(request => request.url.endsWith(":runReport")).map(request => reportRequest(request.init).offset), ["0", "2"]);
  assert.deepEqual(result.quality.flags, ["THRESHOLDING", "SAMPLING", "OTHER_ROW", "DATA_LOSS"]);
  assert.equal(result.quality.timeZone, "Asia/Ho_Chi_Minh");
  assert.equal(result.quality.currencyCode, "USD");
  assert.deepEqual(result.quality.propertyQuota, { tokensPerDay: { remaining: 998 } });
  assert.equal(result.quality.providerRowCount, 3);
  assert.equal(result.quality.fetchedRowCount, 3);
  assert.match(result.semantics, /non-additive/);
});

test("GA4 exposes truncation instead of presenting a bounded result as complete", async () => {
  const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const client = new Ga4DataClient(async () => "access-token", createFetcher(requests));
  const result = await client.landingEngagement({ ...input, pageSize: 2, maxRows: 2 });

  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.rows.length, 2);
  assert.equal(result.quality.truncated, true);
  assert.ok(result.quality.flags.includes("TRUNCATED"));
  assert.equal(requests.filter(request => request.url.endsWith(":runReport")).length, 1);
});

test("GA4 returns explicit unsupported for a GSC query filter without calling Google", async () => {
  let calls = 0;
  const client = new Ga4DataClient(async () => "access-token", async () => { calls += 1; return new Response("{}"); });
  const result = await client.landingRevenue({ ...input, queryFilter: "blanket keyword" });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "GSC_QUERY_FILTER_UNSUPPORTED",
    message: "GSC query filter is not supported by this GA4 report",
  });
  assert.equal(calls, 0);
});

test("GA4 exposes incompatible fields and does not silently drop the report filter", async () => {
  let runCalls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/metadata")) return new Response(JSON.stringify(availableMetadata()));
    if (requestUrl.endsWith(":checkCompatibility")) {
      const body = reportRequest(init);
      return new Response(JSON.stringify({
        dimensionCompatibilities: body.dimensions.map(dimension => ({ dimensionMetadata: { apiName: dimension.name }, compatibility: "COMPATIBLE" })),
        metricCompatibilities: body.metrics.map(metric => ({ metricMetadata: { apiName: metric.name }, compatibility: metric.name === "itemRevenue" ? "INCOMPATIBLE_METRIC" : "COMPATIBLE" })),
      }));
    }
    runCalls += 1;
    return new Response("{}");
  };
  const client = new Ga4DataClient(async () => "access-token", fetcher);
  const result = await client.itemPerformance(input);

  assert.deepEqual(result, { status: "unavailable", reason: "GA4_REPORT_INCOMPATIBLE", fields: ["itemRevenue"] });
  assert.equal(runCalls, 0);
});

test("GA4 item mapping requires temporal evidence and rejects ambiguous item IDs", () => {
  const evidence: readonly Ga4ItemMappingEvidence[] = [{
    evidenceId: "feed-1", itemId: "SKU-1", productId: "gid://shopify/Product/1", source: "merchant_feed",
    observedAt: "2026-09-01T00:00:00Z", validFrom: "2026-09-01T00:00:00Z", validTo: null,
  }, {
    evidenceId: "variant-1", itemId: "SKU-1", productId: "gid://shopify/Product/1", source: "shopify_variant",
    observedAt: "2026-09-02T00:00:00Z", validFrom: "2026-09-01T00:00:00Z", validTo: null,
  }];
  assert.deepEqual(resolveGa4ItemMapping("SKU-1", "2026-09-10T00:00:00Z", evidence), {
    status: "mapped", productId: "gid://shopify/Product/1", evidence,
  });

  const ambiguous = [...evidence, {
    evidenceId: "manual-2", itemId: "SKU-1", productId: "gid://shopify/Product/2", source: "manual_verified" as const,
    observedAt: "2026-09-03T00:00:00Z", validFrom: "2026-09-03T00:00:00Z", validTo: null,
  }];
  assert.deepEqual(resolveGa4ItemMapping("SKU-1", "2026-09-10T00:00:00Z", ambiguous), {
    status: "unavailable", reason: "ITEM_MAPPING_AMBIGUOUS",
    candidateProductIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
  });
  assert.deepEqual(resolveGa4ItemMapping("gid://shopify/Product/1", "2026-09-10T00:00:00Z", evidence), {
    status: "unavailable", reason: "ITEM_MAPPING_NOT_FOUND", candidateProductIds: [],
  });
});
