import assert from "node:assert/strict";
import test from "node:test";

import type { SeoContentInput } from "../types";
import { createInitialContext } from "../internal/pipeline-context";
import {
  b1ProductUnderstandingStage,
  createB1ProductUnderstandingStage,
} from "../internal/stages/b1-product-understanding";
import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
  ProductImageAnalyzerInput,
} from "../internal/product-understanding/product-image-analyzer";
import {
  catShirtFixture,
  motorcycleMugFixture,
  sportsHoodieFixture,
} from "./fixtures/b1-product-understanding.fixtures";

test("Group A: B1 Stage Contract — returns new context, preserves source, freezes output, and has name 'b1'", async () => {
  const initial = createInitialContext(catShirtFixture.input);
  const next = await b1ProductUnderstandingStage.execute(initial);

  assert.notEqual(next, initial, "Evolved context must be a new reference");
  assert.equal(next.source, initial.source, "Context source must be strictly preserved");
  assert.equal(b1ProductUnderstandingStage.name, "b1");
  assert.ok(next.productUnderstanding, "productUnderstanding must be defined");
  assert.ok(Object.isFrozen(next.productUnderstanding));
  assert.ok(Object.isFrozen(next.productUnderstanding.ocrTexts));
  assert.ok(Object.isFrozen(next.productUnderstanding.detectedEntities));
  assert.ok(Object.isFrozen(next.productUnderstanding.dominantColors));
});

test("Group A: B1 Stage Contract — supports dependency injection with custom ProductImageAnalyzer", async () => {
  let callCount = 0;
  const capturedInputs: ProductImageAnalyzerInput[] = [];

  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
      callCount++;
      capturedInputs.push(input);
      return motorcycleMugFixture.mockAnalysis;
    },
  };

  const customStage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const initial = createInitialContext(motorcycleMugFixture.input);
  const result = await customStage.execute(initial);

  assert.equal(callCount, 1);
  assert.equal(capturedInputs[0].image.url, motorcycleMugFixture.input.images[0].url);
  assert.equal(capturedInputs[0].title, motorcycleMugFixture.input.title);
  assert.deepEqual(result.productUnderstanding?.ocrTexts, ["Ride Free"]);
  assert.equal(result.productUnderstanding?.productCategory, "ceramic mug");
});

test("Group B: Happy path Vision — populates all 5 fields accurately from analyzer", async () => {
  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      return catShirtFixture.mockAnalysis;
    },
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const initial = createInitialContext(catShirtFixture.input);
  const result = await stage.execute(initial);
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["Cats Before People"]);
  assert.deepEqual(pu.detectedEntities, ["black cat", "paw prints"]);
  assert.deepEqual(pu.dominantColors, ["black", "white"]);
  assert.equal(pu.visualStyle, "minimalist typography");
  assert.equal(pu.productCategory, "t-shirt");
});

test("Group C: Multi-image aggregation — ranks entities and colors by cross-image frequency", async () => {
  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
      if (input.image.url.includes("img-1")) {
        return {
          ocrTexts: [],
          detectedEntities: ["cat", "moon"],
          dominantColors: ["black", "orange"],
        };
      }
      if (input.image.url.includes("img-2")) {
        return {
          ocrTexts: [],
          detectedEntities: ["cat", "pumpkin"],
          dominantColors: ["black", "cream"],
        };
      }
      return {
        ocrTexts: [],
        detectedEntities: ["cat"],
        dominantColors: ["black"],
      };
    },
  };

  const multiImageInput: SeoContentInput = {
    title: "Halloween Cat Tee",
    niche: "cat lover",
    description: "Graphic tee",
    handle: "halloween-cat-tee",
    images: [
      { url: "https://example.com/img-1.jpg" },
      { url: "https://example.com/img-2.jpg" },
      { url: "https://example.com/img-3.jpg" },
    ],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const result = await stage.execute(createInitialContext(multiImageInput));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  // "cat" appears in 3 images, "moon" in 1, "pumpkin" in 1
  assert.deepEqual(pu.detectedEntities, ["cat", "moon", "pumpkin"]);
  // "black" appears in 3 images, "orange" in 1, "cream" in 1
  assert.deepEqual(pu.dominantColors, ["black", "orange", "cream"]);
});

