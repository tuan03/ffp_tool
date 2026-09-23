import { CONFLICT_REASON, type ConflictReasonCode } from "./conflict-reason";
import { cosineSimilarity } from "./cosine-similarity";
import type { KeywordCandidate } from "./keyword-candidate";
import type { BuildProductReferencesInput } from "./product-reference-builder";

export interface ConflictThresholds {
  readonly relevancePass: number;
  readonly relevanceReject: number;
  readonly duplicateStrong: number;
  readonly duplicateReview: number;
  readonly informationalIntentThreshold: number;
}

export const DENSE_VERTEX_THRESHOLDS: ConflictThresholds = {
  relevancePass: 0.64,
  relevanceReject: 0.54,
  duplicateStrong: 0.90,
  duplicateReview: 0.84,
  informationalIntentThreshold: 0.55,
};

export const LOCAL_SPARSE_THRESHOLDS: ConflictThresholds = {
  relevancePass: 0.12,
  relevanceReject: 0.01,
  duplicateStrong: 0.72,
  duplicateReview: 0.62,
  informationalIntentThreshold: 0.08,
};

export interface CandidateRelevanceEvaluation {
  readonly candidate: KeywordCandidate;
  readonly identitySimilarity: number;
  readonly intentSimilarity: number;
  readonly relevanceScore: number;
  readonly isRelevant: boolean;
  readonly conflictReason?: ConflictReasonCode;
}

const INFORMATIONAL_MARKERS: readonly RegExp[] = [
  /\bhow to\b/i,
  /\bwhat is\b/i,
  /\bwhy\b/i,
  /\bwhen\b/i,
  /\bwhere\b/i,
  /\bhistory of\b/i,
  /\bmeaning of\b/i,
  /\bdrawing\b/i,
  /\btutorial\b/i,
  /\bcare for\b/i,
  /\bfacts about\b/i,
  /\bfeeding\b/i,
  /\bvet\b/i,
  /\bveterinary\b/i,
  /\badoption\b/i,
  /\brescue\b/i,
];

/**
 * Standard known product categories to check for cross-category conflicts.
 */
const KNOWN_PRODUCT_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  rug: ["rug", "rugs", "area rug", "floor mat", "carpet"],
  "t-shirt": ["t-shirt", "t shirt", "tshirt", "tee", "tees", "shirt", "shirts", "top", "apparel"],
  mug: ["mug", "mugs", "coffee mug", "cup", "tumbler"],
  hoodie: ["hoodie", "hoodies", "sweatshirt", "pullover"],
  poster: ["poster", "posters", "wall art", "canvas", "print"],
  pillow: ["pillow", "pillows", "cushion"],
  blanket: ["blanket", "blankets", "throw blanket"],
  tote: ["tote", "tote bag", "canvas bag"],
};

/**
 * Competing / distinct product terms that conflict when target product is different.
 */
const COMPETING_CATEGORY_PATTERNS: Readonly<Array<{ categoryKey: string; pattern: RegExp }>> = [
  { categoryKey: "rugby", pattern: /\brugby\b/i },
  { categoryKey: "mug", pattern: /\b(mug|mugs|coffee mug|tumbler)\b/i },
  { categoryKey: "t-shirt", pattern: /\b(t-shirt|t shirt|tshirt|tee|hoodie|sweatshirt)\b/i },
  { categoryKey: "rug", pattern: /\b(rug|rugs|carpet|area rug)\b/i },
  { categoryKey: "pet_food", pattern: /\b(food|kibble|cat food|dog food|treats)\b/i },
];

/**
 * Escapes regex metacharacters to prevent syntax errors and pattern injection.
 */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds safe word boundary regex:
 * Uses \b only when text starts/ends with word character (\w)
 * to avoid matching failures when text contains non-word characters.
 */
export function safeWordBoundaryRegex(patternText: string): RegExp {
  const trimmed = patternText.trim();
  const escaped = escapeRegex(trimmed);
  const leadingBoundary = /^\w/.test(trimmed) ? "\\b" : "";
  const trailingBoundary = /\w$/.test(trimmed) ? "\\b" : "";
  return new RegExp(`${leadingBoundary}${escaped}${trailingBoundary}`, "i");
}

/**
 * Checks whether candidate text is an informational/tutorial query.
 */
export function looksInformational(query: string): boolean {
  return INFORMATIONAL_MARKERS.some((rx) => rx.test(query));
}

/**
 * Evaluates candidate keywords against product references using vector similarities.
 */
