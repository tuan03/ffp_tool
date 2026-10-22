import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createReviewClient } from "../../../modules/amazon-reviews";
import type { ReviewShopifyAccess } from "../../../modules/amazon-reviews";
import { createReviewImageClient } from "../../../modules/review-image";
import { ReviewStudioPage, readReviewStudioSession, writeReviewStudioSession } from "../ReviewStudioPage";

test("Review Studio presents the image and Amazon workflows as two steps", () => {
  const reviewClient = createReviewClient({ coordinatorUrl: "http://coordinator.test", fetchImplementation: async () => { throw new Error("No network"); } });
  const reviewShopify: ReviewShopifyAccess = { listStores: async () => ["preaureum"], findProducts: async () => ({ products: [] }) };
  const imageClient = createReviewImageClient(async () => { throw new Error("No network"); });
  const html = renderToStaticMarkup(<ReviewStudioPage reviewClient={reviewClient} reviewShopify={reviewShopify} imageClient={imageClient} />);
  assert.match(html, /Review Studio/);
  assert.match(html, /<h1[^>]*>Tạo review sản phẩm<\/h1>/);
  assert.match(html, /Chọn store và loại sản phẩm/);
  assert.match(html, /kho ảnh nền và prompt phù hợp/);
  assert.match(html, /Chuẩn bị ảnh/);
  assert.match(html, /Tạo review &amp; xuất XLSX/);
  assert.match(html, /Store sản phẩm nhận review\/XLSX/);
  assert.match(html, /aria-label="Quy trình Review Studio"/);
  assert.match(html, /id="review-studio-reviews"[^>]*hidden=""/);
  assert.match(html, /id="review-studio-images"/);
});

test("Review Studio persists selected workflow, stores, and uploaded Shopify picture URLs across reloads", () => {
  const map = new Map<string, string>();
  const fakeStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };

  writeReviewStudioSession(
    {
      activeWorkflow: "reviews",
      imageStoreId: "capozen",
      reviewStoreId: "capozen",
      pictureUrlsByStore: { capozen: ["https://cdn.shopify.com/s/files/1/rug.png"] },
    },
    fakeStorage,
  );

  const restored = readReviewStudioSession(fakeStorage);
  assert.equal(restored.activeWorkflow, "reviews");
  assert.equal(restored.imageStoreId, "capozen");
  assert.equal(restored.reviewStoreId, "capozen");
  assert.deepEqual(restored.pictureUrlsByStore, {
    capozen: ["https://cdn.shopify.com/s/files/1/rug.png"],
  });
});


