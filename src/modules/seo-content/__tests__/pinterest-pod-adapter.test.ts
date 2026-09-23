import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fromPinterestPodBatch,
  fromPinterestPodItem,
  runPinterestPodSeoPipeline,
} from "../pinterest-pod-adapter";
import type { PinterestPodDeliverables, PodDeliverableItem } from "../pinterest-pod-adapter";
import type { SeoContentInput, SeoContentOutput } from "../types";

describe("Pinterest POD Adapter: fromPinterestPodItem & fromPinterestPodBatch", () => {
  const sampleRugItem: PodDeliverableItem = {
    designId: "design_rug_101",
    sourceCandidateId: "cand_pin_101",
    productType: "rug",
    originalPinTitle: "Washed Persian Medallion Rug in Earth Tones",
    trendKeywords: [
      "vintage boho rug",
      "persian aesthetic",
      "distressed medallion rug",
      "earth tone living room",
    ],
    printMaster: {
      cmykUrl: "/api/pinterest-pod/assets/wf_001/design_101_cmyk_300dpi.jpg",
      rgbUrl: "/api/pinterest-pod/assets/wf_001/design_101_rgb_4k.png",
      localFilePath: "temp/pinterest_pod/wf_001/design_101_rgb.png",
      widthPx: 4000,
      heightPx: 6400,
      dpi: 300,
    },
    cutoutProduct: {
      transparentUrl: "/api/pinterest-pod/assets/wf_001/design_101_cutout.png",
      whiteBgUrl: "/api/pinterest-pod/assets/wf_001/design_101_white.jpg",
      localFilePath: "temp/pinterest_pod/wf_001/design_101_white.jpg",
    },
    composedMockups: [
      {
        referenceImageId: "ref_01",
        mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_101.jpg",
        localFilePath: "temp/pinterest_pod/wf_001/mockup_room_01.jpg",
        detectedSceneType: "living room",
        detectedSceneDescription: "Spacious modern living room with leather couch",
      },
      {
        referenceImageId: "ref_02",
        mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_101.jpg",
        detectedSceneType: "bedroom",
        detectedSceneDescription: "Cozy minimalist bedroom with hardwood floor",
      },
    ],
  };

  it("chuyển đổi chính xác PodDeliverableItem sang SeoContentInput đầy đủ", () => {
    const seoInput = fromPinterestPodItem(sampleRugItem);

    assert.equal(seoInput.productId, "design_rug_101");
    assert.equal(seoInput.title, "Washed Persian Medallion Rug in Earth Tones");
    assert.equal(seoInput.handle, "washed-persian-medallion-rug-in-earth-tones");
    assert.equal(seoInput.niche, "Home Decor > Rugs & Area Rugs (vintage boho rug)");

    // Kiểm tra mô tả phong phú chứa tiêu đề, trends và ngữ cảnh phòng
    assert.ok(seoInput.description.includes("Washed Persian Medallion Rug in Earth Tones"));
    assert.ok(seoInput.description.includes("Trending Aesthetic & Search Keywords: vintage boho rug, persian aesthetic"));
    assert.ok(seoInput.description.includes("Lifestyle Room Context: living room setting (Spacious modern living room with leather couch)"));
    assert.ok(seoInput.description.includes("bedroom setting (Cozy minimalist bedroom with hardwood floor)"));

    // Kiểm tra trích xuất hình ảnh: CHỈ lấy các ảnh AI Mockup (AI_background) cho Storefront
    assert.equal(seoInput.images.length, 2);

    // 1 & 2. Composed Mockups do AI render
    assert.equal(seoInput.images[0].url, "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_101.jpg");
    assert.ok(seoInput.images[0].alt?.includes("styled in living room"));
    assert.equal(seoInput.images[1].url, "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_101.jpg");
    assert.ok(seoInput.images[1].alt?.includes("styled in bedroom"));

    // Đảm bảo file in xưởng và phôi trắng không bị đưa vào media storefront
    assert.ok(!seoInput.images.some((img) => img.url.includes("cmyk") || img.url.includes("rgb")));
    assert.ok(!seoInput.images.some((img) => img.url.includes("white.jpg")));
    assert.ok(!seoInput.images.some((img) => img.url.includes("cutout.png")));
  });

  it("suy luận đúng niche cho sản phẩm blanket và custom", () => {
    const blanketItem: PodDeliverableItem = {
      ...sampleRugItem,
      designId: "design_blanket_202",
      productType: "blanket",
      originalPinTitle: "Chunky Knit Wool Blanket",
      trendKeywords: ["cozy aesthetic", "fall vibes"],
    };
    const blanketInput = fromPinterestPodItem(blanketItem);
    assert.equal(blanketInput.niche, "Home & Living > Bedding & Blankets (cozy aesthetic)");

    const customItem: PodDeliverableItem = {
      ...sampleRugItem,
      designId: "design_custom_303",
      productType: "custom",
      originalPinTitle: "Custom Pet Portrait Canvas",
      trendKeywords: [],
    };
    const customInput = fromPinterestPodItem(customItem);
    assert.equal(customInput.niche, "Custom Print-on-Demand");
  });

  it("xử lý an toàn khi các trường tùy chọn bị thiếu hoặc rỗng", () => {
    const minimalItem: PodDeliverableItem = {
      designId: "design_min_001",
      sourceCandidateId: "cand_min_001",
      productType: "",
      originalPinTitle: "",
      trendKeywords: [],
      printMaster: {
        cmykUrl: "",
        rgbUrl: "",
        widthPx: 1000,
        heightPx: 1000,
        dpi: 300,
      },
      cutoutProduct: {
        transparentUrl: "",
        whiteBgUrl: "",
      },
      composedMockups: [],
    };

    const input = fromPinterestPodItem(minimalItem, "Custom Wall Art");
    assert.equal(input.productId, "design_min_001");
    assert.equal(input.title, "design_min_001");
    assert.equal(input.handle, "design-min-001");
    assert.equal(input.niche, "Custom Wall Art");
    assert.equal(input.images.length, 0);
  });

  it("lọc bỏ URL hình ảnh trùng lặp trong mảng ảnh", () => {
    const dupItem: PodDeliverableItem = {
      ...sampleRugItem,
      composedMockups: [
        {
          referenceImageId: "ref_01",
          mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_same.jpg",
          detectedSceneType: "living room",
          detectedSceneDescription: "First view",
        },
        {
          referenceImageId: "ref_02",
          mockupUrl: "/api/pinterest-pod/assets/wf_001/mockup_same.jpg", // Trùng URL
          detectedSceneType: "bedroom",
          detectedSceneDescription: "Duplicate view",
        },
      ],
      printMaster: {
        cmykUrl: "",
        rgbUrl: "",
        widthPx: 1000,
        heightPx: 1000,
        dpi: 300,
      },
      cutoutProduct: {
        transparentUrl: "",
        whiteBgUrl: "",
      },
    };

    const input = fromPinterestPodItem(dupItem);
    assert.equal(input.images.length, 1);
    assert.equal(input.images[0].url, "/api/pinterest-pod/assets/wf_001/mockup_same.jpg");
  });

  it("fromPinterestPodBatch chuyển đổi toàn bộ mảng thành phẩm", () => {
    const deliverables: PinterestPodDeliverables = {
      workflowId: "wf_test_batch_001",
      success: true,
      productType: "rug",
      totalProduced: 2,
      items: [
        sampleRugItem,
        {
          ...sampleRugItem,
          designId: "design_rug_102",
          originalPinTitle: "Minimalist Japandi Rug",
        },
      ],
    };

    const batch = fromPinterestPodBatch(deliverables);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].handle, "washed-persian-medallion-rug-in-earth-tones");
    assert.equal(batch[1].handle, "minimalist-japandi-rug");
  });
});

