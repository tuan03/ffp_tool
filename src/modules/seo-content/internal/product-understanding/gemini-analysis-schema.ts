import type { ProductImageAnalysis } from "./product-image-analyzer";

export const GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "ocrTexts",
    "detectedEntities",
    "dominantColors",
    "visualStyle",
    "productCategory",
  ],
  properties: {
    ocrTexts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "string",
      },
    },
    detectedEntities: {
      type: "array",
      maxItems: 12,
      items: {
        type: "string",
      },
    },
    dominantColors: {
      type: "array",
      maxItems: 6,
      items: {
        type: "string",
      },
    },
    visualStyle: {
      type: "string",
    },
    productCategory: {
      type: "string",
    },
  },
} as const;

export class GeminiSchemaValidationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeminiSchemaValidationError";
  }
}

const ALLOWED_SCHEMA_PROPERTIES: ReadonlySet<string> = new Set([
  "ocrTexts",
  "detectedEntities",
  "dominantColors",
  "visualStyle",
  "productCategory",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cleanStringList(list: readonly unknown[]): readonly string[] {
  const result: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
  }
  return Object.freeze(result);
}

/**
 * Parses and validates Gemini JSON output against the ProductImageAnalysis schema.
 * Enforces additionalProperties: false, type guards, and performs safe sanitization.
 */
export function parseGeminiProductImageAnalysis(raw: unknown): ProductImageAnalysis {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    let text = raw.trim();
    if (!text) {
      throw new GeminiSchemaValidationError("Gemini response text is empty");
    }
    // Strip markdown code fences if present (e.g. ```json\n{...}\n```)
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    }
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new GeminiSchemaValidationError(
        `Failed to parse Gemini JSON response: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  if (!isRecord(parsed)) {
    throw new GeminiSchemaValidationError("Gemini structured response must be an object");
  }

  // Enforce additionalProperties: false
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_SCHEMA_PROPERTIES.has(key)) {
      throw new GeminiSchemaValidationError(
        `Unexpected property '${key}' in Gemini structured response (additionalProperties: false violation)`,
      );
    }
  }

  if (!("ocrTexts" in parsed) || !isStringArray(parsed.ocrTexts)) {
    throw new GeminiSchemaValidationError("Missing or invalid 'ocrTexts' array in Gemini response");
  }

  if (!("detectedEntities" in parsed) || !isStringArray(parsed.detectedEntities)) {
    throw new GeminiSchemaValidationError("Missing or invalid 'detectedEntities' array in Gemini response");
  }

  if (!("dominantColors" in parsed) || !isStringArray(parsed.dominantColors)) {
    throw new GeminiSchemaValidationError("Missing or invalid 'dominantColors' array in Gemini response");
  }

  if (!("visualStyle" in parsed) || typeof parsed.visualStyle !== "string") {
    throw new GeminiSchemaValidationError("Missing or invalid 'visualStyle' string in Gemini response");
  }

  if (!("productCategory" in parsed) || typeof parsed.productCategory !== "string") {
    throw new GeminiSchemaValidationError("Missing or invalid 'productCategory' string in Gemini response");
  }

  const ocrTexts = cleanStringList(parsed.ocrTexts);
  const detectedEntities = cleanStringList(parsed.detectedEntities);
  const dominantColors = cleanStringList(parsed.dominantColors);
  const visualStyle = parsed.visualStyle.trim() || "unspecified";
  const productCategory = parsed.productCategory.trim() || "unknown";

  return Object.freeze({
    ocrTexts,
    detectedEntities,
    dominantColors,
    visualStyle,
    productCategory,
  });
}
