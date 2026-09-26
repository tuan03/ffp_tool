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

test("preflight rejects unrelated or malformed links before creating a crawler job", () => {
  assert.throws(() => normalizeAmazonAsins(["https://example.com/dp/B012345678"]));
  assert.throws(() => normalizeAmazonAsins(["https://amazon.com/not-a-product/foo"]));
});

test("preflight blocks the entire job when any pasted ASIN exists", async () => {
  let started = 0;
  const result = await runAfterAmazonAsinPreflight(
    ["b012345678", "B098765432"], "capozen",
    async (storeId, asins) => {
      assert.equal(storeId, "capozen");
      assert.deepEqual(asins, ["B012345678", "B098765432"]);
      return { ready: true, matches: [{ asin: "B012345678", productId: "1", title: "Existing", adminUrl: "https://example.com" }] };
    },
    async () => { started++; },
  );
  assert.equal(result.matches.length, 1);
  assert.equal(started, 0);
});

test("preflight reports every duplicate ASIN and does not start the batch", async () => {
  let started = 0;
  const matches = [
    { asin: "B012345678", productId: "1", title: "First", adminUrl: "https://example.com/1" },
    { asin: "B098765432", productId: "2", title: "Second", adminUrl: "https://example.com/2" },
  ];
  const result = await runAfterAmazonAsinPreflight(
    ["B012345678", "B098765432"], "capozen",
    async () => ({ ready: true, matches }),
    async () => { started++; },
  );
  assert.deepEqual(result.matches, matches);
  assert.equal(started, 0);
});

test("preflight starts only after a ready and duplicate-free Shopify response", async () => {
  let started = 0;
  const start = async (): Promise<void> => { started++; };
  await runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => ({ ready: false, matches: [] }), start);
  assert.equal(started, 0);
  await assert.rejects(runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => {
    throw new Error("Shopify unavailable");
  }, start));
  assert.equal(started, 0);
  await runAfterAmazonAsinPreflight(["B012345678"], "capozen", async () => ({ ready: true, matches: [] }), start);
  assert.equal(started, 1);
});
