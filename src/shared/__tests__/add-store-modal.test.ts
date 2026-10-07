import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AddStoreModal } from "../components/AddStoreModal";

test("new store form requires an explicit SEO profile selection", () => {
  const html = renderToStaticMarkup(createElement(AddStoreModal, {
    isOpen: true,
    onClose: () => undefined,
    onStoreAdded: () => undefined,
  }));

  assert.match(html, /name="ffp_seo_profile_id"/);
  assert.match(html, /name="ffp_seo_profile_id"[^>]*required/);
  assert.match(html, /Chọn chính sách SEO cho store/);
});
