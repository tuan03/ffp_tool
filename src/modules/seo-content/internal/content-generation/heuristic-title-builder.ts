import type { ContentFactSheet, KeywordAllocation } from "./content-generation-types";
import { fitProductTitle, toTitleCase } from "./content-fitters";

const UNUSABLE_TITLE_PATTERN =
  /^(sku[\b\s\-_].*|copy\s+final.*|product\s+\d+|untitled.*|test\s+.*|sample\s+.*|design\s*(#|\d+).*|[a-z0-9_-]{3,10})$/i;

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
    facts.typographyStyleSummary ?? "",
    facts.niche ?? "",
    facts.visualEntities ?? "",
    ...facts.typographyVisibleTexts,
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

const PLACEHOLDER_PATTERN = /^(unknown|none|n\/a|not applicable|unspecified|sample|test|sku.*)[\s.]*$/i;

export function extractVisionDesignConcept(facts: {
  readonly typographyVisibleTexts?: readonly string[];
  readonly visualEntities?: string;
}): string | undefined {
  const rawTexts = Array.isArray(facts.typographyVisibleTexts) ? facts.typographyVisibleTexts : [];
  const visibleTexts = rawTexts.filter(
    (t) =>
      typeof t === "string" &&
      t.trim().length >= 2 &&
      !PLACEHOLDER_PATTERN.test(t.trim()),
  );
  const prominentText = visibleTexts.length > 0 ? visibleTexts[0].trim().replace(/[.]+$/, "") : undefined;

  const rawEntities = typeof facts.visualEntities === "string" ? facts.visualEntities.trim() : undefined;
  const hasSpecificEntities =
    Boolean(rawEntities) &&
    !PLACEHOLDER_PATTERN.test(rawEntities ?? "") &&
    (rawEntities?.length ?? 0) >= 3;

  if (!prominentText && !hasSpecificEntities) {
    return undefined;
  }

  let entityPhrase: string | undefined;
  if (hasSpecificEntities && rawEntities) {
    let phrase = rawEntities.split(/[.;]/)[0].trim();
    phrase = phrase.replace(/\s+(illustration|artwork|graphic|design|pattern)$/i, "").trim();
    if (phrase.length > 0 && !PLACEHOLDER_PATTERN.test(phrase)) {
      entityPhrase = toTitleCase(phrase);
    }
  }

  if (prominentText && entityPhrase) {
    if (!entityPhrase.toLowerCase().includes(prominentText.toLowerCase())) {
      const cleanProminent = toTitleCase(prominentText);
      return `${cleanProminent} ${entityPhrase}`;
    }
    return entityPhrase;
  }

  if (entityPhrase) {
    return entityPhrase;
  }

  if (prominentText) {
    return toTitleCase(prominentText);
  }

  return undefined;
}

export function titleContainsVisionConcept(title: string, visionConcept: string): boolean {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const visionWords = visionConcept
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(with|and|the|for|from|into|onto|over)$/.test(w));

  if (visionWords.length === 0) return true;
  const matchCount = visionWords.filter((w) => normTitle.includes(w)).length;
  return matchCount >= Math.ceil(visionWords.length * 0.6);
}

export function enrichTitleWithVisionConcept(
  baseTitle: string,
  visionConcept: string,
): string {
  if (titleContainsVisionConcept(baseTitle, visionConcept)) {
    return baseTitle;
  }

  // 1. Clean generic pattern suffixes from baseTitle: e.g. " - Pattern 01", " - Style A"
  let cleanTitle = baseTitle
    .replace(/\s*-\s*(pattern|style|design|color|option|model)\s*([a-z0-9_-]+).*$/i, "")
    .trim();

  // Clean generic filler like "with Pillowcases" if present
  let secondaryFeature = "";
  if (/\bwith\s+pillowcases\b/i.test(cleanTitle)) {
    cleanTitle = cleanTitle.replace(/\s*with\s+pillowcases\b/i, "").trim();
    if (!/quilt|comforter/i.test(cleanTitle)) {
      secondaryFeature = " - Quilt Comforter";
    }
  }

  // 2. Avoid duplicating words between first theme/brand word and visionConcept
  const titleWords = cleanTitle.split(/\s+/);
  const firstWord = titleWords[0] ?? "";
  let cleanConcept = visionConcept;
  if (firstWord && firstWord.length > 2) {
    const wordPattern = new RegExp(`(^|\\s)${firstWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
    cleanConcept = cleanConcept.replace(wordPattern, " ").replace(/\s{2,}/g, " ").trim();
    cleanConcept = cleanConcept.replace(/^[^a-z0-9]+/i, "").trim();
  }

  if (!cleanConcept) {
    return cleanTitle;
  }

  // 3. Insert visionConcept after first theme/brand word, or prefix
  if (titleWords.length > 1) {
    const remainder = titleWords.slice(1).join(" ");
    return `${firstWord} ${cleanConcept} ${remainder}${secondaryFeature}`;
  }

  return `${cleanConcept} ${cleanTitle}${secondaryFeature}`;
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

  let baseTitle: string;
  // Case 1: Source title is usable and already represents primary concept
  if (sourceUsable && (!primary || containsCanonicalKeyword(sourceTitle, primary))) {
    baseTitle = sourceTitle;
  } else if (sourceUsable && primary && primaryGrounded) {
    // Case 2: Source title is usable, and primary keyword is grounded and adds SEO differentiation
    baseTitle = buildMergedTitle(primary, sourceTitle, facts);
  } else if (sourceUsable) {
    // Case 3: Source title is usable (even if primary keyword is ungrounded or absent)
    baseTitle = sourceTitle;
  } else if (primary && primaryGrounded) {
    // Case 4: Source title is unusable / placeholder -> Rebuild from grounded primary or facts
    let title = toTitleCase(primary);
    if (
      facts.personalizationSupported &&
      !/\bpersonal/i.test(title) &&
      !/\bcustom/i.test(title)
    ) {
      title = `Personalized ${title}`;
    }
    baseTitle = title;
  } else {
    // Case 5: No grounded primary keyword -> Rebuild strictly from B1 facts
    let fallbackTitle = toTitleCase(facts.physicalProductIdentity ?? "Specialty Product");
    if (facts.visualEntities) {
      fallbackTitle = `${toTitleCase(facts.visualEntities.split(/[.;]/)[0])} ${fallbackTitle}`;
    }
    if (facts.typographyStyleSummary && !fallbackTitle.toLowerCase().includes(facts.typographyStyleSummary.toLowerCase())) {
      fallbackTitle = `${toTitleCase(facts.typographyStyleSummary)} ${fallbackTitle}`;
    }
    if (facts.personalizationSupported) {
      fallbackTitle = `Personalized ${fallbackTitle}`;
    }
    baseTitle = fallbackTitle;
  }

  // Enrich with vision design concept if available
  const visionConcept = extractVisionDesignConcept(facts);
  if (visionConcept) {
    baseTitle = enrichTitleWithVisionConcept(baseTitle, visionConcept);
  }

  // Preserve variant label if present
  if (facts.variantLabel && facts.variantLabel.trim().length > 0) {
    const varLabel = facts.variantLabel.trim();
    const suffix = ` - ${varLabel}`;
    if (baseTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
      if (baseTitle.length <= maxLength) {
        return baseTitle;
      }
      const prefixPart = baseTitle.slice(0, baseTitle.length - suffix.length).trim();
      const available = Math.max(20, maxLength - suffix.length);
      const fittedPrefix = fitProductTitle(prefixPart, available);
      return `${fittedPrefix}${suffix}`;
    } else if (!baseTitle.toLowerCase().includes(varLabel.toLowerCase())) {
      if (baseTitle.length + suffix.length <= maxLength) {
        return `${baseTitle}${suffix}`;
      }
      const available = Math.max(20, maxLength - suffix.length);
      const fittedBase = fitProductTitle(baseTitle, available);
      return `${fittedBase}${suffix}`;
    }
  }

  return fitProductTitle(baseTitle, maxLength);
}

