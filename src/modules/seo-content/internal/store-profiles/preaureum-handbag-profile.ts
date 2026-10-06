import type { SeoStoreProfile } from "../../types";

export const PREAUREUM_HANDBAG_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "preaureum-handbags",
  profileVersion: "2.0.0",
  storeId: "preaureum",
  storeName: "Preaureum",
  locale: "en-US",
  language: "English",
  niche: "Personalized Handbags & Wallets",
  brandVoice: Object.freeze(["clear", "warm", "design-led"]),
  contentRules: Object.freeze([
    "Ground every product-specific statement in visible image evidence.",
    "Treat the handbag as the primary product and describe a matching wallet or accessory only when it is visibly present.",
    "Describe visible artwork, colors, shapes, carrying style, and readable personalization without inferring hidden product details.",
  ]),
  prohibitedClaims: Object.freeze([
    "Do not infer material, size, capacity, compartments, closure, construction, care instructions, or durability from images alone.",
    "Do not claim personalization options, included accessories, genuine leather, or specific practical benefits unless visibly established.",
  ]),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
});
