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
    styleOptions: {
      type: "ARRAY",
      description:
        "Optional list of style options (e.g. Comforter, Quilt, Duvet Cover) when specified by the store profile offering.",
      items: {
        type: "OBJECT",
        properties: {
          name: {
            type: "STRING",
            description: "Option style name, e.g. 'Comforter', 'Quilt', or 'Duvet Cover'.",
          },
          description: {
            type: "STRING",
            description: "Concise summary of the style's distinctive construction and feel.",
          },
        },
        required: ["name", "description"],
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
    aeo_quick_summary: {
      type: "STRING",
      description:
        "Fact-dense, concise 40-70 word summary highlighting specific design entities, materials, dimensions, and ideal use case for AI search overviews.",
    },
    aeo_faq: {
      type: "ARRAY",
      description:
        "Exactly 4 strategic Q&A pairs (Q1: pre-purchase intent/how to choose; Q2: practical usability/durability; Q3: customization if supported, otherwise care/sizing; Q4: unique selling proposition/differentiation).",
      items: {
        type: "OBJECT",
        properties: {
          question: {
            type: "STRING",
            description: "Clear, customer-centric question targeting search intent.",
          },
          answer: {
            type: "STRING",
            description: "Direct answer-first response grounded strictly in product facts.",
          },
        },
        required: ["question", "answer"],
      },
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
    "aeo_quick_summary",
    "aeo_faq",
  ],
};
