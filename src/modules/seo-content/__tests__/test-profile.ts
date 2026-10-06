import type { SeoContentOutput, SeoStoreProfile } from "../types";

export const TEST_STORE_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "test-store-profile",
  profileVersion: "2.0.0",
  storeId: "test-store",
  storeName: "Test Store",
  locale: "en-US",
  language: "English",
  niche: "Home Decor",
  brandVoice: Object.freeze(["clear", "warm"]),
  contentRules: Object.freeze(["Use visible image evidence only."]),
  prohibitedClaims: Object.freeze(["Do not infer hidden product attributes."]),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
});

export const TEST_SEO_OUTPUT: SeoContentOutput = Object.freeze({
  productTitle: "Grounded Product Title",
  productDescription: "<p>Grounded product description.</p>",
  productSeoTitle: "Grounded Product Title",
  productSeoDescription: "Grounded product description based on visible image evidence.",
  images: Object.freeze([]),
});
