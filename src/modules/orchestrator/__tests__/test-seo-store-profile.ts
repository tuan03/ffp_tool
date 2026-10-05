import type { SeoStoreProfile } from "../../seo-content";

export const TEST_SEO_STORE_PROFILE: SeoStoreProfile = {
  profileId: "orchestrator-test",
  profileVersion: "2",
  storeId: "test-store",
  storeName: "Test Store",
  locale: "en-US",
  language: "en",
  niche: "Test Products",
  brandVoice: ["clear"],
  contentRules: ["Use image evidence only"],
  prohibitedClaims: ["Unsupported product facts"],
  seoConstraints: {
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  },
};
