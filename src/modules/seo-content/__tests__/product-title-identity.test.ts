import assert from "node:assert/strict";
import test from "node:test";

import { validateFinalContent } from "../internal/content-generation/content-result-validator";
import type {
  ContentConstraints,
  ContentFactSheet,
  GeneratedContentDraft,
  KeywordAllocation,
} from "../internal/content-generation/content-generation-types";
import {
  CAPOZEN_RUG_PROFILE,
  ensureProductIdentityInTitle,
  hasProductIdentityInTitle,
  JEMINISE_BEDDING_PROFILE,
  PREAUREUM_HANDBAG_PROFILE,
  projectStoreContentProfile,
} from "../internal/store-profiles";

const CONSTRAINTS: ContentConstraints = {
  maxSeoTitleLength: 70,
  maxSeoDescriptionLength: 160,
  maxHandleLength: 80,
  maxBullets: 5,
  preserveExistingHandle: false,
};

const KEYWORDS: KeywordAllocation = {
  secondary: [],
  supportingKeywords: [],
  framingConcepts: [],
  targetedKeywords: [],
};

function createDraft(productTitle: string, productSeoTitle = productTitle): GeneratedContentDraft {
  return {
    productTitle,
    intro: "A visible wolf composition in contrasting colors.",
    bullets: [
      { label: "Design", text: "Two wolves form the central composition." },
      { label: "Color", text: "Red and blue tones create contrast." },
    ],
    guidance: [],
    closing: "A distinctive animal-inspired composition.",
    productSeoTitle,
    productSeoDescription: "Explore a red and blue wolf composition created as a distinctive visual focal point.",
  };
}

function createFacts(
  profile: NonNullable<ContentFactSheet["storeProfile"]>,
  identity: string,
): ContentFactSheet {
  return {
    originalTitle: `${identity} - red and blue wolves`,
    originalDescription: "Red and blue wolves face each other.",
    niche: identity,
    physicalProductIdentity: identity,
    typographyVisibleTexts: [],
    visualEntities: "red and blue wolves",
    targetAudience: [],
    occasions: [],
    useCases: [],
    personalizationSupported: false,
    storeProfile: profile,
  };
}

test("title identity policies cover the known Bedding, Blanket, Rug, and Handbag catalogs", () => {
  const cases = [
    [JEMINISE_BEDDING_PROFILE, "quilt bedding set", "Bedding", "Bedding"],
    [JEMINISE_BEDDING_PROFILE, "fleece blanket", "Blanket", "Blanket"],
    [CAPOZEN_RUG_PROFILE, "area rug", "Rug", "Area Rug"],
    [PREAUREUM_HANDBAG_PROFILE, "structured handbag", "Handbag", "Handbag"],
  ] as const;

  for (const [storeProfile, identity, productType, expectedTerm] of cases) {
    const projected = projectStoreContentProfile(storeProfile, identity, productType, 0.95);
    assert.equal(projected.titleIdentity?.preferredTerm, expectedTerm);
  }
});

test("generic title identity fallback supports a confident future product type", () => {
  const projected = projectStoreContentProfile(
    CAPOZEN_RUG_PROFILE,
    "ceramic coffee mug",
    "Mug",
    0.96,
  );

  assert.equal(projected.titleIdentity?.preferredTerm, "Ceramic Coffee Mug");
  assert.deepEqual(projected.titleIdentity?.acceptedTerms, ["Ceramic Coffee Mug"]);
});

test("title identity is not inferred from uncertain image recognition", () => {
  const projected = projectStoreContentProfile(
    CAPOZEN_RUG_PROFILE,
    "ceramic coffee mug",
    "Mug",
    0.79,
  );

  assert.equal(projected.titleIdentity, undefined);
});

