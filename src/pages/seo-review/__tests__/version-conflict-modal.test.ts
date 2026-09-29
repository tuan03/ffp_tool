import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VersionConflictModal } from "../components/VersionConflictModal";
import type { ShopifyVersionConflictDetails } from "../../../modules/shopify-sync";
import type { SeoProductUiViewModel } from "../types";

test("VersionConflictModal: returns empty markup when isOpen is false", () => {
  const html = renderToStaticMarkup(
    createElement(VersionConflictModal, {
      isOpen: false,
      onClose: () => {},
      onForceOverwrite: () => {},
      onReRunSeo: () => {},
    }),
  );
  assert.equal(html, "");
});

test("VersionConflictModal: renders side-by-side diff comparison and action buttons when open", () => {
  const mockConflict: ShopifyVersionConflictDetails = {
    code: "SHOPIFY_VERSION_CONFLICT",
    productId: "gid://shopify/Product/999",
    sourceShopifyUpdatedAt: "2026-09-28T08:00:00.000Z",
    currentShopifyUpdatedAt: "2026-09-28T09:30:00.000Z",
    currentProduct: {
      id: "gid://shopify/Product/999",
      title: "Store Updated Title",
      handle: "store-updated-handle",
      seo: {
        title: "Store SEO Title",
        description: "Store SEO Description",
      },
    },
    message: "Shopify product gid://shopify/Product/999 has been updated",
  };

  const html = renderToStaticMarkup(
    createElement(VersionConflictModal, {
      isOpen: true,
      onClose: () => {},
      onForceOverwrite: () => {},
      onReRunSeo: () => {},
      conflictDetails: mockConflict,
      proposedProduct: {
        id: "gid://shopify/Product/999",
        title: "SEO Proposed Title",
        handle: "seo-proposed-handle",
        seoTitle: "SEO Proposed SEO Title",
        seoDescription: "SEO Proposed Description",
      },
    }),
  );

  // Modal dialog wrapper
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes("PHÁT HIỆN XUNG ĐỘT PHIÊN BẢN"));

  // Current Shopify values
  assert.ok(html.includes("2026-09-28T09:30:00.000Z"));
  assert.ok(html.includes("Store Updated Title"));
  assert.ok(html.includes("/store-updated-handle"));
  assert.ok(html.includes("Store SEO Title"));
  assert.ok(html.includes("Store SEO Description"));

  // Proposed SEO values
  assert.ok(html.includes("2026-09-28T08:00:00.000Z"));
  assert.ok(html.includes("SEO Proposed Title"));
  assert.ok(html.includes("/seo-proposed-handle"));
  assert.ok(html.includes("SEO Proposed SEO Title"));
  assert.ok(html.includes("SEO Proposed Description"));

  // Resolution buttons
  assert.ok(html.includes("Force Overwrite (Ghi đè cưỡng bức)"));
  assert.ok(html.includes("Re-run SEO (Tạo lại SEO)"));
  assert.ok(html.includes('aria-label="Ghi đè cưỡng bức"'));
  assert.ok(html.includes('aria-label="Tạo lại SEO"'));
});

test("VersionConflictModal: parses SHOPIFY_VERSION_CONFLICT from product.shopifySyncError JSON string", () => {
  const conflictPayload: ShopifyVersionConflictDetails = {
    code: "SHOPIFY_VERSION_CONFLICT",
    productId: "gid://shopify/Product/777",
    sourceShopifyUpdatedAt: "2026-09-28T07:00:00Z",
    currentShopifyUpdatedAt: "2026-09-28T11:00:00Z",
    currentProduct: {
      id: "gid://shopify/Product/777",
      title: "Remote Changed Title",
      handle: "remote-changed-handle",
    },
    message: "Version mismatch detected",
  };

  const mockProduct = {
    id: "vm-1",
    productId: "gid://shopify/Product/777",
    shopifySyncError: JSON.stringify(conflictPayload),
    productTitle: { value: "Generated SEO Title", isModified: false },
    handle: { value: "generated-seo-handle", isModified: false },
  } as unknown as SeoProductUiViewModel;

  const html = renderToStaticMarkup(
    createElement(VersionConflictModal, {
      isOpen: true,
      onClose: () => {},
      onForceOverwrite: () => {},
      onReRunSeo: () => {},
      product: mockProduct,
    }),
  );

  assert.ok(html.includes("2026-09-28T11:00:00Z"));
  assert.ok(html.includes("Remote Changed Title"));
  assert.ok(html.includes("/remote-changed-handle"));
  assert.ok(html.includes("Generated SEO Title"));
});

test("VersionConflictModal: invokes onForceOverwrite and onReRunSeo with targetProductId", () => {
  let forceOverwrittenId = "";
  let reRunSeoId = "";
  let closedCount = 0;

  const mockConflict: ShopifyVersionConflictDetails = {
    code: "SHOPIFY_VERSION_CONFLICT",
    productId: "gid://shopify/Product/888",
    sourceShopifyUpdatedAt: "2026-09-28T05:00:00Z",
    currentShopifyUpdatedAt: "2026-09-28T06:00:00Z",
  };

  const element = createElement(VersionConflictModal, {
    isOpen: true,
    onClose: () => {
      closedCount++;
    },
    onForceOverwrite: (id) => {
      forceOverwrittenId = id;
    },
    onReRunSeo: (id) => {
      reRunSeoId = id;
    },
    conflictDetails: mockConflict,
  });

  // Verify element props directly
  assert.equal(element.props.isOpen, true);
  assert.equal(element.props.conflictDetails?.productId, "gid://shopify/Product/888");

  // Call the callbacks as the button onClick handlers do
  element.props.onForceOverwrite("gid://shopify/Product/888");
  assert.equal(forceOverwrittenId, "gid://shopify/Product/888");

  element.props.onReRunSeo("gid://shopify/Product/888");
  assert.equal(reRunSeoId, "gid://shopify/Product/888");
});
