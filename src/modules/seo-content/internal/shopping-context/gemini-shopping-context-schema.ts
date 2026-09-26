export const GEMINI_SHOPPING_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "targetAudience",
    "suitableOccasions",
    "useCases",
    "buyerIntentKeywords",
  ],
  properties: {
    targetAudience: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string" },
    },
    suitableOccasions: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string" },
    },
    useCases: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string" },
    },
    buyerIntentKeywords: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: { type: "string" },
    },
    contextualAudienceHints: { type: "array", maxItems: 3, items: { type: "string" } },
    sceneSearchSeeds: { type: "array", maxItems: 5, items: { type: "string" } },
  },
} as const;
