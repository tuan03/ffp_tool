import assert from "node:assert/strict";
import test from "node:test";

import {
  computeProductInputHash,
  type SeoContentInput,
  type SeoStoreProfile,
} from "../../src/modules/seo-content";

const storeProfile: SeoStoreProfile = {
  profileId: "jeminise",
  profileVersion: "2",
  storeId: "jeminise",
  storeName: "Jeminise",
  locale: "en-US",
  language: "en",
  niche: "Bedding",
  brandVoice: ["clear"],
  contentRules: ["ground claims in image evidence"],
  prohibitedClaims: ["unsupported materials"],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
};

const baseInput: SeoContentInput = {
  images: [{
    id: "image-1",
    url: "https://cdn.example.test/product.webp",
    contentFingerprint: "sha256:image-v1",
  }],
  niche: "Bedding",
  storeProfile,
};

test("V2 generation hash ignores legacy Shopify metadata outside the semantic contract", () => {
  const firstLegacyEnvelope = {
    ...baseInput,
    title: "FORBIDDEN_TITLE_SENTINEL_A",
    description: "FORBIDDEN_DESCRIPTION_SENTINEL_A",
    handle: "FORBIDDEN_HANDLE_SENTINEL_A",
    productId: "111",
    siteDomain: "first.example.test",
    variants: [{ title: "FORBIDDEN_VARIANT_SENTINEL_A" }],
    existingKeywords: ["FORBIDDEN_KEYWORD_SENTINEL_A"],
  };
  const secondLegacyEnvelope = {
    ...baseInput,
    title: "FORBIDDEN_TITLE_SENTINEL_B",
    description: "FORBIDDEN_DESCRIPTION_SENTINEL_B",
    handle: "FORBIDDEN_HANDLE_SENTINEL_B",
    productId: "222",
    siteDomain: "second.example.test",
    variants: [{ title: "FORBIDDEN_VARIANT_SENTINEL_B" }],
    existingKeywords: ["FORBIDDEN_KEYWORD_SENTINEL_B"],
  };

  assert.equal(
    computeProductInputHash(firstLegacyEnvelope),
    computeProductInputHash(secondLegacyEnvelope),
  );
});

test("V2 generation hash changes with image evidence, niche, or store profile version", () => {
  const baseHash = computeProductInputHash(baseInput);

  assert.notEqual(baseHash, computeProductInputHash({
    ...baseInput,
    images: [{ ...baseInput.images[0], contentFingerprint: "sha256:image-v2" }],
  }));
  assert.notEqual(baseHash, computeProductInputHash({
    ...baseInput,
    niche: "Home Decor",
  }));
  assert.notEqual(baseHash, computeProductInputHash({
    ...baseInput,
    storeProfile: { ...storeProfile, profileVersion: "3" },
  }));
});
