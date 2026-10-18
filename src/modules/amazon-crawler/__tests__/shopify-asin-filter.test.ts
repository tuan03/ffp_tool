import assert from "node:assert/strict";
import test from "node:test";

import { createShopifyAsinFilter } from "../service";
import { getShopifyAsinFilter } from "../runtime";
import { replaceCrawlerInputWithAsin, parseAsinFilterInput } from "../ui/asin-filter-input";

const existingAsin = "B0EXIST001";
const missingAsin = "B0MISSING1";

test("combined filter finds prior batches in the server pipeline and never reserves unknown siblings", async () => {
  let active = true;
  const requests: string[] = [];
  const filter = createShopifyAsinFilter(async (url, init) => {
    requests.push(String(url));
    if (url === "/api/shopify") return pageResponse();
    assert.equal(url, "http://coordinator/api/v1/asin-families/activity");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.storeId, "new-store");
    return Response.json({ storeId: body.storeId, entries: body.asins.map((asin: string) => ({
      asin, parentAsin: "B0PARENT01", status: active && asin === missingAsin ? "processing" : "available",
    })) });
  }, { engineUrl: "http://coordinator/" });
  const first = await filter({ storeId: "new-store", asins: [existingAsin, missingAsin, "B0CHILD002"] });
  assert.deepEqual(first.activity?.map((entry) => [entry.asin, entry.status]), [[missingAsin, "processing"], ["B0CHILD002", "available"]]);
  assert.equal(first.matches.length, 1);
  active = false;
  assert.ok(filter.loadActivity);
  requests.length = 0;
  const refreshed = await filter.loadActivity({ storeId: "new-store", asins: [missingAsin] });
  assert.equal(refreshed[0]?.status, "available");
  assert.deepEqual(requests, ["http://coordinator/api/v1/asin-families/activity"], "polling must not scan Shopify");
});

test("combined filter fails closed for incomplete, wrong-store or failed activity checks", async () => {
  for (const response of [
    { storeId: "wrong", entries: [] },
    { storeId: "new-store", entries: [] },
    { storeId: "new-store", entries: [{ asin: missingAsin, parentAsin: missingAsin, status: "unknown" }] },
  ]) {
    const filter = createShopifyAsinFilter(async (url) => url === "/api/shopify" ? pageResponse() : Response.json(response), { engineUrl: "" });
    await assert.rejects(filter({ storeId: "new-store", asins: [missingAsin] }), /Chưa xác minh/);
  }
});

test("activity checks batch 5000 inputs without dropping entries and support abort", async () => {
  const sizes: number[] = [];
  const filter = createShopifyAsinFilter(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    sizes.push(body.asins.length);
    return Response.json({ storeId: body.storeId, entries: body.asins.map((asin: string) => ({ asin, parentAsin: asin, status: "available" })) });
  }, { engineUrl: "" });
  assert.ok(filter.loadActivity);
  const asins = Array.from({ length: 5000 }, (_, index) => `B${String(index).padStart(9, "0")}`);
  assert.equal((await filter.loadActivity({ storeId: "sample", asins })).length, 5000);
  assert.deepEqual(sizes, Array.from({ length: 25 }, () => 200));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(filter.loadActivity({ storeId: "sample", asins, signal: controller.signal }), { name: "AbortError" });
});

test("selecting a filtered ASIN replaces the entire crawler draft with exactly that ASIN", () => {
  assert.equal(replaceCrawlerInputWithAsin("", "b0missing1"), missingAsin);
  assert.equal(replaceCrawlerInputWithAsin("B0EXIST001\nunfinished input", missingAsin), missingAsin);
  const existingUrl = "https://www.amazon.com/dp/B0MISSING1?ref=test";
  assert.equal(replaceCrawlerInputWithAsin(existingUrl, missingAsin), missingAsin);
  assert.equal(replaceCrawlerInputWithAsin("b0missing1", missingAsin), missingAsin);
  assert.equal(replaceCrawlerInputWithAsin(missingAsin, "B0EXIST001"), existingAsin);
  assert.equal(replaceCrawlerInputWithAsin(existingUrl, "invalid"), existingUrl);
});
function pageResponse({ hasNextPage = false, cursor = null, value = existingAsin, status = "ACTIVE" }: {
  hasNextPage?: boolean; cursor?: string | null; value?: string | null; status?: string;
} = {}): Response {
  return new Response(JSON.stringify({ success: true, storeId: "new-store", data: {
    shopDomain: "new-store.myshopify.com", namespace: "custom", key: "amazon_asin",
    products: [{ id: "gid://shopify/Product/123", title: "Existing product", status, value }],
    pageInfo: { hasNextPage, endCursor: cursor },
  } }));
}

test("ASIN filter normalizes URLs and separators, reports invalid entries, and preserves unique input order", () => {
  const parsed = parseAsinFilterInput("b0exist001, https://www.amazon.com/dp/B0MISSING1?ref=test\nB0EXIST001;bad\nhttps://example.com/dp/B0EXIST001");
  assert.deepEqual(parsed.asins, [existingAsin, missingAsin]);
  assert.equal(parsed.duplicateCount, 1);
  assert.deepEqual(parsed.invalidEntries.map((entry) => entry.value), ["bad", "https://example.com/dp/B0EXIST001"]);
});

