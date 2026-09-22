import test from "node:test";
import assert from "node:assert/strict";

import { createSeoPipeline } from "../internal/pipeline";
import { executeB5ContentGeneration } from "../internal/stages/b5-content-generation";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import type { SeoContentInput } from "../types";
import type {
  ConflictResult,
  ProductUnderstanding,
  ShoppingContext,
} from "../internal/domain-types";

test("B5 Integration: executeB5ContentGeneration stage produces valid ContentResult and metadata", async () => {
  const source: SeoContentInput = {
    title: "Vintage Black Cat Halloween T-Shirt",
    description: "Comfortable black cat shirt for spooky season.",
    niche: "Apparel",
    handle: "vintage-black-cat-halloween-t-shirt",
    images: [{ url: "https://example.com/cat.jpg" }],
  };

  const productUnderstanding: ProductUnderstanding = {
    ocrTexts: ["SPOOKY"],
    detectedEntities: ["black cat", "moon"],
    dominantColors: ["black", "yellow"],
    visualStyle: "vintage gothic",
    productCategory: "t-shirt",
  };

  const shoppingContext: ShoppingContext = {
    targetAudience: ["cat owners", "gothic fashion fans"],
    suitableOccasions: ["halloween party"],
    useCases: ["casual street wear"],
    buyerIntentKeywords: ["halloween cat shirt", "spooky cat tee"],
  };

  const conflictResult: ConflictResult = {
    approvedKeywords: [
      "vintage black cat halloween t-shirt",
      "retro spooky cat shirt",
      "gothic halloween apparel",
    ],
    discardedKeywords: ["cheap cat shirts", "amazon halloween tee"],
    conflictReasons: {
      "cheap cat shirts": "surface_unsafe",
      "amazon halloween tee": "surface_unsafe",
    },
    relevanceScores: {
      "vintage black cat halloween t-shirt": 0.98,
      "retro spooky cat shirt": 0.91,
      "gothic halloween apparel": 0.86,
    },
    corpusRevision: 42,
  };

  const initialContext = createInitialContext(source);
  const contextBeforeB5 = evolveContext(initialContext, {
    productUnderstanding,
    shoppingContext,
    conflictResult,
  });

  const contextAfterB5 = await executeB5ContentGeneration(contextBeforeB5);

  // 1. Context immutability and source reference preservation
  assert.equal(contextAfterB5.source, initialContext.source);
  assert.notEqual(contextAfterB5, contextBeforeB5);

  // 2. ContentResult structure and bounds
  const content = contextAfterB5.contentResult;
  assert.ok(content);
  assert.ok(content.productTitle.length > 0);
  assert.ok(content.productSeoTitle.length <= 70);
  assert.ok(content.productSeoDescription.length <= 160);
  assert.ok(content.productDescription.includes("<p>"));
  assert.ok(content.productDescription.includes("<ul>"));
  assert.ok(content.productDescription.includes("<li>"));
  assert.ok(content.productDescription.includes("<strong>"));
  assert.equal(content.productHandle, "vintage-black-cat-halloween-t-shirt");

  // 3. ContentGenerationMetadata
  const meta = contextAfterB5.contentGenerationMetadata;
  assert.ok(meta);
  assert.equal(meta.primaryKeyword, "vintage black cat halloween t-shirt");
  assert.ok(meta.secondaryKeywords.length > 0);
  assert.equal(meta.corpusRevision, 42);
  assert.ok(meta.targetedKeywords.includes("vintage black cat halloween t-shirt"));
  assert.ok(!meta.targetedKeywords.includes("cheap cat shirts"));
});

test("B5 Integration: Full pipeline executes end-to-end through B5 with HTML formatting and SEO limits", async () => {
  const pipeline = createSeoPipeline();

  const input: SeoContentInput = {
    title: "Personalized Music Player Rug",
    description: "Custom printed floor carpet featuring your favorite songs.",
    niche: "Home Decor",
    handle: "",
    images: [{ url: "https://example.com/music-rug.jpg" }],
  };

  const output = await pipeline.execute(input);

  assert.ok(output.productTitle.length > 0);
  assert.ok(output.productSeoTitle.length > 0);
  assert.ok(
    output.productSeoTitle.length <= 70,
    `SEO Title was ${output.productSeoTitle.length} chars`,
  );
  assert.ok(
    output.productSeoDescription.length <= 160,
    `SEO Description was ${output.productSeoDescription.length} chars`,
  );
  assert.ok(output.productHandle.length > 0);
  assert.ok(!output.productHandle.includes(" "));
  assert.ok(output.productDescription.includes("<p>"));
  assert.ok(output.productDescription.includes("<strong>"));
});