test("Group D: Partial failures — single image failure does not crash B1, aggregates remaining", async () => {
  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
      if (input.image.url.includes("img-fail")) {
        throw new Error("HTTP 500: Cloud Vision provider timeout");
      }
      return {
        ocrTexts: ["Survivor Quote"],
        detectedEntities: ["vintage motorcycle"],
        dominantColors: ["black", "gold"],
        visualStyle: "vintage retro",
        productCategory: "t-shirt",
      };
    },
  };

  const inputWithBrokenImage: SeoContentInput = {
    title: "Vintage Motorcycle T-Shirt",
    niche: "vintage motorcycle",
    description: "Classic tee",
    handle: "vintage-motorcycle-t-shirt",
    images: [
      { url: "https://example.com/img-fail.jpg" },
      { url: "https://example.com/img-success.jpg" },
    ],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const result = await stage.execute(createInitialContext(inputWithBrokenImage));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["Survivor Quote"]);
  assert.deepEqual(pu.detectedEntities, ["vintage motorcycle"]);
  assert.deepEqual(pu.dominantColors, ["black", "gold"]);
});

test("Group E: All image failures — stage resolves gracefully with text fallback and ocrTexts = []", async () => {
  const failingAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      throw new Error("Provider rate limit 429");
    },
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: failingAnalyzer });
  const result = await stage.execute(createInitialContext(motorcycleMugFixture.input));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, [], "OCR must be empty array when image analysis fails");
  assert.ok(pu.detectedEntities.length > 0, "Fallback entities should be derived from text");
  assert.equal(pu.productCategory, "ceramic mug", "Category should be extracted from text");
  assert.equal(pu.visualStyle, "vintage retro", "Style should be extracted from text");
});

test("Group F: Empty images — analyzer call count is 0, text fallback operates cleanly", async () => {
  let callCount = 0;
  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      callCount++;
      return catShirtFixture.mockAnalysis;
    },
  };

  const inputNoImages: SeoContentInput = {
    title: "Retro Motorcycle Ceramic Mug",
    description: "Cream coffee mug with classic motorcycle design",
    niche: "vintage motorcycle",
    handle: "retro-motorcycle-ceramic-mug",
    images: [],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const result = await stage.execute(createInitialContext(inputNoImages));
  const pu = result.productUnderstanding;

  assert.equal(callCount, 0, "Analyzer should not be called when images array is empty");
  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, []);
  assert.equal(pu.productCategory, "ceramic mug");
  assert.equal(pu.visualStyle, "vintage retro");
  assert.ok(pu.dominantColors.includes("cream"));
});

test("Group G: Canonical empty state — whitespace-only input returns canonical defaults", async () => {
  const emptyInput: SeoContentInput = {
    title: "   ",
    description: " ",
    niche: "",
    handle: "",
    images: [],
  };

  const result = await b1ProductUnderstandingStage.execute(createInitialContext(emptyInput));
  const pu = result.productUnderstanding;

  assert.deepEqual(pu, {
    ocrTexts: [],
    detectedEntities: [],
    dominantColors: [],
    visualStyle: "unspecified",
    productCategory: "unknown",
  });
});

test("Group H: Field-level fallback — missing fields in image analysis fall back to text signals", async () => {
  const partialAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      return {
        ocrTexts: ["Ride Free"],
        detectedEntities: ["motorcycle"],
        dominantColors: [], // Empty colors from vision
        visualStyle: undefined, // Missing style from vision
        productCategory: "ceramic mug",
      };
    },
  };

  const inputWithTextContext: SeoContentInput = {
    title: "Vintage Retro Orange Coffee Mug - Ride Free",
    description: "Ceramic mug in bright orange",
    niche: "vintage motorcycle",
    handle: "vintage-retro-orange-coffee-mug",
    images: [{ url: "https://example.com/mug.jpg" }],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: partialAnalyzer });
  const result = await stage.execute(createInitialContext(inputWithTextContext));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["Ride Free"], "Uses vision OCR");
  assert.deepEqual(pu.detectedEntities, ["motorcycle"], "Uses vision entity");
  assert.deepEqual(pu.dominantColors, ["orange"], "Falls back to text for dominantColors");
  assert.equal(pu.visualStyle, "vintage retro", "Falls back to text for visualStyle");
  assert.equal(pu.productCategory, "ceramic mug", "Preserves vision productCategory");
});

