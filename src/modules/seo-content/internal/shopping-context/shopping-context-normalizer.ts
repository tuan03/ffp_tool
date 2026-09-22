import type { ShoppingContext } from "../domain-types";

export class ShoppingContextSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingContextSchemaValidationError";
  }
}

export const BANNED_INTENT_TERMS: readonly string[] = [
  "best",
  "cheap",
  "sale",
  "near me",
  "ideas",
  "amazon",
  "etsy",
  "ebay",
  "walmart",
  "aliexpress",
  "temu",
];

const BANNED_REGEXES: readonly RegExp[] = BANNED_INTENT_TERMS.map(
  (term) =>
    new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    ),
);

const REQUIRED_KEYS: readonly (keyof ShoppingContext)[] = [
  "targetAudience",
  "suitableOccasions",
  "useCases",
  "buyerIntentKeywords",
];

const BOUNDS: Record<keyof ShoppingContext, { min: number; max: number }> = {
  targetAudience: { min: 1, max: 8 },
  suitableOccasions: { min: 1, max: 6 },
  useCases: { min: 1, max: 6 },
  buyerIntentKeywords: { min: 1, max: 12 },
};

export function cleanRawJsonText(raw: string): string {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
    cleaned = cleaned.trim();
  }
  return cleaned;
}

export function deduplicateAndNormalizeList(
  items: readonly string[],
  filterBannedTerms: boolean = false,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;

    if (filterBannedTerms) {
      const containsBanned = BANNED_REGEXES.some((regex) =>
        regex.test(trimmed),
      );
      if (containsBanned) {
        continue;
      }
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

export function parseAndNormalizeShoppingContext(
  input: unknown,
): ShoppingContext {
  let parsed: unknown = input;

  if (typeof input === "string") {
    const cleaned = cleanRawJsonText(input);
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ShoppingContextSchemaValidationError(
        `Failed to parse ShoppingContext JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ShoppingContextSchemaValidationError(
      "ShoppingContext payload must be a non-null object",
    );
  }

  const record = parsed as Record<string, unknown>;

  // Enforce additionalProperties: false
  for (const key of Object.keys(record)) {
    if (!REQUIRED_KEYS.includes(key as keyof ShoppingContext)) {
      throw new ShoppingContextSchemaValidationError(
        `Unexpected property '${key}' not allowed in ShoppingContext schema`,
      );
    }
  }

  // Check all required keys exist
  for (const key of REQUIRED_KEYS) {
    if (!(key in record) || record[key] === undefined || record[key] === null) {
      throw new ShoppingContextSchemaValidationError(
        `Missing required property '${key}' in ShoppingContext schema`,
      );
    }
    if (!Array.isArray(record[key])) {
      throw new ShoppingContextSchemaValidationError(
        `Property '${key}' must be an array of strings`,
      );
    }
    for (const item of record[key] as unknown[]) {
      if (typeof item !== "string") {
        throw new ShoppingContextSchemaValidationError(
          `All items in '${key}' must be strings, received: ${typeof item}`,
        );
      }
    }
  }

  const targetAudience = deduplicateAndNormalizeList(
    record.targetAudience as string[],
  );
  const suitableOccasions = deduplicateAndNormalizeList(
    record.suitableOccasions as string[],
  );
  const useCases = deduplicateAndNormalizeList(
    record.useCases as string[],
  );
  const buyerIntentKeywords = deduplicateAndNormalizeList(
    record.buyerIntentKeywords as string[],
    true,
  );

  // Validate bounds
  validateBounds("targetAudience", targetAudience, BOUNDS.targetAudience);
  validateBounds("suitableOccasions", suitableOccasions, BOUNDS.suitableOccasions);
  validateBounds("useCases", useCases, BOUNDS.useCases);
  validateBounds("buyerIntentKeywords", buyerIntentKeywords, BOUNDS.buyerIntentKeywords);

  return {
    targetAudience,
    suitableOccasions,
    useCases,
    buyerIntentKeywords,
  };
}

function validateBounds(
  fieldName: keyof ShoppingContext,
  items: readonly string[],
  bounds: { min: number; max: number },
): void {
  if (items.length < bounds.min) {
    throw new ShoppingContextSchemaValidationError(
      `Field '${fieldName}' has ${items.length} items, which is below minItems ${bounds.min}`,
    );
  }
  if (items.length > bounds.max) {
    throw new ShoppingContextSchemaValidationError(
      `Field '${fieldName}' has ${items.length} items, which exceeds maxItems ${bounds.max}`,
    );
  }
}