describe("Pinterest POD Adapter: runPinterestPodSeoPipeline", () => {
  const sampleDeliverables: PinterestPodDeliverables = {
    workflowId: "wf_run_pipeline_999",
    success: true,
    productType: "rug",
    totalProduced: 3,
    items: [
      {
        designId: "d_01",
        sourceCandidateId: "c_01",
        productType: "rug",
        originalPinTitle: "Boho Moroccan Runner",
        trendKeywords: ["boho runner"],
        printMaster: { cmykUrl: "", rgbUrl: "rgb1.png", widthPx: 4000, heightPx: 6400, dpi: 300 },
        cutoutProduct: { transparentUrl: "", whiteBgUrl: "white1.jpg" },
        composedMockups: [],
      },
      {
        designId: "d_02",
        sourceCandidateId: "c_02",
        productType: "rug",
        originalPinTitle: "Vintage Anatolian Carpet",
        trendKeywords: ["turkish carpet"],
        printMaster: { cmykUrl: "", rgbUrl: "rgb2.png", widthPx: 4000, heightPx: 6400, dpi: 300 },
        cutoutProduct: { transparentUrl: "", whiteBgUrl: "white2.jpg" },
        composedMockups: [],
      },
      {
        designId: "d_03_fail",
        sourceCandidateId: "c_03",
        productType: "rug",
        originalPinTitle: "Corrupted Item That Throws Error",
        trendKeywords: [],
        printMaster: { cmykUrl: "", rgbUrl: "", widthPx: 4000, heightPx: 6400, dpi: 300 },
        cutoutProduct: { transparentUrl: "", whiteBgUrl: "" },
        composedMockups: [],
      },
    ],
  };

  it("thực thi pipeline thành công cho lô sản phẩm với runner tùy chỉnh và bắt lỗi riêng lẻ", async () => {
    const mockRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      if (input.productId === "d_03_fail") {
        throw new Error("Simulated LLM Vision Timeout");
      }
      return {
        productTitle: `SEO Optimized: ${input.title}`,
        productDescription: `<p>Rich Description for ${input.title}</p>`,
        productSeoTitle: `${input.title} | Premium Home Decor`,
        productSeoDescription: `Shop authentic ${input.title} with fast shipping.`,
        images: input.images.map((img) => ({
          sourceUrl: img.url,
          alt: `${input.title} - ${img.alt ?? "Featured"}`,
          webp: { filename: "optimized.webp" },
        })),
        productHandle: input.handle,
      };
    };

    const batchResult = await runPinterestPodSeoPipeline(sampleDeliverables, {
      runner: mockRunner,
      concurrency: 2,
    });

    assert.equal(batchResult.workflowId, "wf_run_pipeline_999");
    assert.equal(batchResult.total, 3);
    assert.equal(batchResult.successful, 2);
    assert.equal(batchResult.failed, 1);

    // Kiểm tra danh sách items
    assert.equal(batchResult.items.length, 3);
    assert.equal(batchResult.items[0].success, true);
    assert.equal(batchResult.items[0].seoOutput?.productTitle, "SEO Optimized: Boho Moroccan Runner");
    assert.equal(batchResult.items[1].success, true);
    assert.equal(batchResult.items[1].seoOutput?.productTitle, "SEO Optimized: Vintage Anatolian Carpet");

    // Item 3 bị lỗi
    assert.equal(batchResult.items[2].success, false);
    assert.equal(batchResult.items[2].error, "Simulated LLM Vision Timeout");

    // seoOutputs chỉ chứa các sản phẩm thành công
    assert.equal(batchResult.seoOutputs.length, 2);
    assert.equal(batchResult.seoOutputs[0].productHandle, "boho-moroccan-runner");
    assert.equal(batchResult.seoOutputs[1].productHandle, "vintage-anatolian-carpet");
  });
});