test("Group I: Normalization — trims whitespace, dedupes OCR case-insensitively, normalizes color aliases", async () => {
  const unnormalizedAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      return {
        ocrTexts: ["  Ride Free  ", "RIDE FREE", ""],
        detectedEntities: ["  Black Cat  ", "black cat", "Retro Sun"],
        dominantColors: ["Grey", " Dark Blue ", "Off-White"],
        visualStyle: " Vintage Retro ",
        productCategory: "  T Shirt  ",
      };
    },
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: unnormalizedAnalyzer });
  const result = await stage.execute(
    createInitialContext({
      title: "Test",
      description: "Test",
      niche: "test",
      handle: "test",
      images: [{ url: "https://example.com/test.jpg" }],
    }),
  );
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["Ride Free"]);
  assert.deepEqual(pu.detectedEntities, ["black cat", "retro sun"]);
  assert.deepEqual(pu.dominantColors, ["gray", "navy", "cream"]);
  assert.equal(pu.visualStyle, "vintage retro");
  assert.equal(pu.productCategory, "t-shirt");
});

test("Group J: Anti-hallucination of OCR — title/description text is never falsely promoted to OCR", async () => {
  const zeroOcrAnalyzer: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      return {
        ocrTexts: [],
        detectedEntities: ["black cat"],
        dominantColors: ["black"],
      };
    },
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: zeroOcrAnalyzer });
  const result = await stage.execute(
    createInitialContext({
      title: "Cats Before People Graphic T-Shirt",
      description: "Funny quote printed on shirt",
      niche: "cat lover",
      handle: "cats-before-people",
      images: [{ url: "https://example.com/cat.jpg" }],
    }),
  );
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, [], "Never promote title text to ocrTexts without image evidence");
});

test("Group K: Category aliases — correctly normalizes various apparel and POD product names", async () => {
  const cases: Array<{ title: string; expectedCategory: string }> = [
    { title: "Graphic Tee for Men", expectedCategory: "t-shirt" },
    { title: "Funny T Shirt Short Sleeve", expectedCategory: "t-shirt" },
    { title: "Warm Pullover Hoodie Fleece", expectedCategory: "hoodie" },
    { title: "Retro Coffee Mug 11oz", expectedCategory: "mug" },
    { title: "Vintage Ceramic Mug 15oz", expectedCategory: "ceramic mug" },
    { title: "Living Room Area Rug 4x6", expectedCategory: "rug" },
    { title: "Cotton Canvas Print Wall Art", expectedCategory: "canvas print" },
    { title: "Canvas Tote Bag Reusable", expectedCategory: "tote bag" },
  ];

  for (const c of cases) {
    const input: SeoContentInput = {
      title: c.title,
      description: "Description",
      niche: "general",
      handle: "sample-handle",
      images: [],
    };
    const result = await b1ProductUnderstandingStage.execute(createInitialContext(input));
    assert.equal(
      result.productUnderstanding?.productCategory,
      c.expectedCategory,
      `Expected "${c.expectedCategory}" for "${c.title}"`,
    );
  }
});

