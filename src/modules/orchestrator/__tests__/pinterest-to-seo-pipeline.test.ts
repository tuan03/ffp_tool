import assert from "node:assert/strict";
import test from "node:test";

import type { PodDeliverableItem, PinterestPodDeliverables } from "../../pinterest-pod";
import type { SeoContentInput, SeoContentOutput } from "../../seo-content";
import { handoverPinterestToSeo } from "../pinterest-to-seo-pipeline";
import { TEST_SEO_STORE_PROFILE } from "./test-seo-store-profile";

function createSamplePodItem(id = "item_1", productType: "rug" | "blanket" = "rug"): PodDeliverableItem {
  return {
    designId: `design_${id}`,
    sourceCandidateId: `cand_${id}`,
    productType,
    originalPinTitle: "Cozy Boho Minimalist Rug Design",
    trendKeywords: ["boho", "minimalist", "living room"],
    cutoutProduct: {
      transparentUrl: "https://example.com/transparent.png",
      whiteBgUrl: "https://example.com/white-bg.jpg",
    },
    composedMockups: [
      {
        referenceImageId: "ref_1",
        mockupUrl: "https://example.com/mockup1.jpg",
        detectedSceneType: "living_room",
        detectedSceneDescription: "modern sunny living room with plants",
      },
    ],
    printMaster: {
      rgbUrl: "https://example.com/print-rgb.png",
      cmykUrl: "https://example.com/print-cmyk.tiff",
      widthPx: 7200,
      heightPx: 10800,
      dpi: 300,
    },
  };
}

test("handoverPinterestToSeo: returns empty result when input items is empty", async () => {
  const result = await handoverPinterestToSeo({
    deliverables: [],
    storeProfile: TEST_SEO_STORE_PROFILE,
  });

  assert.equal(result.total, 0);
  assert.equal(result.successful, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.seoOutputs, []);
  assert.ok(result.workflowId.startsWith("pinterest-pod-handover-"));
});

test("handoverPinterestToSeo: processes deliverables wrapper and preserves workflowId", async () => {
  const item1 = createSamplePodItem("1", "rug");
  const item2 = createSamplePodItem("2", "blanket");

  const deliverables: PinterestPodDeliverables = {
    workflowId: "wf-pinterest-pod-custom-123",
    success: true,
    productType: "rug",
    totalProduced: 2,
    items: [item1, item2],
  };

  const fakeRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    return {
      productTitle: "SEO Optimized Product",
      productDescription: "<p>SEO content grounded in image evidence</p>",
      productSeoTitle: "Grounded Product - Best Quality",
      productSeoDescription: "Shop this image-grounded product today.",
      productHandle: "grounded-product",
      images: (input.images || []).map((img, i) => ({
        sourceUrl: img.url,
        alt: `Grounded image ${i + 1}`,
        webp: {
          filename: `seo-img-${i + 1}.webp`,
          url: `https://cdn.example.com/seo-img-${i + 1}.webp`,
        },
      })),
    };
  };

  const result = await handoverPinterestToSeo(
    { deliverables, storeProfile: TEST_SEO_STORE_PROFILE },
    { seoRunner: fakeRunner },
  );

  assert.equal(result.workflowId, "wf-pinterest-pod-custom-123");
  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.seoOutputs.length, 2);

  const firstItem = result.items[0];
  assert.ok(firstItem.success);
  assert.equal(firstItem.designId, "design_1");
  assert.equal(firstItem.sourceItem.designId, "design_1");
  assert.equal(firstItem.productType, "rug");
  assert.equal(firstItem.seoInput.niche, "home decor");
  assert.deepEqual(Object.keys(firstItem.seoInput).sort(), ["images", "niche", "storeProfile"]);
  assert.equal(firstItem.seoInput.storeProfile, TEST_SEO_STORE_PROFILE);
});

test("handoverPinterestToSeo: handles partial failures gracefully", async () => {
  const item1 = createSamplePodItem("1", "rug");
  const item2 = createSamplePodItem("2", "blanket");

  let calls = 0;
  const flakeyRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
    calls++;
    if (calls === 2) {
      throw new Error("SEO generation service timeout");
    }
    return {
      productTitle: "SEO Grounded Product",
      productDescription: "<p>Content</p>",
      productSeoTitle: "Meta Title",
      productSeoDescription: "Meta Desc",
      productHandle: "handle",
      images: [],
    };
  };

  const result = await handoverPinterestToSeo(
    {
      deliverables: [item1, item2],
      storeProfile: TEST_SEO_STORE_PROFILE,
      concurrency: 1,
    },
    { seoRunner: flakeyRunner },
  );

  assert.equal(result.total, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.seoOutputs.length, 1);

  const failedItem = result.items.find((item) => !item.success);
  assert.ok(failedItem);
  assert.ok(failedItem?.error?.includes("SEO generation service timeout"));
});
