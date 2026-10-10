import assert from "node:assert/strict";
import test from "node:test";

import { archiveSeoReviewProduct } from "../archive-review-product";
import { adaptReviewListItem } from "../review-catalog";
import { getSeoReviewActions } from "../../../shared/seo-review-list";

test("archive routes lightweight reviews to their exact store without fetching full SEO or deleting Shopify", async () => {
  const calls: string[] = [];
  const gpt = { archiveReview: async (storeId: string, jobId: string) => { calls.push(`gpt:${storeId}:${jobId}`); return { archived: true }; } };
  const crawler = { archive: async (itemId: string, storeId: string) => { calls.push(`crawler:${storeId}:${itemId}`); return { archived: true }; } };
  for (const source of ["gpt", "crawler", "auto_seo"] as const) {
    const product = adaptReviewListItem({ id: source, recordId: "record", storeId: "store-a", source,
      title: "Published", handle: "", thumbnailUrl: "", decision: "approved", syncStatus: "synced", updatedAt: 1,
      actions: getSeoReviewActions({ decision: "approved", syncStatus: "synced", hasPublish: source === "gpt" }) });
    await archiveSeoReviewProduct(product, { gpt, crawler, fetcher: async (url, options) => {
      assert.equal(String(url), "/api/seo-review/items/record/archive?source=auto_seo");
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), { storeId: "store-a" });
      calls.push("legacy:store-a:record");
      return new Response(JSON.stringify({ archived: true }));
    } });
    assert.equal(product.shopifySyncStatus, "synced");
  }
  assert.deepEqual(calls, ["gpt:store-a:record", "crawler:store-a:record", "legacy:store-a:record"]);
});

test("archive refuses unresolved writes and does not claim success without server confirmation", async () => {
  const product = adaptReviewListItem({ id: "gpt-one", recordId: "one", storeId: "store-a", source: "gpt",
    title: "Review", handle: "", thumbnailUrl: "", decision: "approved", syncStatus: "syncing", updatedAt: 1 });
  await assert.rejects(archiveSeoReviewProduct(product, { gpt: { archiveReview: async () => assert.fail("must not send a busy archive") } }), /đang sync/);
  await assert.rejects(archiveSeoReviewProduct({ ...product, shopifySyncStatus: "synced" }, { gpt: { archiveReview: async () => ({ archived: false }) } }), /chưa xác nhận/);
});
