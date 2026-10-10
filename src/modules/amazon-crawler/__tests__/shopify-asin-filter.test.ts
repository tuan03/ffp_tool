import assert from "node:assert/strict";
import test from "node:test";

import { createShopifyAsinFilter } from "../service";
import { getShopifyAsinFilter } from "../runtime";
import { parseAsinFilterInput } from "../ui/asin-filter-input";

const existingAsin = "B0EXIST001";
const missingAsin = "B0MISSING1";
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
