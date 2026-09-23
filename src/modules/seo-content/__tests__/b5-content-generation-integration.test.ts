import assert from "node:assert/strict";
import test from "node:test";

import { HeuristicContentGenerator } from "../internal/content-generation/heuristic-content-generator";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import { executeB5ContentGeneration } from "../internal/stages/b5-content-generation";
import type { ConflictResult, ProductUnderstanding, ShoppingContext } from "../internal/domain-types";
import type { SeoContentInput } from "../types";

test("B5 integration produces bounded, formatted content and preserves the existing handle", async () => {
  const source: SeoContentInput = { title: "Vintage Black Cat Halloween T-Shirt", description: "Comfortable black cat shirt for spooky season.", niche: "Apparel", handle: "vintage-black-cat-halloween-t-shirt", images: [] };
  const productUnderstanding: ProductUnderstanding = { typography: { visibleTexts: ["SPOOKY"], styleSummary: "vintage gothic lettering" }, visualEntities: "black cat and moon illustration", sceneContext: "unknown", physicalProductIdentity: "t-shirt" };
  const shoppingContext: ShoppingContext = { targetAudience: ["cat owners", "gothic fashion fans"], suitableOccasions: ["halloween party"], useCases: ["casual street wear"], buyerIntentKeywords: ["halloween cat shirt", "spooky cat tee"] };
  const conflictResult: ConflictResult = { approvedKeywords: ["vintage black cat halloween t-shirt", "retro spooky cat shirt", "gothic halloween apparel"], discardedKeywords: ["cheap cat shirts", "amazon halloween tee"], conflictReasons: { "cheap cat shirts": "surface_unsafe", "amazon halloween tee": "surface_unsafe" }, relevanceScores: { "vintage black cat halloween t-shirt": 0.98, "retro spooky cat shirt": 0.91, "gothic halloween apparel": 0.86 }, corpusRevision: 42 };
  const initialContext = createInitialContext(source);
  const contextAfterB5 = await executeB5ContentGeneration(evolveContext(initialContext, { productUnderstanding, shoppingContext, conflictResult }), { generator: new HeuristicContentGenerator() });
  const content = contextAfterB5.contentResult;
  assert.ok(content);
  assert.ok(content.productSeoTitle.length <= 70);
  assert.ok(content.productSeoDescription.length <= 160);
  assert.ok(content.productDescription.includes("<ul>"));
  assert.equal(content.productHandle, "vintage-black-cat-halloween-t-shirt");
  assert.equal(contextAfterB5.contentGenerationMetadata?.corpusRevision, 42);
  assert.ok(!contextAfterB5.contentGenerationMetadata?.targetedKeywords.includes("cheap cat shirts"));
});
