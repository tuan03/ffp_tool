import type { SeoStoreProfile } from "../../types";

export const CAPOZEN_RUG_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "capozen-rugs",
  profileVersion: "2.0.0",
  storeId: "capozen",
  storeName: "Capozen",
  locale: "en-US",
  language: "English",
  niche: "Rugs & Doormats",
  brandVoice: Object.freeze(["clear", "warm", "design-led"]),
  contentRules: Object.freeze([
    "Ground every product-specific statement in visible image evidence.",
    "Use the rug or doormat as the product subject and keep room props and scene context separate from product facts.",
    "Describe visible artwork, colors, shapes, and text without treating them as evidence of hidden construction details.",
  ]),
  prohibitedClaims: Object.freeze([
    "Do not infer size, materials, backing, thickness, care instructions, or construction from images alone.",
    "Do not claim non-slip performance, indoor or outdoor suitability, durability, or personalization unless visibly established.",
  ]),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
});
