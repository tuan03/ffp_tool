import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewResultContent, ReviewSourceComparison } from "../components/ReviewResultContent";
import { ReviewResultStatus } from "../components/ReviewResultStatus";
import { ReviewStatusBadge } from "../components/ReviewStatusBadge";
import { SourceOriginBadge } from "../components/SourceOriginBadge";
import { getInitialSampleViewModels } from "../seo-content-ui-adapter";

function createProduct() {
  const sample = getInitialSampleViewModels()[0];
  assert.ok(sample);
  return { ...sample, updatedAt: 1_700_000_000_000, storeId: "saved-destination", sourceOrigin: "auto_seo" as const,
    shopifySyncStatus: "synced" as const, reviewDecision: "approved" as const,
    productDescription: { value: '<h2>Music room</h2><p>Record rug.</p><script>unsafe()</script>', source: "real" as const },
    originalBackup: { productTitle: "Saved original title", productDescription: "<p>Saved original description</p>", handle: "original-handle" } };
}

test("result reader opens on sanitized SEO content, not approval or image tools", () => {
  const product = createProduct();
  const html = renderToStaticMarkup(createElement(ReviewResultContent, { product }));
  assert.match(html, /Nội dung SEO/);
  assert.match(html, /Ảnh &amp; Alt/);
  assert.match(html, /Nguồn &amp; kết quả/);
  assert.match(html, /Mô tả sản phẩm/);
  assert.match(html, /<h2>Music room<\/h2>/);
  assert.doesNotMatch(html, /unsafe\(\)|<script|Cần duyệt|Sync Shopify/);
});

test("source comparison names the saved baseline honestly and preserves missing fields", () => {
  const html = renderToStaticMarkup(createElement(ReviewSourceComparison, { product: createProduct() }));
  assert.match(html, /Bản nguồn đã lưu/);
  assert.match(html, /Kết quả SEO/);
  assert.match(html, /Saved original title/);
  assert.match(html, /original-handle/);
  assert.match(html, /Không có trong bản nguồn/);
  assert.doesNotMatch(html, /Shopify hiện tại|Bản đề xuất|dangerouslySetInnerHTML/);
});

test("source comparison does not invent a baseline for products without backup", () => {
  const html = renderToStaticMarkup(createElement(ReviewSourceComparison, { product: { ...createProduct(), originalBackup: undefined } }));
  assert.match(html, /Chưa có bản nguồn đã lưu/);
  assert.doesNotMatch(html, /<table/);
});

test("catalog summaries are never presented as empty completed SEO content", () => {
  const product = createProduct();
  const html = renderToStaticMarkup(createElement(ReviewResultContent, { product: { ...product,
    reviewListItem: { id: product.id, recordId: "summary", storeId: "saved-destination", source: "auto_seo",
      title: product.productTitle.value, handle: "summary", thumbnailUrl: "", decision: "approved", syncStatus: "synced", updatedAt: 100 } } }));
  assert.match(html, /Đang tải nội dung SEO/);
  assert.doesNotMatch(html, /<h2>Music room|Chưa có mô tả/);
});

test("Auto SEO source badge does not request approval or imply changing the destination", () => {
  const html = renderToStaticMarkup(createElement(SourceOriginBadge, { product: createProduct(), showStore: true, targetStoreId: "viewing-store" }));
  assert.match(html, /Auto SEO/);
  assert.match(html, /saved-destination/);
  assert.doesNotMatch(html, /Cần duyệt|phê duyệt|➔ viewing-store|Store đích khi sync/);
});

test("a successful backend receipt is synced history even before the legacy status refreshes", () => {
  const html = renderToStaticMarkup(createElement(ReviewStatusBadge, { product: { ...createProduct(), shopifySyncStatus: "idle",
    backendPublish: { id: "publish", jobId: "job", state: "SUCCEEDED", errorCode: null, seoVersion: 2 } } }));
  assert.match(html, /Đã sync Shopify/);
  assert.doesNotMatch(html, /Đã bỏ qua/);
});

test("legacy browser sync does not promise that closing the tab is safe", () => {
  const html = renderToStaticMarkup(createElement(ReviewResultStatus, { product: { ...createProduct(), shopifySyncStatus: "syncing" } }));
  assert.doesNotMatch(html, /Không cần giữ tab/);
  assert.match(html, /đợi tác vụ hoàn tất/);
});
