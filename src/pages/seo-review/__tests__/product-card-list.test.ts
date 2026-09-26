import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import { ProductCardList } from "../components/ProductCardList";
import { ProductDetailDrawer } from "../components/ProductDetailDrawer";

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
  assert.match(html, /Duyệt/);
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
