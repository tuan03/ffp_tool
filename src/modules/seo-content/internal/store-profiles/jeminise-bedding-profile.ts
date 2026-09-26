import type { StoreContentProfile } from "./types";

export const JEMINISE_BEDDING_PROFILE: StoreContentProfile = Object.freeze({
  storeId: "jeminise",
  storeName: "Jeminise",
  domainAliases: Object.freeze(["jeminise.com", "b6-theme-test.myshopify.com"]),
  niche: "Bedding & Home Decor",
  bedding: Object.freeze({
    options: Object.freeze([
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
    fabricMaterial: "Premium ultra-soft brushed microfiber, breathable and hypoallergenic",
    printTechnology: "High-definition thermal dye-sublimation for vibrant, fade-resistant color",
    careGuidance: "Machine wash cold on gentle cycle, tumble dry low heat",
  }),
  descriptionGuidelines: Object.freeze([
    "Do NOT force Comforter, Quilt, or Duvet Cover into the product title; title must focus on artwork and variant.",
    "MUST include a dedicated section in product description clearly explaining the 3 available styles (Comforter, Quilt, Duvet Cover).",
    "Highlight premium microfiber fabric, vibrant sublimation print, and easy machine care.",
  ]),
  seoDescriptionGuidelines: Object.freeze({
    mandatoryKeywords: Object.freeze(["Comforter", "Quilt", "Duvet Cover"]),
    maxCharacters: 160,
  }),
});
