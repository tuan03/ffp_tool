import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MockAutoSeoClient } from "../mocks/runner";
import type { ShopifyProductForAutoSeoUi } from "../types";
import { AutoSeoPage } from "../ui/AutoSeoPage";
import {
  clearAutoSeoSession,
  getAutoSeoSessionState,
  setAutoSeoLastHydratedProducts,
  setAutoSeoOutput,
  setAutoSeoProducts,
  setAutoSeoSearchQuery,
  setAutoSeoSelectedProductIds,
  setAutoSeoStatusFilter,
  subscribeAutoSeoSession,
  updateAutoSeoSession,
} from "../ui/auto-seo-session";

const sampleProduct: ShopifyProductForAutoSeoUi = {
  id: "gid://shopify/Product/1001",
  title: "Test Gothic Mug",
  handle: "test-gothic-mug",
  status: "ACTIVE",
  images: [
    {
      id: "gid://shopify/ProductImage/1001",
      url: "https://example.com/mug.jpg",
      altText: "Gothic Mug",
    },
  ],
};

test("auto-seo session: tracks products and sets hasLoadedInitially", () => {
  clearAutoSeoSession();
  assert.equal(getAutoSeoSessionState().products.length, 0);
  assert.equal(getAutoSeoSessionState().hasLoadedInitially, false);

  setAutoSeoProducts([sampleProduct]);
  const state = getAutoSeoSessionState();
  assert.equal(state.products.length, 1);
  assert.equal(state.products[0].id, "gid://shopify/Product/1001");
  assert.equal(state.hasLoadedInitially, true);
});
test("auto-seo session: tracks selection, search query and status filter", () => {
  clearAutoSeoSession();

  setAutoSeoSelectedProductIds(["gid://shopify/Product/1001"]);
  assert.deepEqual(getAutoSeoSessionState().selectedProductIds, ["gid://shopify/Product/1001"]);

  setAutoSeoSearchQuery("mug");
  assert.equal(getAutoSeoSessionState().searchQuery, "mug");

  setAutoSeoStatusFilter("ACTIVE");
  assert.equal(getAutoSeoSessionState().statusFilter, "ACTIVE");
});

test("auto-seo session: tracks output and hydrated products", () => {
  clearAutoSeoSession();

  setAutoSeoOutput({
    workflowId: "wf-123",
    selectedCount: 1,
    warnings: [],
    seoContentInputs: [],
  });
  assert.equal(getAutoSeoSessionState().output?.workflowId, "wf-123");

  setAutoSeoLastHydratedProducts([sampleProduct]);
  assert.equal(getAutoSeoSessionState().lastHydratedProducts.length, 1);
});

test("auto-seo session: notifies listeners on state changes and supports unsubscribe", () => {
  clearAutoSeoSession();

  let count = 0;
  const unsubscribe = subscribeAutoSeoSession(() => {
    count++;
  });

  setAutoSeoSearchQuery("gothic");
  assert.equal(count, 1);

  setAutoSeoStatusFilter("DRAFT");
  assert.equal(count, 2);

  unsubscribe();
  setAutoSeoSearchQuery("vintage");
  assert.equal(count, 2); // Unsubscribed, counter does not increase
});

test("auto-seo session: clearAutoSeoSession resets all state to defaults", () => {
  setAutoSeoProducts([sampleProduct]);
  setAutoSeoSelectedProductIds(["gid://shopify/Product/1001"]);
  setAutoSeoSearchQuery("test");

  clearAutoSeoSession();

  const state = getAutoSeoSessionState();
  assert.equal(state.products.length, 0);
  assert.equal(state.selectedProductIds.length, 0);
  assert.equal(state.searchQuery, "");
  assert.equal(state.hasLoadedInitially, false);
});

test("auto-seo session: AutoSeoPage remount preserves session products and does not re-fetch", () => {
  clearAutoSeoSession();
  setAutoSeoProducts([sampleProduct]);
  setAutoSeoSelectedProductIds(["gid://shopify/Product/1001"]);

  let loadCount = 0;
  const dummyClient = new MockAutoSeoClient();
  dummyClient.loadProducts = async () => {
    loadCount++;
    return [];
  };

  const html = renderToStaticMarkup(React.createElement(AutoSeoPage, { client: dummyClient }));
  assert.ok(html.includes("Test Gothic Mug"));
  assert.equal(loadCount, 0); // Did not trigger loadProducts because products already in session!
});

