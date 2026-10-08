import assert from "node:assert/strict";
import test from "node:test";

import type { ContentFactSheet } from "../internal/content-generation/content-generation-types";
import { validateFinalContent } from "../internal/content-generation/content-result-validator";
import { HeuristicContentGenerator } from "../internal/content-generation/heuristic-content-generator";
import { formatProductDescriptionHtml } from "../internal/content-generation/html-description-formatter";
import { PREAUREUM_HANDBAG_PROFILE } from "../internal/store-profiles";
import { projectStoreContentProfile } from "../internal/store-profiles/types";

const KEYWORDS = {
  primary: "floral butterfly handbag",
  secondary: ["colorful butterfly purse"],
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

function createFacts(): ContentFactSheet {
  return {
    originalTitle: "Floral butterfly design",
    originalDescription: "Colorful flowers and butterflies on a dark background.",
    niche: "Personalized Handbags & Wallets",
    physicalProductIdentity: "handbag",
    typographyVisibleTexts: [],
    visualEntities: "colorful butterflies surrounded by pink and blue flowers",
    targetAudience: ["butterfly art enthusiasts"],
    occasions: [],
    useCases: [],
    personalizationSupported: false,
    storeProfile: projectStoreContentProfile(
      PREAUREUM_HANDBAG_PROFILE,
      "handbag",
      "Personalized Handbags & Wallets",
      0.95,
    ),
  };
}

test("Preaureum heuristic description contains only visual-design copy", async () => {
  const draft = await new HeuristicContentGenerator().generate({
    facts: createFacts(),
    keywords: KEYWORDS,
    constraints: CONSTRAINTS,
  });
  const html = formatProductDescriptionHtml(draft, {
    includeStyleOptions: false,
    includeGuidance: false,
  });

  assert.match(html, /butterfl|flowers|Design|Why It Stands Out/i);
  assert.doesNotMatch(html, /handbag|purse|wallet|tote|material|leather|size|capacity|strap|pocket/i);
});

test("Preaureum rejects product-format and construction text in Shopify description", () => {
  const facts = createFacts();
  const draft = {
    productTitle: "Floral Butterfly Handbag",
    intro: "Colorful butterfly artwork with layered flowers.",
    bullets: [
      { label: "Design", text: "Pink and blue flowers frame the butterflies." },
      { label: "Visual Appeal", text: "A dark background strengthens the color contrast." },
    ],
    guidance: [],
    closing: "A distinctive composition for butterfly-art enthusiasts.",
    productSeoTitle: "Floral Butterfly Handbag",
    productSeoDescription: "Discover colorful floral butterfly artwork with a vivid composition and dark contrasting background.",
  };

  assert.throws(
    () => validateFinalContent({
      productTitle: draft.productTitle,
      productDescription: "<p>A leather handbag with a zippered pocket and shoulder strap.</p>",
      productSeoTitle: draft.productSeoTitle,
      productSeoDescription: draft.productSeoDescription,
    }, draft, facts, KEYWORDS, CONSTRAINTS),
    /Preaureum product description must not mention/i,
  );
});