test("Shopify ASIN filter reads every page and classifies exact ASINs without family or registry requests", async () => {
  const requests: unknown[] = [];
  const progress: number[] = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/shopify");
    assert.equal(init?.cache, "no-store");
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    assert.equal(body.storeId, "new-store");
    assert.equal(body.operation, "products.metafieldPage");
    assert.equal(body.mode, undefined);
    assert.equal(body.requestId, undefined);
    assert.equal(body.payload.namespace, "custom");
    assert.equal(body.payload.key, "amazon_asin");
    if (requests.length === 1) return pageResponse({ hasNextPage: true, cursor: "second", value: "B0UNRELATED", status: "ARCHIVED" });
    assert.equal(body.payload.after, "second");
    return pageResponse({ status: "DRAFT" });
  };
  const filter = createShopifyAsinFilter(fetchImplementation);
  const result = await filter({ storeId: "new-store", asins: [existingAsin, missingAsin, existingAsin], onProgress: (update) => progress.push(update.scannedProducts) });
  assert.equal(requests.length, 2);
  assert.deepEqual(result.missingAsins, [missingAsin]);
  assert.equal(result.matches[0]?.asin, existingAsin);
  assert.equal(result.matches[0]?.status, "DRAFT");
  assert.equal(result.matches[0]?.adminUrl, "https://new-store.myshopify.com/admin/products/123");
  assert.deepEqual(progress, [1, 2]);
});

test("ASIN filter never returns missing classifications if a later Shopify page fails", async () => {
  let requests = 0;
  const filter = createShopifyAsinFilter(async () => ++requests === 1 ? pageResponse({ hasNextPage: true, cursor: "second" }) : new Response("Forbidden", { status: 403 }));
  await assert.rejects(filter({ storeId: "new-store", asins: [existingAsin, missingAsin] }), /Chưa xác minh/);
});

test("ASIN filter rejects stale stores, malformed values, non-advancing cursors, and missing page contracts", async () => {
  for (const patch of [{ storeId: "other-store" }, { data: {} }, { data: { namespace: "wrong", key: "amazon_asin" } }]) {
    const body = await pageResponse().json();
    const filter = createShopifyAsinFilter(async () => new Response(JSON.stringify({ ...body, ...patch })));
    await assert.rejects(filter({ storeId: "new-store", asins: [missingAsin] }));
  }
  const filter = createShopifyAsinFilter(async () => pageResponse({ hasNextPage: true, cursor: "same" }));
  await assert.rejects(filter({ storeId: "new-store", asins: [missingAsin] }), /phân trang/);
});

test("ASIN filter validates store and input and respects cancellation without issuing requests", async () => {
  const filter = createShopifyAsinFilter(async () => { throw new Error("Must not fetch"); });
  await assert.rejects(filter({ storeId: "", asins: [existingAsin] }));
  await assert.rejects(filter({ storeId: "new-store", asins: ["bad"] }));
  await assert.rejects(filter({ storeId: "new-store", asins: [] }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(filter({ storeId: "new-store", asins: [existingAsin], signal: controller.signal }), { name: "AbortError" });
});

test("mock ASIN filter is deterministic, respects cancellation, and returns fresh result arrays", async () => {
  const filter = getShopifyAsinFilter("mock");
  const first = await filter({ storeId: "new-store", asins: ["B0MOCK1001", missingAsin] });
  const second = await filter({ storeId: "new-store", asins: ["B0MOCK1001", missingAsin] });
  assert.deepEqual(first, second);
  assert.notEqual(first.missingAsins, second.missingAsins);
  assert.deepEqual(first.missingAsins, [missingAsin]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(filter({ storeId: "new-store", asins: [missingAsin], signal: controller.signal }), { name: "AbortError" });
});

test("filter includes draft and archived exact values but never matches substrings or parent ASINs", async () => {
  for (const status of ["ACTIVE", "DRAFT", "ARCHIVED"]) {
    const filter = createShopifyAsinFilter(async () => pageResponse({ value: ` ${existingAsin.toLowerCase()} `, status }));
    assert.deepEqual((await filter({ storeId: "new-store", asins: [existingAsin, missingAsin] })).missingAsins, [missingAsin]);
  }
  const filter = createShopifyAsinFilter(async () => pageResponse({ value: `${existingAsin},${missingAsin}` }));
  assert.deepEqual((await filter({ storeId: "new-store", asins: [existingAsin, missingAsin] })).missingAsins, [existingAsin, missingAsin]);
});

test("filter rechecks Shopify on every run so deleted products do not remain cached as existing", async () => {
  let reads = 0;
  const filter = createShopifyAsinFilter(async () => ++reads === 1 ? pageResponse() : pageResponse({ value: null }));
  assert.deepEqual((await filter({ storeId: "new-store", asins: [existingAsin] })).missingAsins, []);
  assert.deepEqual((await filter({ storeId: "new-store", asins: [existingAsin] })).missingAsins, [existingAsin]);
});

test("filter stops after cancellation during progress and does not return partial missing ASINs", async () => {
  const controller = new AbortController();
  let reads = 0;
  const filter = createShopifyAsinFilter(async () => { reads++; return pageResponse({ hasNextPage: true, cursor: "second" }); });
  await assert.rejects(filter({ storeId: "new-store", asins: [existingAsin, missingAsin], signal: controller.signal, onProgress: () => controller.abort() }), { name: "AbortError" });
  assert.equal(reads, 1);
});

test("filter rejects incomplete product fields and classifies an empty store only after a complete page", async () => {
  const body = await pageResponse().json();
  body.data.products[0].value = 123;
  const invalid = createShopifyAsinFilter(async () => new Response(JSON.stringify(body)));
  await assert.rejects(invalid({ storeId: "new-store", asins: [missingAsin] }));
  body.data.products = [];
  const empty = createShopifyAsinFilter(async () => new Response(JSON.stringify(body)));
  assert.deepEqual((await empty({ storeId: "new-store", asins: [existingAsin, missingAsin] })).missingAsins, [existingAsin, missingAsin]);
});
