import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PodDeliverableItem, PinterestPodDeliverables } from "../../pinterest-pod";
import { fromPinterestPodItem, runPinterestPodSeoPipeline } from "../pinterest-pod-adapter";
import type { SeoContentInput, SeoContentOutput } from "../types";

describe("Pinterest POD Adapter: fromPinterestPodItem & runPinterestPodSeoPipeline", () => {
  const mockPodItem: PodDeliverableItem = {
    designId: "design_rug_101",
    sourceCandidateId: "cand_pin_101",
    productType: "rug",
    originalPinTitle: "Washed Persian Medallion Rug in Earth Tones",
    trendKeywords: [
      "vintage boho rug",
      "persian aesthetic",
      "distressed medallion rug",
    ],
    printMaster: {
      cmykUrl: "/api/pinterest-pod/assets/wf_001/design_101_cmyk_300dpi.jpg",
      rgbUrl: "/api/pinterest-pod/assets/wf_001/design_101_rgb_4k.png",
      widthPx: 4000,
      heightPx: 6400,
      dpi: 300,
    },
    cutoutProduct: {
      transparentUrl: "/api/pinterest-pod/assets/wf_001/design_101_cutout.png",
      whiteBgUrl: "/api/pinterest-pod/assets/wf_001/design_101_white.jpg",
    },
    composedMockups: [
      {
        referenceImageId: "ref_01",
        mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_101.jpg",
        detectedSceneType: "living_room",
        detectedSceneDescription: "Spacious modern living room with leather couch",
      },
      {
        referenceImageId: "ref_02",
        mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_101.jpg",
        detectedSceneType: "bedroom",
        detectedSceneDescription: "Cozy bedroom with hardwood flooring",
      },
    ],
  };

  it("converts PodDeliverableItem to SeoContentInput accurately", () => {
    const seoInput = fromPinterestPodItem(mockPodItem);

    assert.equal(seoInput.title, "Washed Persian Medallion Rug in Earth Tones");
    assert.equal(seoInput.niche, "vintage boho rug");
    assert.equal(seoInput.productId, "design_rug_101");
    assert.ok(seoInput.handle.includes("washed-persian-medallion-rug"));
    assert.ok(seoInput.description.includes("Inspiration: Washed Persian Medallion Rug"));
    assert.ok(seoInput.description.includes("Trend tags: vintage boho rug"));
    assert.ok(seoInput.description.includes("Premium area rug"));

    // Check images ordering:
    // Image 1: White background featured image
    // Image 2, 3: Composed mockups
    // Image 4: Transparent cutout
    // Image 5: RGB 4k artwork
    assert.equal(seoInput.images.length, 5);
    assert.equal(seoInput.images[0]?.url, "/api/pinterest-pod/assets/wf_001/design_101_white.jpg");
    assert.equal(seoInput.images[1]?.url, "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_101.jpg");
    assert.equal(seoInput.images[2]?.url, "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_101.jpg");
    assert.equal(seoInput.images[3]?.url, "/api/pinterest-pod/assets/wf_001/design_101_cutout.png");
    assert.equal(seoInput.images[4]?.url, "/api/pinterest-pod/assets/wf_001/design_101_rgb_4k.png");
  });

  it("runs pipeline end-to-end for a deliverables batch", async () => {
    const mockDeliverables: PinterestPodDeliverables = {
      workflowId: "wf_test_123",
      success: true,
      productType: "rug",
      totalProduced: 1,
      items: [mockPodItem],
    };

    const fakeRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      return {
        productTitle: `SEO: ${input.title}`,
        productDescription: `<p>${input.description}</p>`,
        productSeoTitle: `Best ${input.title}`,
        productSeoDescription: `High quality ${input.niche}`,
        productHandle: input.handle,
        images: input.images.map((img) => ({
          sourceUrl: img.url,
          alt: img.alt || input.title,
          webp: { filename: `${input.handle}-img.webp`, url: img.url },
        })),
      };
    };

    const result = await runPinterestPodSeoPipeline(mockDeliverables, { runner: fakeRunner });

    assert.equal(result.total, 1);
    assert.equal(result.successful, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.items[0]?.designId, "design_rug_101");
    assert.equal(result.items[0]?.success, true);
    assert.equal(result.items[0]?.seoOutput?.productTitle, "SEO: Washed Persian Medallion Rug in Earth Tones");
    assert.equal(result.seoOutputs.length, 1);
  });

  it("isolates individual item failure without failing entire batch", async () => {
    const failingItem: PodDeliverableItem = {
      ...mockPodItem,
      designId: "design_fail_999",
      originalPinTitle: "FAIL_ME",
    };

    const deliverables: PinterestPodDeliverables = {
      workflowId: "wf_mixed_123",
      success: true,
      productType: "rug",
      totalProduced: 2,
      items: [mockPodItem, failingItem],
    };

    const selectiveRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      if (input.title === "FAIL_ME") {
        throw new Error("Gemini AI quota exceeded");
      }
      return {
        productTitle: input.title,
        productDescription: `<p>${input.description}</p>`,
        productSeoTitle: input.title,
        productSeoDescription: input.niche,
        productHandle: input.handle,
        images: [],
      };
    };

    const result = await runPinterestPodSeoPipeline(deliverables, { runner: selectiveRunner });

    assert.equal(result.total, 2);
    assert.equal(result.successful, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.items[0]?.success, true);
    assert.equal(result.items[1]?.success, false);
    assert.ok(result.items[1]?.error?.includes("Gemini AI quota exceeded"));
  });
});