export function evaluateCandidateRelevance(params: {
  readonly candidates: readonly KeywordCandidate[];
  readonly candidateQueryVectors: readonly (readonly number[])[];
  readonly productIdentityVector: readonly number[];
  readonly shoppingIntentVector: readonly number[];
  readonly thresholds: ConflictThresholds;
  readonly productContext: BuildProductReferencesInput;
}): readonly CandidateRelevanceEvaluation[] {
  const {
    candidates,
    candidateQueryVectors,
    productIdentityVector,
    shoppingIntentVector,
    thresholds,
    productContext,
  } = params;

  // Build list of contextual anchors from product
  const anchors: string[] = [];
  const categoryRaw = productContext.productUnderstanding?.physicalProductIdentity?.toLowerCase().trim();
  if (categoryRaw) {
    anchors.push(categoryRaw);
    const catAliases = KNOWN_PRODUCT_CATEGORIES[categoryRaw] ?? [];
    anchors.push(...catAliases);
  }

  const visualEntities = productContext.productUnderstanding?.visualEntities?.toLowerCase().trim();
  if (visualEntities && visualEntities !== "unknown") {
    anchors.push(visualEntities);
  }

  for (const aud of productContext.shoppingContext?.targetAudience ?? []) {
    const trimmed = aud.toLowerCase().trim();
    if (trimmed) {
      anchors.push(trimmed);
    }
  }

  for (const occ of productContext.shoppingContext?.suitableOccasions ?? []) {
    const trimmed = occ.toLowerCase().trim();
    if (trimmed) {
      anchors.push(trimmed);
    }
  }

  const nicheRaw = productContext.source.niche?.toLowerCase().trim();
  if (nicheRaw) {
    anchors.push(nicheRaw);
    const nicheWords = nicheRaw.split(/[\s,._/-]+/).filter((w) => w.length >= 3);
    anchors.push(...nicheWords);
  }

  const titleRaw = productContext.source.title?.toLowerCase().trim();
  if (titleRaw) {
    const titleWords = titleRaw.split(/[\s,._/-]+/).filter((w) => w.length >= 3);
    anchors.push(...titleWords);
  }

  const evaluations: CandidateRelevanceEvaluation[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateVector = candidateQueryVectors[i];

    const identitySimilarity = cosineSimilarity(candidateVector, productIdentityVector);
    const intentSimilarity = cosineSimilarity(candidateVector, shoppingIntentVector);

    const high = Math.max(identitySimilarity, intentSimilarity);
    const low = Math.min(identitySimilarity, intentSimilarity);
    const relevanceScore = 0.65 * high + 0.35 * low;

    const lowerKeyword = candidate.keyword.toLowerCase();

    // Guard 1: Informational Intent Guard
    if (
      looksInformational(lowerKeyword) &&
      intentSimilarity < thresholds.informationalIntentThreshold
    ) {
      evaluations.push({
        candidate,
        identitySimilarity,
        intentSimilarity,
        relevanceScore,
        isRelevant: false,
        conflictReason: CONFLICT_REASON.SEARCH_INTENT_MISMATCH,
      });
      continue;
    }

    // Guard 2: Category Conflict Guard
    let categoryConflictDetected = false;

    // Check specific known collision: "rugby" when product is "rug"
    if (categoryRaw === "rug" || categoryRaw === "area rug") {
      if (/\brugby\b/i.test(lowerKeyword) && !/\brug\b/i.test(lowerKeyword)) {
        categoryConflictDetected = true;
      }
    }

    // Check competing product category terms if product category is clear
    if (categoryRaw) {
      for (const comp of COMPETING_CATEGORY_PATTERNS) {
        if (comp.categoryKey === categoryRaw) {
          continue;
        }
        if (comp.pattern.test(lowerKeyword)) {
          // Check if candidate also contains target category
          const hasTargetCat = KNOWN_PRODUCT_CATEGORIES[categoryRaw]?.some((alias) =>
            safeWordBoundaryRegex(alias).test(lowerKeyword),
          );
          if (!hasTargetCat) {
            categoryConflictDetected = true;
            break;
          }
        }
      }
    }

    if (categoryConflictDetected) {
      evaluations.push({
        candidate,
        identitySimilarity,
        intentSimilarity,
        relevanceScore,
        isRelevant: false,
        conflictReason: CONFLICT_REASON.CATEGORY_CONFLICT,
      });
      continue;
    }

    // Check contextual anchors safely with word boundaries
    const hasAnchor = anchors.some((anchor) => {
      return safeWordBoundaryRegex(anchor).test(lowerKeyword);
    });

    // Decision: Pass vs Gray Zone vs Reject
    if (relevanceScore >= thresholds.relevancePass) {
      evaluations.push({
        candidate,
        identitySimilarity,
        intentSimilarity,
        relevanceScore,
        isRelevant: true,
      });
      continue;
    }

    // Gray Zone: [relevanceReject, relevancePass) requiring at least one contextual anchor
    if (relevanceScore >= thresholds.relevanceReject && hasAnchor) {
      evaluations.push({
        candidate,
        identitySimilarity,
        intentSimilarity,
        relevanceScore,
        isRelevant: true,
      });
      continue;
    }

    // Below reject threshold (< relevanceReject) or missing anchors -> semantic drift
    evaluations.push({
      candidate,
      identitySimilarity,
      intentSimilarity,
      relevanceScore,
      isRelevant: false,
      conflictReason: CONFLICT_REASON.SEMANTIC_DRIFT,
    });
  }

  return evaluations;
}
