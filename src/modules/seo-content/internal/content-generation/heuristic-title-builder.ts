import type { ContentFactSheet, KeywordAllocation } from "./content-generation-types";
import { fitProductTitle, toTitleCase } from "./content-fitters";

const UNUSABLE_TITLE_PATTERN =
  /^(sku[\b\s\-_].*|copy\s+final.*|product\s+\d+|untitled.*|test\s+.*|sample\s+.*|[a-z0-9_-]{3,10})$/i;

const HIGH_RISK_CLAIM_MODIFIERS: readonly string[] = [
  "distressed",
  "waterproof",
  "water resistant",
  "handmade",
  "handcrafted",
  "genuine leather",
  "real leather",
  "wooden",
  "100% cotton",
  "personalized",
  "customized",
  "hypoallergenic",
  "non-toxic",
  "eco-friendly",
  "sustainable",
];

/**
 * Validates if the original source title is a meaningful, usable retail title
 * rather than a placeholder, SKU, or empty string.
 */
export function isUsableSourceTitle(title: string | undefined): boolean {
  if (!title || typeof title !== "string") {
    return false;
  }
  const trimmed = title.trim();
  if (trimmed.length < 4) {
    return false;
  }
  if (UNUSABLE_TITLE_PATTERN.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Checks if high-risk modifiers inside a keyword are grounded in factual source data,
 * preventing B4 search-intent approval from hallucinating product specifications.
 */
export function isKeywordGroundedForPrimarySurface(
  keyword: string,
  facts: ContentFactSheet,
): boolean {
  const lowerKw = keyword.toLowerCase();
  const corpus = [
    facts.originalTitle,
    facts.originalDescription,
    facts.visualStyle ?? "",
    facts.niche ?? "",
    ...facts.entities,
    ...facts.ocrTexts,
  ]
    .join(" ")
    .toLowerCase();

  for (const modifier of HIGH_RISK_CLAIM_MODIFIERS) {
    const modRegex = new RegExp(`\\b${modifier}\\b`, "i");
    if (modRegex.test(lowerKw) && !modRegex.test(corpus)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a title string already canonically represents the primary keyword.
 */
export function containsCanonicalKeyword(title: string, keyword: string): boolean {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const normKw = keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normKw) return true;

  // Exact phrase match
  if (normTitle.includes(normKw)) return true;

  // All significant words present
  const kwWords = normKw.split(/\s+/).filter((w) => w.length > 2);
  if (kwWords.length === 0) return true;
  return kwWords.every((word) => normTitle.includes(word));
}

/**
 * Merges primary keyword concepts into an existing usable title without duplicating tokens.
 */
export function buildMergedTitle(
  primaryKeyword: string,
  sourceTitle: string,
  facts: ContentFactSheet,
): string {
  const titleWords = new Set(
    sourceTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/),
  );
  const primaryTokens = toTitleCase(primaryKeyword).split(/\s+/);
  const missingPrefixTokens: string[] = [];

  for (const token of primaryTokens) {
    if (!titleWords.has(token.toLowerCase()) && token.length > 2) {
      // Check if token is grounded
      if (isKeywordGroundedForPrimarySurface(token, facts)) {
        missingPrefixTokens.push(token);
      }
    }
  }

  if (missingPrefixTokens.length > 0) {
    return `${missingPrefixTokens.join(" ")} ${sourceTitle}`;
  }

  return sourceTitle;
}

export interface TitleBuilderInput {
  readonly facts: ContentFactSheet;
  readonly keywords: KeywordAllocation;
  readonly maxLength?: number;
}

/**
 * Deterministic heuristic title builder following the Preserve -> Enrich -> Rebuild policy.
 */
export function buildHeuristicProductTitle(input: TitleBuilderInput): string {
  const { facts, keywords, maxLength = 80 } = input;
  const sourceTitle = facts.originalTitle?.trim() ?? "";
  const sourceUsable = isUsableSourceTitle(sourceTitle);
  const primary = keywords.primary?.trim();
  const primaryGrounded = primary
    ? isKeywordGroundedForPrimarySurface(primary, facts)
    : false;

  // Case 1: Source title is usable and already represents primary concept
  if (sourceUsable && (!primary || containsCanonicalKeyword(sourceTitle, primary))) {
    return fitProductTitle(sourceTitle, maxLength);
  }

  // Case 2: Source title is usable, and primary keyword is grounded and adds SEO differentiation
  if (sourceUsable && primary && primaryGrounded) {
    const merged = buildMergedTitle(primary, sourceTitle, facts);
    return fitProductTitle(merged, maxLength);
  }

  // Case 3: Source title is usable (even if primary keyword is ungrounded or absent)
  if (sourceUsable) {
    return fitProductTitle(sourceTitle, maxLength);
  }

  // Case 4: Source title is unusable / placeholder -> Rebuild from grounded primary or facts
  if (primary && primaryGrounded) {
    let title = toTitleCase(primary);
    if (
      facts.personalizationSupported &&
      !/\bpersonal/i.test(title) &&
      !/\bcustom/i.test(title)
    ) {
      title = `Personalized ${title}`;
    }
    return fitProductTitle(title, maxLength);
  }

  // Case 5: No grounded primary keyword -> Rebuild strictly from B1 facts
  let fallbackTitle = toTitleCase(facts.productCategory ?? "Specialty Product");
  if (facts.entities.length > 0) {
    fallbackTitle = `${toTitleCase(facts.entities[0])} ${fallbackTitle}`;
  }
  if (facts.visualStyle && !fallbackTitle.toLowerCase().includes(facts.visualStyle.toLowerCase())) {
    fallbackTitle = `${toTitleCase(facts.visualStyle)} ${fallbackTitle}`;
  }
  if (facts.personalizationSupported) {
    fallbackTitle = `Personalized ${fallbackTitle}`;
  }

  return fitProductTitle(fallbackTitle, maxLength);
}
