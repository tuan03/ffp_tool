import type { SeoStoreProfile } from "../../types";

export const JEMINISE_BEDDING_PROFILE: SeoStoreProfile = Object.freeze({
  profileId: "jeminise-bedding",
  profileVersion: "2.1.0",
  storeId: "jeminise",
  storeName: "Jeminise",
  locale: "en-US",
  language: "English",
  niche: "Bedding & Home Decor",
  brandVoice: Object.freeze(["clear", "warm", "design-led"]),
  contentRules: Object.freeze([
    "Ground every product-specific statement in visible image evidence.",
    "Keep room props and scene context separate from product facts.",
    "Write the Shopify product description only about the visible artwork, distinctive visual details, aesthetic appeal, and grounded reasons the design may interest a shopper.",
    "Do not mention materials, dimensions, care, construction, product formats, or Comforter, Quilt, Duvet Cover, or Blanket in the Shopify product description.",
  ]),
  prohibitedClaims: Object.freeze([
    "Do not infer size, materials, care, construction, or personalization from images alone.",
    "Do not treat store identity as evidence that a catalog policy applies.",
  ]),
  productDescriptionPolicy: Object.freeze({
    mode: "visual-design-only" as const,
    excludedTopics: Object.freeze([
      "materials and fabric",
      "sizes and dimensions",
      "care and construction",
      "Comforter, Quilt, Duvet Cover, Blanket, and other product formats",
    ]),
  }),
  seoConstraints: Object.freeze({
    maxTitleCharacters: 70,
    maxDescriptionCharacters: 160,
    maxAltCharacters: 125,
  }),
  catalogPolicies: Object.freeze([{
    policyId: "jeminise-three-bedding-offerings-v2",
    applicableNiches: Object.freeze(["bedding", "bedroom decor"]),
    productIdentityTerms: Object.freeze(["bedding", "bed cover", "comforter", "quilt", "duvet cover", "bedding set"]),
    minimumIdentityConfidence: 0.8,
    offerings: Object.freeze([
      {
        name: "Comforter",
        shortDescription: "Plush all-season warmth",
        detailedFeatures: "Thick, cozy, and filled with fluffy batting for cloud-like warmth and ultimate comfort.",
      },
      {
        name: "Quilt",
        shortDescription: "Lightweight classic diamond stitching",
        detailedFeatures: "Lightweight coverlet with intricate stitching, perfect for warmer months or stylish bed layering.",
      },
      {
        name: "Duvet Cover",
        shortDescription: "Zippered protective casing",
        detailedFeatures: "Soft, breathable casing with hidden zipper closure and interior corner ties to securely encase your existing insert.",
      },
    ]),
    allowedClaims: Object.freeze([
      "material: Premium ultra-soft brushed microfiber, breathable and hypoallergenic",
      "print: High-definition thermal dye-sublimation for vibrant, fade-resistant color",
      "care: Machine washable: machine wash cold on gentle cycle, tumble dry low heat",
    ]),
    requiredContentRules: Object.freeze([
      "Do NOT force Comforter, Quilt, or Duvet Cover into the product title; title must focus on artwork and variant.",
      "The Shopify product description must focus exclusively on the visible design and its distinctive aesthetic appeal.",
      "Do not include materials, sizes, care, construction, or product-format comparisons in the Shopify product description.",
    ]),
  }]),
});
