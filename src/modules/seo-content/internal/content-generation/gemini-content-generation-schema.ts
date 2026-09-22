/**
 * Structured JSON Schema for Gemini Vertex AI response when generating SEO product content.
 * Compatible with @google/genai responseJsonSchema.
 */
export const GEMINI_CONTENT_DRAFT_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    productTitle: {
      type: "STRING",
      description:
        "Compelling, clear e-commerce product title (45-80 characters). Must naturally incorporate the primary keyword if provided.",
    },
    intro: {
      type: "STRING",
      description:
        "Engaging introduction paragraph describing the product's aesthetic, theme, and main appeal without hyperbole.",
    },
    bullets: {
      type: "ARRAY",
      description: "2 to 5 structured bullets covering features, design, and benefits.",
      items: {
        type: "OBJECT",
        properties: {
          label: {
            type: "STRING",
            description: "Short category label such as 'Design', 'Style', 'Made for', or 'Personalization'.",
          },
          text: {
            type: "STRING",
            description: "Factual benefit or specification sentence.",
          },
        },
        required: ["label", "text"],
      },
    },
    guidance: {
      type: "ARRAY",
      description:
        "Optional care or usage guidance strictly backed by source facts. Empty array if none in source.",
      items: {
        type: "STRING",
      },
    },
    closing: {
      type: "STRING",
      description: "Closing summary paragraph highlighting gifting or lifestyle appeal.",
    },
    productSeoTitle: {
      type: "STRING",
      description:
        "SEO title tag strictly <= 70 characters. Must start with or contain the primary focus keyword.",
    },
    productSeoDescription: {
      type: "STRING",
      description:
        "SEO meta description strictly <= 160 characters. Clear summary with natural click appeal.",
    },
  },
  required: [
    "productTitle",
    "intro",
    "bullets",
    "guidance",
    "closing",
    "productSeoTitle",
    "productSeoDescription",
  ],
};
