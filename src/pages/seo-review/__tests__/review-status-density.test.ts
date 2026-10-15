import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductSplitView } from "../components/ProductSplitView";
import { getInitialSampleViewModels } from "../seo-content-ui-adapter";

test("review inspector keeps the publish destination without duplicate completed or sync badges", () => {
  const sample = getInitialSampleViewModels()[0];
  assert.ok(sample);
  const product = { ...sample, storeId: "destination-store", shopifySyncStatus: "synced" as const, lastSyncedAt: 100,
    reviewDecision: "approved" as const, seoStatus: { ...sample.seoStatus, value: "completed" as const } };
  const html = renderToStaticMarkup(createElement(ProductSplitView, {
    products: [product], selectedIds: new Set<string>(), activeProduct: product, currentStoreId: "viewing-store",
    onSelectActive: () => {}, onToggleSelect: () => {}, onViewProduct: () => {}, onEditProduct: () => {},
    onApproveProduct: () => {}, onRejectProduct: () => {}, onApproveAndNext: () => {}, onRejectAndNext: () => {},
  }));
  assert.doesNotMatch(html, />Completed|✓ Synced|Đã đẩy \(/);
  assert.match(html, /Đích: destination-store/);
  assert.match(html, /Đã sync Shopify/);
});
