import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAmazonAsins, runAfterAmazonAsinPreflight } from "../ui/amazon-asin-preflight";

test("preflight normalizes pasted ASINs and Amazon URLs, preserving distinct order", () => {
  assert.deepEqual(normalizeAmazonAsins([
    "b012345678",
    "https://www.amazon.com/dp/B012345678?th=1",
    "https://amazon.co.uk/gp/product/b098765432/ref=foo",
  ]), ["B012345678", "B098765432"]);
});

test("preflight starts at most one source for each allowed ASIN", async () => {
  let startedSources: readonly string[] = [];
  await runAfterAmazonAsinPreflight(
    ["B012345678", "https://www.amazon.com/dp/B012345678?th=1"], "capozen",
    async () => ({
      ready: true, matches: [], allowedAsins: ["B012345678"], families: [{
        parentAsin: "B012345678", inputAsins: ["B012345678"], memberAsins: ["B012345678"],
        isResolved: false, databaseStatus: null, jobId: null, status: "available",
      }],
    }),
    async (sources) => { startedSources = sources; },
  );
  assert.deepEqual(startedSources, ["B012345678"]);
});

test("preflight rejects unrelated or malformed links before creating a crawler job", () => {
  assert.throws(() => normalizeAmazonAsins(["https://example.com/dp/B012345678"]));
  assert.throws(() => normalizeAmazonAsins(["https://amazon.com/not-a-product/foo"]));
});

test("preflight skips an existing family and starts the remaining ASINs", async () => {
  let started = 0;
  let startedSources: readonly string[] = [];
  const result = await runAfterAmazonAsinPreflight(
    ["b012345678", "B098765432"], "capozen",
    async (storeId, asins) => {
      assert.equal(storeId, "capozen");
      assert.deepEqual(asins, ["B012345678", "B098765432"]);
      return {
        ready: true,
        matches: [{ asin: "B012345678", parentAsin: "B0PARENT01", productId: "1", title: "Existing", adminUrl: "https://example.com" }],
        families: [
          { parentAsin: "B0PARENT01", inputAsins: ["B012345678"], memberAsins: ["B012345678"], isResolved: true, databaseStatus: "synced", jobId: "job-1", status: "existing" },
          { parentAsin: "B098765432", inputAsins: ["B098765432"], memberAsins: ["B098765432"], isResolved: false, databaseStatus: null, jobId: null, status: "available" },
        ],
        allowedAsins: ["B098765432"],
      };
    },
    async (sources) => { started++; startedSources = sources; },
  );
  assert.equal(result.matches.length, 1);
  assert.equal(started, 1);
  assert.deepEqual(startedSources, ["B098765432"]);
});

test("preflight reports every duplicate ASIN and does not start the batch", async () => {
  let started = 0;
  const matches = [
    { asin: "B012345678", parentAsin: "B0PARENT01", productId: "1", title: "First", adminUrl: "https://example.com/1" },
    { asin: "B098765432", parentAsin: "B0PARENT02", productId: "2", title: "Second", adminUrl: "https://example.com/2" },
  ];
  const result = await runAfterAmazonAsinPreflight(
    ["B012345678", "B098765432"], "capozen",
    async () => ({
      ready: true, matches, allowedAsins: [], families: [
        { parentAsin: "B0PARENT01", inputAsins: ["B012345678"], memberAsins: ["B012345678"], isResolved: true, databaseStatus: "synced", jobId: "job-1", status: "existing" },
        { parentAsin: "B0PARENT02", inputAsins: ["B098765432"], memberAsins: ["B098765432"], isResolved: true, databaseStatus: "synced", jobId: "job-2", status: "existing" },
      ],
    }),
    async () => { started++; },
  );
  assert.deepEqual(result.matches, matches);
  assert.equal(started, 0);
});

test("preflight starts only after a ready and duplicate-free Shopify response", async () => {
  let started = 0;
  const start = async (): Promise<void> => { started++; };
  await runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => ({ ready: false, matches: [], families: [], allowedAsins: [] }), start);
  assert.equal(started, 0);
  await assert.rejects(runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => {
    throw new Error("Shopify unavailable");
  }, start));
  assert.equal(started, 0);
  await runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => ({
    ready: true, matches: [], allowedAsins: ["B012345678"], families: [{
      parentAsin: "B012345678", inputAsins: ["B012345678"], memberAsins: ["B012345678"],
      isResolved: false, databaseStatus: null, jobId: null, status: "available",
    }],
  }), start);
  assert.equal(started, 1);
});

test("preflight starts an unresolved exact Shopify match as a discovery seed", async () => {
  let startedSources: readonly string[] = [];
  let skippedShopifyAsins: readonly string[] = [];
  let refreshedFamilyAsins: readonly string[] = [];
  await runAfterAmazonAsinPreflight(
    ["B0PARENT01"], "capozen",
    async () => ({
      ready: true,
      matches: [{
        asin: "B0PARENT01", parentAsin: "B0PARENT01", productId: "gid://shopify/Product/1",
        title: "Existing seed", adminUrl: "https://example.com/1",
      }],
      families: [{
        parentAsin: "B0PARENT01", inputAsins: ["B0PARENT01"], memberAsins: ["B0PARENT01"],
        isResolved: false, databaseStatus: null, jobId: null, status: "available",
        hasExistingFamilyProducts: true,
      }],
      allowedAsins: ["B0PARENT01"],
    }),
    async (sources, existingShopifyAsins, refreshFamilyAsins) => {
      startedSources = sources;
      skippedShopifyAsins = existingShopifyAsins;
      refreshedFamilyAsins = refreshFamilyAsins;
    },
  );

  assert.deepEqual(startedSources, ["B0PARENT01"]);
  assert.deepEqual(skippedShopifyAsins, ["B0PARENT01"]);
  assert.deepEqual(refreshedFamilyAsins, ["B0PARENT01"]);
});

test("preflight refreshes an existing seed and skips every Shopify sibling in its family", async () => {
  let startedSources: readonly string[] = [];
  let skippedShopifyAsins: readonly string[] = [];
  let refreshedFamilyAsins: readonly string[] = [];
  await runAfterAmazonAsinPreflight(
    ["B0CHILD001"], "capozen",
    async () => ({
      ready: true,
      matches: [
        { asin: "B0CHILD001", parentAsin: "B0PARENT01", productId: "1", title: "One", adminUrl: "https://example.com/1" },
        { asin: "B0CHILD002", parentAsin: "B0PARENT01", productId: "2", title: "Two", adminUrl: "https://example.com/2" },
      ],
      families: [{
        parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001", "B0CHILD002"],
        isResolved: true, databaseStatus: "synced", jobId: "job-1", status: "available",
        hasExistingFamilyProducts: true,
      }],
      allowedAsins: ["B0CHILD001"],
    }),
    async (sources, existingShopifyAsins, refreshFamilyAsins) => {
      startedSources = sources;
      skippedShopifyAsins = existingShopifyAsins;
      refreshedFamilyAsins = refreshFamilyAsins;
    },
  );

  assert.deepEqual(startedSources, ["B0CHILD001"]);
  assert.deepEqual(skippedShopifyAsins, ["B0CHILD001", "B0CHILD002"]);
  assert.deepEqual(refreshedFamilyAsins, ["B0CHILD001"]);
});
