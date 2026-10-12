import type { SeoStoreProfile } from "../../types";

export const CAPOZEN_RUG_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "capozen-rugs",
  profileVersion: "2.1.0",
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
  productTitleIdentityPolicies: Object.freeze([
    {
      policyId: "capozen-rug-title-identity-v1",
      applicableProductTypes: Object.freeze(["Rug", "Rugs", "Area Rug"]),
      physicalIdentityTerms: Object.freeze(["rug", "area rug", "carpet"]),
      acceptedTitleTerms: Object.freeze(["Rug", "Area Rug"]),
      preferredTitleTerm: "Area Rug",
      minimumIdentityConfidence: 0.8,
    },
    {
      policyId: "capozen-doormat-title-identity-v1",
      applicableProductTypes: Object.freeze(["Doormat", "Door Mat"]),
      physicalIdentityTerms: Object.freeze(["doormat", "door mat"]),
      acceptedTitleTerms: Object.freeze(["Doormat", "Door Mat"]),
      preferredTitleTerm: "Doormat",
      minimumIdentityConfidence: 0.8,
    },
  ]),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
});
