import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import { ProductCardList } from "../components/ProductCardList";
import { ProductDetailDrawer } from "../components/ProductDetailDrawer";
import { getSeoReviewActions } from "../../../shared/seo-review-list";

test("SEO Review cards show compact summaries and open details in the right drawer", () => {
  const product = getInitialSampleViewModels()[0];
  assert.ok(product);

  const html = renderToStaticMarkup(createElement(ProductCardList, {
    products: [product],
    selectedIds: new Set<string>(),
    onToggleSelect: () => undefined,
    onViewProduct: () => undefined,
    onEditProduct: () => undefined,
    onApproveProduct: () => undefined,
    onRejectProduct: () => undefined,
  }));

  assert.match(html, /Xem chi tiết sản phẩm/);
  assert.doesNotMatch(html, />Duyệt</);
  assert.doesNotMatch(html, /Google Snippet|Image Alt Texts|Product Description/);

  const drawerHtml = renderToStaticMarkup(createElement(ProductDetailDrawer, {
    product,
    isOpen: true,
    onClose: () => undefined,
    onEdit: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
  }));
  assert.match(drawerHtml, /SEO Title/);
  assert.match(drawerHtml, /Product Description/);
  assert.match(drawerHtml, /Image Alt/);
});

test("published history exposes view and archive but no approve, reject, edit, rollback or resync", () => {
  const sample = getInitialSampleViewModels()[0];
  assert.ok(sample);
  const product = { ...sample, reviewDecision: "approved" as const, shopifySyncStatus: "synced" as const,
    reviewActions: getSeoReviewActions({ decision: "approved", syncStatus: "synced", hasPublish: true }) };
  const html = renderToStaticMarkup(createElement(ProductCardList, { products: [product], selectedIds: new Set<string>(),
    onToggleSelect: () => undefined, onViewProduct: () => undefined, onEditProduct: () => undefined,
    onApproveProduct: () => undefined, onRejectProduct: () => undefined, onDeleteProduct: () => undefined, onRetrySync: () => undefined }));
  assert.match(html, /Lưu trữ/);
  assert.doesNotMatch(html, />Duyệt<|>Sửa<|Sync Shopify|Từ chối|Hoàn tác|Sync lại/);
  const drawer = renderToStaticMarkup(createElement(ProductDetailDrawer, { product, isOpen: true, onClose: () => undefined,
    onEdit: () => undefined, onApprove: () => undefined, onReject: () => undefined, onDelete: () => undefined, onRetrySync: () => undefined }));
  assert.match(drawer, /Lưu trữ/);
  assert.doesNotMatch(drawer, /Phê duyệt \(Approve\)|Từ chối|Sync lại|Hoàn tác dữ liệu cũ/);
});

test("partial publication shows a channel-only retry and preserves the Shopify link", () => {
  const sample = getInitialSampleViewModels()[0];
  assert.ok(sample);
  const product = { ...sample, reviewDecision: "approved" as const, shopifySyncStatus: "failed" as const,
    shopifySyncError: "SHOPIFY_PUBLICATION_INCOMPLETE: Đã sync dữ liệu, publish chưa đầy đủ.",
    shopifyAdminUrl: "https://admin.shopify.com/store/sample/products/1",
    salesChannelPublication: { status: "partial" as const, channels: [
      { id: "1", name: "Online Store", published: true }, { id: "2", name: "POS", published: false },
    ] },
    reviewActions: getSeoReviewActions({ decision: "approved", syncStatus: "failed" }) };
  const html = renderToStaticMarkup(createElement(ProductCardList, { products: [product], selectedIds: new Set<string>(),
    onToggleSelect: () => undefined, onViewProduct: () => undefined, onEditProduct: () => undefined,
    onApproveProduct: () => undefined, onRejectProduct: () => undefined, onRetrySync: () => undefined }));
  assert.match(html, /Đã sync · publish chưa đủ/);
  assert.match(html, /Thử lại publish kênh/);
  assert.match(html, /Mở Shopify/);
  assert.doesNotMatch(html, /SHOPIFY_PUBLICATION_INCOMPLETE/);
  const drawer = renderToStaticMarkup(createElement(ProductDetailDrawer, { product, isOpen: true, onClose: () => undefined,
    onEdit: () => undefined, onApprove: () => undefined, onReject: () => undefined }));
  assert.match(drawer, /Sales Channels: 1\/2 đã bật/);
  assert.match(drawer, /Online Store: Đã bật/);
  assert.match(drawer, /POS: Chưa bật/);
});
