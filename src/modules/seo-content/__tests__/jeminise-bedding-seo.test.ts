import assert from "node:assert/strict";
import test from "node:test";

import { checkClaimGrounding } from "../internal/content-generation/claim-guard";
import type { ContentFactSheet } from "../internal/content-generation/content-generation-types";
import { GeminiSeoContentGenerator } from "../internal/content-generation/gemini-content-generator";
import {
  HeuristicContentGenerator,
  buildBeddingSeoDescription,
} from "../internal/content-generation/heuristic-content-generator";
import { formatProductDescriptionHtml } from "../internal/content-generation/html-description-formatter";
import { validateFinalContent } from "../internal/content-generation/content-result-validator";
import { JEMINISE_BEDDING_PROFILE, sanitizeBeddingTitle } from "../internal/store-profiles";
import { projectStoreContentProfile } from "../internal/store-profiles/types";

const KEYWORDS = {
  primary: "Viking Quilt",
  secondary: ["Norse Bedding"],
  supportingKeywords: [],
  framingConcepts: [],
  targetedKeywords: [],
} as const;

const CONSTRAINTS = {
  maxSeoTitleLength: 70,
  maxSeoDescriptionLength: 160,
  maxHandleLength: 80,
  maxBullets: 5,
  preserveExistingHandle: false,
} as const;

function createFacts(confidence: number): ContentFactSheet {
  return {
    originalTitle: "bedding set - Viking warrior with raven shield",
    originalDescription: "Viking warrior with raven shield. Bold runic lettering. VALHALLA",
    niche: "Bedding & Home Decor",
    physicalProductIdentity: "bedding set",
    typographyVisibleTexts: ["VALHALLA"],
    typographyStyleSummary: "bold runic lettering",
    visualEntities: "Viking warrior with raven shield",
    targetAudience: ["Viking history enthusiasts"],
    occasions: ["housewarming"],
    useCases: ["bedroom decor"],
    personalizationSupported: false,
    storeProfile: projectStoreContentProfile(
      JEMINISE_BEDDING_PROFILE,
      "bedding set",
      "Bedding & Home Decor",
      confidence,
    ),
  };
}

test("Jeminise bedding policy activates all three offerings only for grounded high-confidence identity", () => {
  const applicable = createFacts(0.92).storeProfile;
  assert.deepEqual(applicable?.bedding?.options.map((option) => option.name), [
    "Comforter",
    "Quilt",
    "Duvet Cover",
  ]);

  const lowConfidence = createFacts(0.79).storeProfile;
  assert.equal(lowConfidence?.bedding, undefined);

  const wrongIdentity = projectStoreContentProfile(
    JEMINISE_BEDDING_PROFILE,
    "wall art",
    "Bedding & Home Decor",
    0.99,
  );
  assert.equal(wrongIdentity.bedding, undefined);
});

test("Jeminise heuristic description stays focused on visible design", async () => {
  const generator = new HeuristicContentGenerator();
  const draft = await generator.generate({ facts: createFacts(0.92), keywords: KEYWORDS, constraints: CONSTRAINTS });

  assert.equal(draft.productTitle.includes("Comforter, Quilt, Duvet Cover"), false);
  assert.equal(draft.styleOptions, undefined);
  assert.match(draft.productSeoDescription, /Comforter/);
  assert.match(draft.productSeoDescription, /Quilt/);
  assert.match(draft.productSeoDescription, /Duvet Cover/);
  assert.ok(draft.productSeoDescription.length >= 155 && draft.productSeoDescription.length <= 160);

  const html = formatProductDescriptionHtml(draft, {
    includeStyleOptions: false,
    includeGuidance: false,
  });
  assert.doesNotMatch(html, /Comforter|Quilt|Duvet Cover|Blanket/i);
  assert.doesNotMatch(html, /microfiber|machine wash|size|dimension/i);
  assert.match(html, /Design/i);
  assert.match(html, /Why It Stands Out/i);
});