test("Group L: Style aliases — correctly resolves composite and keyword styles", async () => {
  const cases: Array<{ title: string; expectedStyle: string }> = [
    { title: "Vintage Retro Sunset Motorcycle", expectedStyle: "vintage retro" },
    { title: "Minimalist Typography Quote Poster", expectedStyle: "minimalist typography" },
    { title: "Cute Cartoon Chibi Kitten", expectedStyle: "cute cartoon" },
    { title: "Sporty Varsity College Football", expectedStyle: "sporty varsity" },
    { title: "Boho Floral Wildflower", expectedStyle: "boho" },
    { title: "Rustic Wooden Cabin", expectedStyle: "rustic" },
    { title: "Gothic Skull Dark Fantasy", expectedStyle: "gothic" },
  ];

  for (const c of cases) {
    const input: SeoContentInput = {
      title: c.title,
      description: "Description",
      niche: "general",
      handle: "sample-handle",
      images: [],
    };
    const result = await b1ProductUnderstandingStage.execute(createInitialContext(input));
    assert.equal(
      result.productUnderstanding?.visualStyle,
      c.expectedStyle,
      `Expected "${c.expectedStyle}" for "${c.title}"`,
    );
  }
});

test("Group M: Default Heuristic Analyzer — never extracts OCR from alt text even when quotes exist", async () => {
  const result = await b1ProductUnderstandingStage.execute(
    createInitialContext(sportsHoodieFixture.input),
  );
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, [], "Heuristic analyzer must not promote alt quotes to OCR");
  assert.equal(pu.productCategory, "hoodie");
  assert.equal(pu.visualStyle, "sporty varsity");
  assert.ok(pu.dominantColors.includes("navy"));
});

test("Group N: Single-image duplicate entities do not inflate cross-image frequency ranking", async () => {
  const mockAnalyzer: ProductImageAnalyzer = {
    async analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
      if (input.image.url.includes("img-1")) {
        // "black cat" repeated 3 times in single image
        return {
          ocrTexts: [],
          detectedEntities: ["black cat", "black cat", "black cat"],
          dominantColors: ["black"],
        };
      }
      if (input.image.url.includes("img-2")) {
        return {
          ocrTexts: [],
          detectedEntities: ["pumpkin"],
          dominantColors: ["orange"],
        };
      }
      return {
        ocrTexts: [],
        detectedEntities: ["pumpkin"],
        dominantColors: ["orange"],
      };
    },
  };

  const input: SeoContentInput = {
    title: "Cat and Pumpkin Tee",
    niche: "halloween",
    description: "Graphic tee",
    handle: "cat-and-pumpkin-tee",
    images: [
      { url: "https://example.com/img-1.jpg" },
      { url: "https://example.com/img-2.jpg" },
      { url: "https://example.com/img-3.jpg" },
    ],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: mockAnalyzer });
  const result = await stage.execute(createInitialContext(input));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  // "pumpkin" appears in 2 images (img-2 and img-3), while "black cat" only in 1 image (img-1)
  // Ranking must prioritize "pumpkin" over "black cat"
  assert.deepEqual(pu.detectedEntities, ["pumpkin", "black cat"]);
});

test("Group O: Synchronous analyzer throw is gracefully caught and does not crash B1", async () => {
  const syncThrowAnalyzer: ProductImageAnalyzer = {
    analyze(input: ProductImageAnalyzerInput): Promise<ProductImageAnalysis> {
      if (input.image.url.includes("sync-throw")) {
        throw new Error("Synchronous fatal validation error in analyzer");
      }
      return Promise.resolve({
        ocrTexts: ["Safe OCR"],
        detectedEntities: ["vintage motorcycle"],
        dominantColors: ["black"],
        visualStyle: "vintage retro",
        productCategory: "ceramic mug",
      });
    },
  };

  const input: SeoContentInput = {
    title: "Vintage Mug",
    description: "Ceramic coffee mug",
    niche: "motorcycle",
    handle: "vintage-mug",
    images: [
      { url: "https://example.com/sync-throw.jpg" },
      { url: "https://example.com/safe.jpg" },
    ],
  };

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: syncThrowAnalyzer });
  const result = await stage.execute(createInitialContext(input));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["Safe OCR"]);
  assert.deepEqual(pu.detectedEntities, ["vintage motorcycle"]);
  assert.equal(pu.productCategory, "ceramic mug");
});


