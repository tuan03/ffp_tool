import assert from "node:assert/strict";
import test from "node:test";

import type { SeoContentInput, SeoStoreProfile } from "../types";

import { computeProductInputHash } from "../internal/checkpoint/checkpoint-hasher";
import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";
import { JEMINISE_BEDDING_PROFILE } from "../internal/store-profiles";

const GENERIC_PROFILE: SeoStoreProfile = {
  profileId: "test-profile",
  profileVersion: "2.0.0",
  storeId: "test-store",
  storeName: "Test Store",
  locale: "en-US",
  language: "English",
  niche: "Home Decor",
  brandVoice: ["clear"],
  contentRules: ["Use image evidence only."],
  prohibitedClaims: ["Do not infer hidden attributes."],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
};

function createInput(profile: SeoStoreProfile = GENERIC_PROFILE): SeoContentInput {
  return {
    images: [
      { id: "hero", url: "https://cdn.example.test/hero.webp", contentFingerprint: "sha256:hero" },
      { id: "detail", url: "https://cdn.example.test/detail.webp", contentFingerprint: "sha256:detail" },
    ],
    niche: "bedding",
    storeProfile: profile,
  };
}

test("V2 hash depends only on images, niche and the versioned store profile", () => {
  const input = createInput();
  const legacyDecorated = {
    ...input,
    title: "FORBIDDEN TITLE",
    description: "FORBIDDEN DESCRIPTION",
    handle: "forbidden-handle",
    variants: [{ title: "FORBIDDEN VARIANT" }],
    existingKeywords: ["forbidden keyword"],
  } as unknown as SeoContentInput;

  assert.equal(computeProductInputHash(input), computeProductInputHash(legacyDecorated));
  assert.notEqual(
    computeProductInputHash(input),
    computeProductInputHash({ ...input, niche: "area rugs" }),
  );
  assert.notEqual(
    computeProductInputHash(input),
    computeProductInputHash({
      ...input,
      storeProfile: { ...input.storeProfile, profileVersion: "2.0.1" },
    }),
  );
});

test("B1 sends exactly images and niche to the pixel analyzer and keeps full image coverage", async () => {
  let received: unknown;
  const stage = createB1ProductUnderstandingStage({
    imageAnalyzer: {
      async analyze(input) {
        received = input;
        return {
          typography: { visibleTexts: [], styleSummary: "embroidered" },
          visualEntities: "navy geometric pattern",
          sceneContext: "bedroom",
          physicalProductIdentity: "quilt bedding set",
          identityCandidates: ["quilt bedding set"],
          excludedSceneEntities: ["bed", "lamp"],
          confidence: 0.94,
          reviewRequired: false,
        };
      },
    },
  });

  const input = createInput();
  const output = await stage.execute(createInitialContext(input));
  assert.deepEqual(Object.keys(received as object).sort(), ["images", "niche"]);
  assert.equal((received as { readonly images: readonly unknown[] }).images.length, input.images.length);
  assert.equal(output.productUnderstanding?.physicalProductIdentity, "quilt bedding set");
});

test("B1 fails closed when cross-image identity confidence is low", async () => {
  const stage = createB1ProductUnderstandingStage({
    imageAnalyzer: {
      async analyze() {
        return {
          typography: { visibleTexts: [], styleSummary: "unknown" },
          visualEntities: "mixed room products",
          sceneContext: "bedroom",
          physicalProductIdentity: "bedding",
          identityCandidates: ["quilt", "wall tapestry"],
          excludedSceneEntities: [],
          confidence: 0.55,
          reviewRequired: true,
        };
      },
    },
  });

  await assert.rejects(
    stage.execute(createInitialContext(createInput())),
    /PRODUCT_IDENTITY_AMBIGUOUS/,
  );
});

test("Jeminise three-offering policy is not injected below its identity confidence threshold", () => {
  const input = createInput(JEMINISE_BEDDING_PROFILE);
  const context = evolveContext(createInitialContext(input), {
    productUnderstanding: {
      typography: { visibleTexts: [], styleSummary: "stitched" },
      visualEntities: "blue geometric artwork",
      sceneContext: "bedroom",
      physicalProductIdentity: "quilt bedding set",
      identityCandidates: ["quilt bedding set"],
      excludedSceneEntities: ["lamp"],
      confidence: 0.79,
      reviewRequired: false,
    },
  });

  assert.equal(buildContentFactSheet(context).storeProfile?.bedding, undefined);
  const understanding = context.productUnderstanding;
  assert.ok(understanding);
  const highConfidence = evolveContext(context, {
    productUnderstanding: { ...understanding, confidence: 0.95 },
  });
  assert.deepEqual(
    buildContentFactSheet(highConfidence).storeProfile?.bedding?.options.map((offering) => offering.name),
    ["Comforter", "Quilt", "Duvet Cover"],
  );
});
