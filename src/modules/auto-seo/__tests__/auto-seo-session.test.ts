import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MockAutoSeoClient } from "../mocks/runner";
import type { ShopifyProductForAutoSeoUi } from "../types";
import { AutoSeoPage } from "../ui/AutoSeoPage";
import { AutoSeoToolbar } from "../ui/components/AutoSeoToolbar";
import { ProductSelectionTable } from "../ui/components/ProductSelectionTable";
import {
  clearAutoSeoSession,
  getAutoSeoSessionState,
  setAutoSeoLastHydratedProducts,
  setAutoSeoOutput,
  setAutoSeoProducts,
  setAutoSeoSearchQuery,
  setAutoSeoSelectedProductIds,
  setAutoSeoSelectedStoreId,
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

test("auto-seo session: AutoSeoPage does NOT auto-load products on mount when session has no products", () => {
  clearAutoSeoSession();

  let loadCount = 0;
  const dummyClient = new MockAutoSeoClient();
  dummyClient.loadProducts = async () => {
    loadCount++;
    return [];
  };

  const html = renderToStaticMarkup(React.createElement(AutoSeoPage, { client: dummyClient }));
  assert.equal(loadCount, 0, "Must NOT auto-load products on mount");
  assert.ok(html.includes("Chưa có sản phẩm nào được tải"));
  assert.ok(html.includes("Tải sản phẩm"));
});

test("auto-seo session: tracks selectedStoreId and setAutoSeoSelectedStoreId", () => {
  clearAutoSeoSession();
  assert.equal(getAutoSeoSessionState().selectedStoreId, undefined);

  setAutoSeoSelectedStoreId("store-cool-stuff");
  assert.equal(getAutoSeoSessionState().selectedStoreId, "store-cool-stuff");

  setAutoSeoSelectedStoreId("capozen");
  assert.equal(getAutoSeoSessionState().selectedStoreId, "capozen");

  clearAutoSeoSession();
  assert.equal(getAutoSeoSessionState().selectedStoreId, undefined);
});

test("auto-seo: AutoSeoToolbar renders store select dropdown with available stores", () => {
  const stores = [
    { storeId: "store-chillgen-mock", shopDomain: "chillgen-mock.myshopify.com" },
    { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
  ];

  let selectedStore = "store-chillgen-mock";
  const html = renderToStaticMarkup(
    React.createElement(AutoSeoToolbar, {
      isLoadingProducts: false,
      isRunningAutoSeo: false,
      totalProductsCount: 0,
      selectedCount: 0,
      visibleProductsCount: 0,
      onLoadProducts: () => {},
      onSelectAll: () => {},
      onClearSelection: () => {},
      onRunAutoSeo: () => {},
      stores,
      selectedStoreId: selectedStore,
      onSelectStore: (id) => {
        selectedStore = id;
      },
    }),
  );

  assert.ok(html.includes("auto-seo-store-select"));
  assert.ok(html.includes("store-chillgen-mock (chillgen-mock.myshopify.com)"));
  assert.ok(html.includes("capozen (capozen.myshopify.com)"));
  assert.ok(html.includes("Tải sản phẩm"));
});

test("auto-seo: AutoSeoToolbar disables 'Tải sản phẩm' when selectedStoreId is undefined or empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(AutoSeoToolbar, {
      isLoadingProducts: false,
      isRunningAutoSeo: false,
      totalProductsCount: 0,
      selectedCount: 0,
      visibleProductsCount: 0,
      onLoadProducts: () => {},
      onSelectAll: () => {},
      onClearSelection: () => {},
      onRunAutoSeo: () => {},
      stores: [{ storeId: "store-1", shopDomain: "store-1.myshopify.com" }],
      selectedStoreId: undefined,
    }),
  );

  assert.ok(html.includes("disabled"));
});

test("auto-seo: ProductSelectionTable renders loading skeleton state when isLoading is true and products is empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProductSelectionTable, {
      products: [],
      selectedProductIds: [],
      onToggleSelect: () => {},
      onOpenDetail: () => {},
      isLoading: true,
    }),
  );

  assert.ok(html.includes("Đang tải sản phẩm từ cửa hàng..."));
  assert.ok(!html.includes("Chưa có sản phẩm nào được tải"));
});

