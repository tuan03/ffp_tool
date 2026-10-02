import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StoreSelector } from "../ui/StoreSelector";

test("SEO queue store selector renders configured stores and the current selection", () => {
  const html = renderToStaticMarkup(createElement(StoreSelector, {
    stores: [
      { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
      { storeId: "wrydeco", shopDomain: "wrydeco.myshopify.com" },
    ],
    selectedStoreId: "wrydeco",
    isLoading: false,
    onChange: () => undefined,
  }));

  assert.match(html, /<select[^>]+id="seo-store"/);
  assert.match(html, /capozen \(capozen\.myshopify\.com\)/);
  assert.match(html, /<option value="wrydeco" selected="">wrydeco \(wrydeco\.myshopify\.com\)<\/option>/);
  assert.doesNotMatch(html, /Mở store/);
});
