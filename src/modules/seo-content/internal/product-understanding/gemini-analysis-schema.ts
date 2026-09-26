import type { ProductImageAnalysis } from "./product-image-analyzer";

export const GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "typography",
    "visualEntities",
    "sceneContext",
    "physicalProductIdentity",
  ],
  properties: {
    typography: {
      type: "object",
      additionalProperties: false,
      required: ["visibleTexts", "styleSummary"],
      properties: {
        visibleTexts: { type: "array", maxItems: 20, items: { type: "string" } },
        styleSummary: { type: "string" },
      },
    },
    visualEntities: { type: "string" },
    sceneContext: { type: "string" },
    physicalProductIdentity: { type: "string" },
  },
} as const;

export class GeminiSchemaValidationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeminiSchemaValidationError";
  }
}

const ALLOWED_SCHEMA_PROPERTIES: ReadonlySet<string> = new Set([
  "typography",
  "visualEntities",
  "sceneContext",
  "physicalProductIdentity",
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

  if (!("typography" in parsed) || !isRecord(parsed.typography)) {
    throw new GeminiSchemaValidationError("Missing or invalid 'typography' object in Gemini response");
  }
  if (Object.keys(parsed.typography).some((key) => key !== "visibleTexts" && key !== "styleSummary")) {
    throw new GeminiSchemaValidationError("Unexpected property in 'typography' object");
  }
  if (!isStringArray(parsed.typography.visibleTexts) || typeof parsed.typography.styleSummary !== "string") {
    throw new GeminiSchemaValidationError("Missing or invalid typography fields in Gemini response");
  }
  for (const field of ["visualEntities", "sceneContext", "physicalProductIdentity"] as const) {
    if (!(field in parsed) || typeof parsed[field] !== "string") {
      throw new GeminiSchemaValidationError(`Missing or invalid '${field}' string in Gemini response`);
    }
  }

  const visualEntities = parsed.visualEntities;
  const sceneContext = parsed.sceneContext;
  const physicalProductIdentity = parsed.physicalProductIdentity;
  if (typeof visualEntities !== "string" || typeof sceneContext !== "string" || typeof physicalProductIdentity !== "string") {
    throw new GeminiSchemaValidationError("Invalid product evidence response");
  }

  return Object.freeze({
    typography: Object.freeze({
      visibleTexts: cleanStringList(parsed.typography.visibleTexts),
      styleSummary: parsed.typography.styleSummary.trim() || "unknown",
    }),
    visualEntities: visualEntities.trim() || "unknown",
    sceneContext: sceneContext.trim() || "unknown",
    physicalProductIdentity: physicalProductIdentity.trim() || "unknown",
  });
}
