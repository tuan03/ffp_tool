import assert from "node:assert/strict";
import test from "node:test";

import { loadAutoSeoReviews, updateAutoSeoReviewStatus } from "../auto-seo-review-client";

test("Auto SEO review reload hydrates rollback backup with empty browser session", async () => {
  const originalFetch = globalThis.fetch;
  const productId = "gid://shopify/Product/8484620664917";
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (init?.method === "POST") return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(JSON.stringify({ success: true, total: 1, items: [{
      itemId: `store-1:${productId}`, storeId: "store-1", productId,
      reviewStatus: "approved", generatedPayload: JSON.stringify({
        productTitle: "Generated", productDescription: "Generated body", productSeoTitle: "New SEO",
        productSeoDescription: "New SEO description", productHandle: "generated-handle",
      }), shopifyUpdatedAt: null, notes: null, updatedAt: "2026-09-30T00:00:00Z",
      backupId: "exact-backup-1", sourceOrigin: "auto_seo",
      originalBackup: { productTitle: "Original", productDescription: "<p>Before</p>", handle: "original-handle", seoTitle: "Old SEO", seoDescription: "Old description" },
    }] }), { status: 200 });
  };
  try {
    const products = await loadAutoSeoReviews("store-1");
    assert.equal(products.length, 1);
    assert.equal(products[0]?.reviewDecision, "approved");
    assert.equal(products[0]?.originalBackup?.productDescription, "<p>Before</p>");
    assert.equal(products[0]?.originalBackup?.seoTitle, "Old SEO");
    assert.equal(products[0]?.sourceOrigin, "auto_seo");
    assert.equal(products[0]?.productId, productId);
    if (products[0]) await updateAutoSeoReviewStatus(products[0], "rejected", "Needs revision");
    assert.match(calls[0] ?? "", /source=auto_seo/);
    assert.match(calls[1] ?? "", /store-1%3Agid%3A%2F%2Fshopify%2FProduct%2F8484620664917\/status\?source=auto_seo/);
  } finally { globalThis.fetch = originalFetch; }
});
