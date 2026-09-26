import { GeminiGeneratorError } from "../product-understanding/gemini-content-generator";
import { QUERY_SOURCE } from "./query-source";
import { canonicalKey, normalizeSuggestionQuery } from "./search-suggestions-normalizer";

import type { GeminiContentGenerator } from "../product-understanding/gemini-content-generator";
import type {
  SearchQueryVariantGenerator,
  SearchQueryVariantGeneratorInput,
  SearchQueryVariantGroup,
} from "./search-query-variant-generator";

export const MAX_GEMINI_VARIANTS_PER_SEED = 2;

export const GEMINI_SEARCH_QUERY_VARIANTS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["variantGroups"],
  properties: {
    variantGroups: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["seedIndex", "variants"],
        properties: {
          seedIndex: { type: "integer", minimum: 0, maximum: 5 },
          variants: {
            type: "array",
            maxItems: MAX_GEMINI_VARIANTS_PER_SEED,
            items: { type: "string" },
          },
        },
      },
    },
  },
};

export const GEMINI_SEARCH_QUERY_VARIANTS_SYSTEM_INSTRUCTION = `You generate safe Google Autocomplete probe queries for ecommerce search research.

Each probe is only a discovery query. It is not an SEO keyword and must never be presented as one.

For each supplied seed:
- Return at most two concise search-prefix probes.
- Use only a non-empty, order-preserving subset of that seed's own tokens.
- End every probe with an incomplete prefix of a later token from that same seed. Keep at least two characters of the final prefix.
- Never return the complete seed, an exact duplicate, a synonym, a new attribute, a marketplace term, a location, a price, a claim, or scene/background terminology.
- Prefer a natural buyer search prefix. For example, for "personalized music player rug", useful probes can be "music player ru" and "music ru".
- If no safe probe exists, return an empty variants array for that seed.

Return JSON only, matching the supplied schema.`;

export interface GeminiSearchQueryVariantGeneratorOptions {
  readonly generator: GeminiContentGenerator;
  readonly model?: string;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokensFor(query: string): readonly string[] {
  return canonicalKey(query).split(/\s+/).filter(Boolean);
}

function isOrderedPrefixSubset(variant: string, seed: string): boolean {
  const variantTokens = tokensFor(variant);
  const seedTokens = tokensFor(seed);

  if (variantTokens.length < 2 || seedTokens.length === 0) {
    return false;
  }

  const finalPrefix = variantTokens.at(-1);
  if (!finalPrefix || finalPrefix.length < 2) {
    return false;
  }

  let seedCursor = 0;
  for (const completeToken of variantTokens.slice(0, -1)) {
    while (seedCursor < seedTokens.length && seedTokens[seedCursor] !== completeToken) {
      seedCursor++;
    }
    if (seedCursor === seedTokens.length) {
      return false;
    }
    seedCursor++;
  }

  return seedTokens.slice(seedCursor).some(
    (seedToken) =>
      seedToken.startsWith(finalPrefix) && seedToken.length > finalPrefix.length,
  );
}

function parseVariantGroups(
  rawText: string,
  seeds: readonly string[],
): readonly SearchQueryVariantGroup[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    throw new GeminiGeneratorError("Gemini search query variant response was not valid JSON");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.variantGroups)) {
    throw new GeminiGeneratorError("Gemini search query variant response did not match the expected schema");
  }

  const variantsBySeedIndex = new Map<number, string[]>();
  for (const group of parsed.variantGroups) {
    if (!isRecord(group)) {
      continue;
    }

    const rawSeedIndex = group.seedIndex;
    const rawVariants = group.variants;
    if (
      typeof rawSeedIndex !== "number" ||
      !Number.isInteger(rawSeedIndex) ||
      !Array.isArray(rawVariants)
    ) {
      continue;
    }

    const seedIndex = rawSeedIndex;
    if (seedIndex < 0 || seedIndex >= seeds.length || variantsBySeedIndex.has(seedIndex)) {
      continue;
    }

    const seed = seeds[seedIndex];
    const seedKey = canonicalKey(seed);
    const seenVariantKeys = new Set<string>();
    const variants: string[] = [];

    for (const rawVariant of rawVariants) {
      if (typeof rawVariant !== "string" || variants.length >= MAX_GEMINI_VARIANTS_PER_SEED) {
        continue;
      }

      const normalized = normalizeSuggestionQuery(rawVariant);
      if (!normalized || canonicalKey(normalized) === seedKey || !isOrderedPrefixSubset(normalized, seed)) {
        continue;
      }

      const key = canonicalKey(normalized);
      if (seenVariantKeys.has(key)) {
        continue;
      }

      seenVariantKeys.add(key);
      variants.push(normalized);
    }

    variantsBySeedIndex.set(seedIndex, variants);
  }

  return seeds.map((seed, seedIndex) => ({
    seedQuery: seed,
    variants: variantsBySeedIndex.get(seedIndex) ?? [],
  }));
}

export class GeminiSearchQueryVariantGenerator
  implements SearchQueryVariantGenerator
{
  private readonly generator: GeminiContentGenerator;
  private readonly model?: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiSearchQueryVariantGeneratorOptions) {
    this.generator = options.generator;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 12000;
  }

  async generate(
    input: SearchQueryVariantGeneratorInput,
  ): Promise<readonly SearchQueryVariantGroup[]> {
    const eligibleSeeds = input.seeds.filter(
      (seed) => seed.source !== QUERY_SOURCE.SCENE_CONTEXT_SEED,
    );
    if (eligibleSeeds.length === 0) {
      return [];
    }

    if (!this.generator.generateStructuredText) {
      throw new GeminiGeneratorError(
        "Underlying GeminiContentGenerator does not implement generateStructuredText",
      );
    }

    const response = await this.generator.generateStructuredText({
      prompt: this.buildPrompt(input, eligibleSeeds.map((seed) => seed.query)),
      systemInstruction: GEMINI_SEARCH_QUERY_VARIANTS_SYSTEM_INSTRUCTION,
      responseJsonSchema: GEMINI_SEARCH_QUERY_VARIANTS_SCHEMA,
      model: this.model,
      timeoutMs: this.timeoutMs,
      temperature: 0,
      thinkingBudget: 0,
      maxOutputTokens: 512,
    });

    return parseVariantGroups(
      response.rawText,
      eligibleSeeds.map((seed) => seed.query),
    );
  }

  buildPrompt(
    input: SearchQueryVariantGeneratorInput,
    eligibleSeeds: readonly string[],
  ): string {
    const typography = input.productUnderstanding?.typography.visibleTexts.join(", ") || "none";
    const buyerIntentKeywords = input.shoppingContext?.buyerIntentKeywords.join(", ") || "none";

    return `Create safe Google Autocomplete probes for the selected product-grounded seed keywords.

PRODUCT CONTEXT
Niche: ${input.source.niche || "unspecified"}
Title: ${input.source.title || "unspecified"}
Physical product identity: ${input.productUnderstanding?.physicalProductIdentity || "unknown"}
Typography: ${typography}
Visual entities: ${input.productUnderstanding?.visualEntities || "unknown"}
Buyer-intent seeds: ${buyerIntentKeywords}

Do not use scene context or any background/environment information.

SEEDS
${eligibleSeeds.map((seed, index) => `${index}. ${seed}`).join("\n")}`;
  }
}
