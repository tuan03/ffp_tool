import assert from "node:assert/strict";
import test from "node:test";

import { formatSeoDiffValue, isShopifyProductGid } from "../components/SeoVersionHistoryPanel";
import { sanitizeHtmlDescription } from "../sanitize-html";

test("SEO version history helpers distinguish missing, null and empty values", () => {
  assert.equal(formatSeoDiffValue({ presence: "MISSING" }), "(missing)");
  assert.equal(formatSeoDiffValue({ presence: "VALUE", value: null }), "(null)");
  assert.equal(formatSeoDiffValue({ presence: "VALUE", value: "" }), "(empty)");
  assert.equal(isShopifyProductGid("gid://shopify/Product/123"), true);
  assert.equal(isShopifyProductGid("local-product"), false);
});

test("historical description values use the existing sanitizer before preview", () => {
  const raw = formatSeoDiffValue({ presence: "VALUE", value: '<img src="x" onerror="alert(1)"><script>alert(2)</script>' });
  const safe = sanitizeHtmlDescription(raw);
  assert.equal(safe.includes("script"), false);
  assert.equal(safe.includes("onerror"), false);
});
