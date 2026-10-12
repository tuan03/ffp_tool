import type { SeoStoreProfile } from "../../types";

export const PREAUREUM_HANDBAG_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "preaureum-handbags",
  profileVersion: "2.2.0",
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
    "Write the Shopify product description only about the visible artwork, distinctive visual details, aesthetic appeal, and grounded reasons the design may interest a shopper.",
    "Do not mention materials, dimensions, care, construction, capacity, compartments, closures, straps, or handbag and wallet formats in the Shopify product description.",
  ]),
  prohibitedClaims: Object.freeze([
    "Do not infer material, size, capacity, compartments, closure, construction, care instructions, or durability from images alone.",
    "Do not claim personalization options, included accessories, genuine leather, or specific practical benefits unless visibly established.",
  ]),
  productDescriptionPolicy: Object.freeze({
    mode: "visual-design-only" as const,
    excludedTopics: Object.freeze([
      "materials and fabric",
      "sizes, dimensions, and capacity",
      "care and construction",
      "handbag, wallet, purse, tote, and other product formats",
    ]),
  }),
  productTitleIdentityPolicies: Object.freeze([
    {
      policyId: "preaureum-handbag-title-identity-v1",
      applicableProductTypes: Object.freeze(["Handbag", "Handbags", "Bag"]),
      physicalIdentityTerms: Object.freeze([
        "handbag",
        "bag",
        "tote",
        "purse",
        "crossbody",
        "satchel",
      ]),
      acceptedTitleTerms: Object.freeze([
        "Handbag",
        "Bag",
        "Tote Bag",
        "Purse",
        "Crossbody Bag",
        "Shoulder Bag",
        "Satchel",
      ]),
      preferredTitleTerm: "Handbag",
      minimumIdentityConfidence: 0.8,
    },
    {
      policyId: "preaureum-wallet-title-identity-v1",
      applicableProductTypes: Object.freeze(["Wallet", "Wallets"]),
      physicalIdentityTerms: Object.freeze(["wallet", "card holder"]),
      acceptedTitleTerms: Object.freeze(["Wallet", "Card Holder"]),
      preferredTitleTerm: "Wallet",
      minimumIdentityConfidence: 0.8,
    },
  ]),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
});
