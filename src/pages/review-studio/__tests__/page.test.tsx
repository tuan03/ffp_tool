import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createReviewClient } from "../../../modules/amazon-reviews";
import type { ReviewShopifyAccess } from "../../../modules/amazon-reviews";
import { createReviewImageClient } from "../../../modules/review-image";
import { ReviewStudioPage } from "../ReviewStudioPage";

test("Review Studio presents the image and Amazon workflows as two steps", () => {
  const reviewClient = createReviewClient({ coordinatorUrl: "http://coordinator.test", fetchImplementation: async () => { throw new Error("No network"); } });
  const reviewShopify: ReviewShopifyAccess = { listStores: async () => ["preaureum"], findProducts: async () => ({ products: [] }) };
  const imageClient = createReviewImageClient(async () => { throw new Error("No network"); });
  const html = renderToStaticMarkup(<ReviewStudioPage reviewClient={reviewClient} reviewShopify={reviewShopify} imageClient={imageClient} />);
  assert.match(html, /Review Studio/);
  assert.match(html, /1\. Chọn store và loại sản phẩm/);
  assert.match(html, /kho ảnh nền và prompt phù hợp/);
  assert.match(html, /border-cyan-500\/40/);
  assert.match(html, /Store sản phẩm nhận review\/XLSX/);
});
