import assert from "node:assert/strict";
import test from "node:test";

import { extractDescriptionText, findExcludedLiteral } from "../internal/literal-text-guard";
import { detectPersonalizationEvidence } from "../internal/content-generation/content-fact-sheet";
import { buildB5ContentInput, executeB5ContentGeneration } from "../internal/stages/b5-content-generation";
import { createInitialContext } from "../internal/pipeline-context";
import { TEST_STORE_PROFILE } from "./test-profile";

const understanding = {
  physicalProductIdentity: "structured handbag", confidence: 0.98,
  typography: { visibleTexts: [], excludedLiteralTexts: ["STRONG", "COFFEE"], customizationSampleTexts: ["JANE"], styleSummary: "bold lettering" },
  visualEntities: "blue floral motif", sceneContext: "plain background",
};
const input = { images: [], niche: "Personalized Handbags", storeProfile: TEST_STORE_PROFILE };

test("literal guard checks HTML text, not strong tags, while retaining encoded and inline text", () => {
  assert.equal(findExcludedLiteral(extractDescriptionText('<p><strong>Design:</strong> Floral motif.</p>'), ["STRONG"]), undefined);
  for (const html of ['<p><strong>STRONG</strong></p>', '<p>STR&#79;NG</p>', '<p>STR<span>ONG</span></p>']) {
    assert.equal(findExcludedLiteral(extractDescriptionText(html), ["STRONG"])?.literal, "STRONG");
  }
  assert.equal(findExcludedLiteral(extractDescriptionText('<p>STR</p><p>ONG</p>'), ["STRONG"]), undefined);
});

test("B5 removes forbidden literals from derived framing without discarding safe concepts", () => {
  const context = { ...createInitialContext(input), productUnderstanding: understanding,
    shoppingContext: { targetAudience: ["coffee lovers", "floral art lovers"], suitableOccasions: ["coffee dates"], useCases: ["daily outings"], buyerIntentKeywords: [] } };
  const { facts, keywords } = buildB5ContentInput(context);
  assert.deepEqual(facts.targetAudience, ["floral art lovers"]);
  assert.deepEqual(keywords.framingConcepts, ["floral art lovers", "daily outings"]);
  assert.equal(findExcludedLiteral(keywords, understanding.typography.excludedLiteralTexts), undefined);
});

test("B5 finalization accepts formatter strong tags but rejects a literal in the actual draft", async () => {
  const context = { ...createInitialContext(input), productUnderstanding: understanding };
  const draft = { productTitle: "Floral handbag", intro: "Blue floral artwork anchors this composition.",
    bullets: [{ label: "Design", text: "Floral motifs." }, { label: "Palette", text: "Blue accents." }],
    guidance: [], closing: "Explore the floral artwork.", productSeoTitle: "Floral handbag", productSeoDescription: "Discover blue floral artwork." };
  const completed = await executeB5ContentGeneration(context, { generator: { generate: async () => draft } });
  assert.match(completed.contentResult?.productDescription ?? "", /<strong>/);
  await assert.rejects(executeB5ContentGeneration(context, { generator: { generate: async () => ({ ...draft, intro: "STRONG floral artwork." }) } }), /literal artwork/i);
  await assert.rejects(executeB5ContentGeneration({ ...context,
    conflictResult: { approvedKeywords: ["strong floral handbag"], discardedKeywords: [], conflictReasons: {} },
  }, { generator: { generate: async () => draft } }), /literal artwork/i);
});

test("personalization requires an applicable explicit catalog policy, not niche or sample names", () => {
  assert.equal(detectPersonalizationEvidence(input, understanding), false);
  const configured = { ...input, storeProfile: { ...TEST_STORE_PROFILE, catalogPolicies: [{
    policyId: "verified-personalization", applicableNiches: ["handbags"], productIdentityTerms: ["handbag"], minimumIdentityConfidence: 0.9,
    offerings: [], allowedClaims: ["personalization:customizable"], requiredContentRules: [],
  }] } };
  assert.equal(detectPersonalizationEvidence(configured, understanding), true);
  assert.equal(detectPersonalizationEvidence(configured, { ...understanding, confidence: 0.5 }), false);
  assert.equal(detectPersonalizationEvidence(configured, { ...understanding, confidence: Infinity }), false);
  assert.equal(detectPersonalizationEvidence(configured, { ...understanding, physicalProductIdentity: "rug" }), false);
  assert.equal(detectPersonalizationEvidence({ ...configured, niche: "rugs" }, understanding), false);
  assert.equal(detectPersonalizationEvidence(configured, { ...understanding, reviewRequired: true }), false);
});