test("a confident conflict between Shopify type and image identity requires review", () => {
  const storeProfile = projectStoreContentProfile(
    JEMINISE_BEDDING_PROFILE,
    "wall art",
    "Bedding",
    0.96,
  );
  assert.equal(storeProfile.titleIdentity, undefined);
  assert.deepEqual(storeProfile.titleIdentityConflict, {
    productType: "Bedding",
    physicalProductIdentity: "wall art",
  });

  const facts = createFacts(storeProfile, "wall art");
  const draft = createDraft("Wolf Wall Art");
  assert.throws(
    () => validateFinalContent({
      productTitle: draft.productTitle,
      productDescription: "<p>Red and blue wolves face each other.</p>",
      productSeoTitle: draft.productSeoTitle,
      productSeoDescription: draft.productSeoDescription,
    }, draft, facts, KEYWORDS, CONSTRAINTS),
    /requires manual review/i,
  );
});

test("identity policies match whole product phrases rather than substrings", () => {
  const projected = projectStoreContentProfile(
    PREAUREUM_HANDBAG_PROFILE,
    "garbage bin",
    "Handbag",
    0.96,
  );

  assert.equal(projected.titleIdentity, undefined);
  assert.ok(projected.titleIdentityConflict);
});

test("artwork-only titles are rewritten as product titles within their length limits", () => {
  const bedding = projectStoreContentProfile(
    JEMINISE_BEDDING_PROFILE,
    "quilt bedding set",
    "Bedding",
    0.95,
  ).titleIdentity;
  assert.ok(bedding);

  assert.equal(
    ensureProductIdentityInTitle("Red and Blue Wolves Face-to-Face Artwork", bedding, 80),
    "Red and Blue Wolves Face-to-Face Bedding",
  );
  assert.equal(
    ensureProductIdentityInTitle("Red and Blue Wolves Design | Shop Online", bedding, 45),
    "Red and Blue Wolves Bedding",
  );
  assert.equal(
    ensureProductIdentityInTitle("Red and Blue Wolves Bedding Set", bedding, 80),
    "Red and Blue Wolves Bedding Set",
  );
});

test("identity matching accepts configured aliases but not artwork nouns", () => {
  const rug = projectStoreContentProfile(
    CAPOZEN_RUG_PROFILE,
    "area rug",
    "Rug",
    0.95,
  ).titleIdentity;
  assert.ok(rug);

  assert.equal(hasProductIdentityInTitle("Mandala Rug", rug), true);
  assert.equal(hasProductIdentityInTitle("Mandala Artwork", rug), false);
});

test("final validation rejects product and SEO titles that omit the physical product", () => {
  const storeProfile = projectStoreContentProfile(
    CAPOZEN_RUG_PROFILE,
    "area rug",
    "Rug",
    0.95,
  );
  const facts = createFacts(storeProfile, "area rug");
  const draft = createDraft("Red and Blue Wolves Artwork");
  const result = {
    productTitle: draft.productTitle,
    productDescription: "<p>Red and blue wolves face each other.</p>",
    productSeoTitle: draft.productSeoTitle,
    productSeoDescription: draft.productSeoDescription,
  };

  assert.throws(
    () => validateFinalContent(result, draft, facts, KEYWORDS, CONSTRAINTS),
    /must name the physical product/i,
  );
});

test("final validation allows design wording when both titles still name the product", () => {
  const storeProfile = projectStoreContentProfile(
    PREAUREUM_HANDBAG_PROFILE,
    "structured handbag",
    "Handbag",
    0.95,
  );
  const facts = createFacts(storeProfile, "structured handbag");
  const draft = createDraft("Wolf Design Handbag");
  const result = {
    productTitle: draft.productTitle,
    productDescription: "<p>Red and blue wolves face each other.</p>",
    productSeoTitle: draft.productSeoTitle,
    productSeoDescription: draft.productSeoDescription,
  };

  assert.doesNotThrow(
    () => validateFinalContent(result, draft, facts, KEYWORDS, CONSTRAINTS),
  );
});
