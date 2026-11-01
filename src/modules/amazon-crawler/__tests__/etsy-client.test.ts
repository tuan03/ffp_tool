import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCrawlerInput } from "../ui/crawler-input";
import { createEtsyCrawlerClient } from "../service";

test("Etsy input normalizes localized listing URLs and IDs without accepting other hosts", () => {
  const analysis = analyzeCrawlerInput("https://www.etsy.com/fr/listing/1876543210/title\n1876543210\nhttps://evil.test/listing/1999888777", "etsy");
  assert.equal(analysis.validCount, 1);
  assert.equal(analysis.duplicateCount, 1);
  assert.equal(analysis.invalidEntries.length, 1);
});

test("Etsy preflight requires complete results and sends coordinator metadata without credentials to Shopify", async () => {
  const calls: string[] = [];
  const client = createEtsyCrawlerClient({
    engineUrl: "http://localhost:8766",
    fetchImplementation: async (input) => {
      calls.push(String(input));
      return Response.json({ listings: [{ listingId: "1876543210", status: "queue_cleared" }] });
    },
    shopifyFetch: async (input, init) => {
      assert.equal(String(input), "/api/shopify");
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      const request = JSON.parse(String(init?.body));
      assert.equal(request.payload.listings[0].status, "queue_cleared");
      return Response.json({ success: true, data: { ready: true, matches: [], listings: [], allowedListingIds: [] } });
    },
  });
  await assert.rejects(client.check("test", ["1876543210"]), /không đầy đủ/);
  assert.deepEqual(calls, ["http://localhost:8766/api/v1/etsy-listings/resolve"]);
});

test("Etsy preflight preserves queue-cleared and existing results", async () => {
  const listings = [{ listingId: "1876543210", status: "queue_cleared" }, { listingId: "1999888777", status: "existing" }];
  const client = createEtsyCrawlerClient({ engineUrl: "", fetchImplementation: async () => Response.json({ listings }),
    shopifyFetch: async () => Response.json({ success: true, data: { ready: true, listings,
      matches: [{ listingId: "1999888777", productId: "gid://shopify/Product/1", title: "Example", adminUrl: "https://shop.myshopify.com/admin/products/1" }],
      allowedListingIds: ["1876543210"] } }),
  });
  const result = await client.check("test", listings.map(listing => listing.listingId));
  assert.deepEqual(result.allowedListingIds, ["1876543210"]);
  assert.equal(result.matches.length, 1);
});
