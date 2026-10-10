import assert from "node:assert/strict";
import test from "node:test";

import { mergeReviewCatalogPages, adaptReviewListItem } from "../review-catalog";
import type { SeoReviewListItem } from "../../../shared/seo-review-list";
import { readSeoReviewListPage } from "../../../shared/seo-review-list";

function summary(source: SeoReviewListItem["source"], index: number): SeoReviewListItem {
  return { id: `${source}-${index}`, recordId: String(index), source, storeId: "demo", title: `Product ${index}`, handle: "test", thumbnailUrl: "", decision: "pending", syncStatus: "idle", updatedAt: 100 - index };
}

test("catalog merges only 50 rows and advances each source by consumed rows without losing siblings", () => {
  const pages = { gpt: { items: Array.from({ length: 50 }, (_, i) => summary("gpt", i * 2)), total: 80, nextOffset: 50 },
    crawler: { items: Array.from({ length: 50 }, (_, i) => summary("crawler", i * 2 + 1)), total: 90, nextOffset: 50 } };
  const merged = mergeReviewCatalogPages(pages, { gpt: 0, crawler: 0, auto_seo: 0 });
  assert.equal(merged.items.length, 50);
  assert.equal(merged.total, 170);
  assert.deepEqual(merged.nextOffsets, { gpt: 25, crawler: 25, auto_seo: 0 });
  assert.equal(merged.hasNextPage, true);
});

test("light Review rows explicitly require detail hydration and never carry fabricated SEO or backup", () => {
  const product = adaptReviewListItem(summary("gpt", 1));
  assert.equal(product.reviewListItem?.source, "gpt");
  assert.equal(product.productDescription.value, "");
  assert.equal(product.originalBackup, undefined);
  assert.equal(product.gptJobId, "1");
  assert.equal(product.storeId, "demo");
});

test("catalog rejects cross-store rows, unexpected statuses and excessive pages", () => {
  const page = { items: [summary("gpt", 1)], total: 1, nextOffset: null };
  assert.equal(readSeoReviewListPage(page, "demo").items.length, 1);
  assert.throws(() => readSeoReviewListPage(page, "other"), /Invalid/);
  assert.throws(() => readSeoReviewListPage({ ...page, items: [{ ...page.items[0], syncStatus: "UNKNOWN" }] }, "demo"), /Invalid/);
  assert.throws(() => readSeoReviewListPage({ ...page, items: Array.from({ length: 51 }, () => page.items[0]) }, "demo"), /Invalid/);
});