test("Gemini receives the Jeminise visual-design-only description policy", async () => {
  let capturedPrompt = "";
  const generator = new GeminiSeoContentGenerator({
    async generateStructuredText(options) {
      capturedPrompt = options.prompt;
      return {
        rawText: JSON.stringify({
          productTitle: "Viking Warrior Quilt Bedding Set",
          intro: "A grounded Viking warrior bedding design.",
          bullets: [
            { label: "Design", text: "Viking warrior and raven artwork." },
            { label: "Fabric", text: "Ultra-soft brushed microfiber." },
          ],
          guidance: ["Machine wash cold on gentle cycle."],
          closing: "A design-led bedroom centerpiece.",
          productSeoTitle: "Viking Warrior Quilt Bedding Set",
          productSeoDescription: buildBeddingSeoDescription("Viking Warrior Quilt Bedding Set", "Viking warrior", 160),
          aeo_quick_summary: "Viking bedding available as a Comforter, Quilt, or Duvet Cover in microfiber.",
          aeo_faq: [
            { question: "What is the difference between the options?", answer: "Comforter is plush, Quilt is lightweight, and Duvet Cover encases an insert." },
            { question: "Is it suitable year-round?", answer: "Choose the offering suited to your preferred layering." },
            { question: "How is it cared for?", answer: "Machine wash cold on a gentle cycle." },
            { question: "What is shown?", answer: "Visible Viking warrior and raven artwork." },
          ],
        }),
      };
    },
    async generateProductImageAnalysis() {
      throw new Error("Not used by content generation test");
    },
  });

  const draft = await generator.generate({ facts: createFacts(0.92), keywords: KEYWORDS, constraints: CONSTRAINTS });
  assert.match(capturedPrompt, /<STORE_PRODUCT_OFFERING>/);
  assert.match(capturedPrompt, /Comforter: Plush all-season warmth/);
  assert.match(capturedPrompt, /<PRODUCT_DESCRIPTION_POLICY>/);
  assert.match(capturedPrompt, /visual-design-only/);
  assert.doesNotMatch(capturedPrompt, /variantLabel|variantSummary|Variant \/ Style/);
  assert.equal(draft.styleOptions, undefined);
});

test("Jeminise rejects material or product-format text in Shopify description", () => {
  const facts = createFacts(0.92);
  const draft = {
    productTitle: "Viking Warrior Bedding Set",
    intro: "Viking warrior artwork with a raven shield.",
    bullets: [
      { label: "Design", text: "Bold runic lettering frames the central figure." },
      { label: "Materials", text: "Brushed microfiber fabric." },
    ],
    guidance: [],
    closing: "A distinctive focal point for the room.",
    productSeoTitle: "Viking Warrior Bedding Set",
    productSeoDescription: "Viking artwork offered as a Comforter, Quilt, or Duvet Cover for a bold bedroom focal point.",
  };

  assert.throws(
    () => validateFinalContent({
      productTitle: draft.productTitle,
      productDescription: "<p>Viking artwork.</p><ul><li><strong>Materials:</strong> Brushed microfiber fabric.</li></ul>",
      productSeoTitle: draft.productSeoTitle,
      productSeoDescription: draft.productSeoDescription,
    }, draft, facts, KEYWORDS, CONSTRAINTS),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /visual-design-only policy/i);
      assert.match(error.message, /found "Materials"/i);
      assert.match(error.message, /found "microfiber"/i);
      return true;
    },
  );
});

test("bedding SEO description and title sanitation preserve policy constraints", () => {
  const description = buildBeddingSeoDescription(
    "Norse Mythology Odin Ravens Tree of Life Quilt Bedding Set",
    "Odin and ravens",
    160,
  );
  assert.ok(description.length >= 155 && description.length <= 160);
  assert.match(description, /Comforter/);
  assert.match(description, /Quilt/);
  assert.match(description, /Duvet Cover/);
  assert.equal(
    sanitizeBeddingTitle("Viking Dragon Bedding Set - Comforter, Quilt, Duvet Cover"),
    "Viking Dragon Bedding Set",
  );
});

test("claim guard allows claims supplied by the applicable Jeminise policy", () => {
  const violations = checkClaimGrounding({
    productTitle: "Viking Bedding Set",
    intro: "A machine washable bedding set.",
    bullets: [{ label: "Fabric", text: "Ultra-soft brushed microfiber." }],
    guidance: ["Machine wash cold on gentle cycle."],
    closing: "A grounded bedding design.",
    productSeoTitle: "Viking Bedding Set",
    productSeoDescription: "Viking bedding in Comforter, Quilt, or Duvet Cover offerings.",
  }, createFacts(0.92));
  assert.deepEqual(violations, []);
});
