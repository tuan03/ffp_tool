import type { ExistingSeoTarget, SeoProductIdentity } from "../conflict-control/seo-conflict-corpus";
import type { ConflictDetail } from "../domain-types";

/**
 * Context provided for evaluating keyword quality across 4 internal signals.
 * Strictly derived from internal stage outputs (B1, B2, B3, B4) without any paid providers.
 */
export interface KeywordEvaluationContext {
  /** B1: Physical product identity (e.g., "quilt bedding set", "area rug", "t-shirt") */
  readonly physicalProductIdentity?: string;
  /** B1: Visual entities and art style (e.g., "Viking raven artwork", "cute black cat") */
  readonly visualEntities?: string;
  /** B1: Visible texts extracted via typography OCR */
  readonly visibleTexts?: readonly string[];
  /** B2: Target audience descriptions (e.g., ["cat lovers", "mom", "music enthusiasts"]) */
  readonly targetAudience?: readonly string[];
  /** B2: Suitable occasions (e.g., ["halloween", "christmas gift", "housewarming"]) */
  readonly occasions?: readonly string[];
  /** B2: Use cases or settings (e.g., ["living room", "bedroom decor"]) */
  readonly useCases?: readonly string[];
  /** B2: Buyer intent keywords identified during shopping context research */
  readonly buyerIntentKeywords?: readonly string[];
  /** B3: Google Autocomplete search suggestions verified through Google Suggest */
  readonly suggestions?: readonly string[];
  /** B4: Known conflict keywords (e.g., discardedKeywords from conflict control) */
  readonly knownConflicts?: readonly string[];
  /** B4: Conflict details mapped by keyword */
  readonly conflictDetails?: Readonly<Record<string, ConflictDetail>>;
  /** B4: Existing targets from catalog conflict corpus */
  readonly existingTargets?: readonly ExistingSeoTarget[];
  /** Store identification for catalog scoping */
  readonly storeId?: string;
  /** Product identification for self-conflict exclusion */
  readonly productId?: string;
  /** Product handle */
  readonly handle?: string;
}

/**
 * Granular breakdown of the 4 internal scoring signals for a single keyword.
 */
export interface KeywordScoreBreakdown {
  /** Signal 1 (Weight: 35%): Matches visual entities & physical identity from B1 (0.0 - 1.0) */
  readonly entityAlignment: number;
  /** Signal 2 (Weight: 25%): Commercial & transactional intent from B2 minus informational penalties (0.0 - 1.0) */
  readonly commercialIntent: number;
  /** Signal 3 (Weight: 25%): Google Suggest autocomplete validation from B3 (0.0 - 1.0) */
  readonly searchValidation: number;
  /** Signal 4 (Weight: 15% + hard veto): Catalog cannibalization safety from B4 (0.0 - 1.0) */
  readonly cannibalizationSafety: number;
  /** S = 0.35 * S_entity + 0.25 * S_intent + 0.25 * S_search + 0.15 * S_safety */
  readonly compositeScore: number;
  /** Flag indicating severe catalog conflict / hard veto preventing selection as primary */
  readonly isHardVeto: boolean;
  /** Descriptive rationale of the score calculation */
  readonly rationale?: string;
}

/**
 * Objective superiority decision:
 * - REPLACE: Candidate primary keyword is objectively superior (delta >= +0.08 and safety >= 0.8).
 * - RETAIN: Existing primary keyword is retained to protect established rankings (delta < +0.08 or hard veto).
 * - REVIEW_FLAG: Signals are conflicting or ambiguous (close delta, high search but low entity, marginal safety).
 */
export type KeywordComparisonDecision = "REPLACE" | "RETAIN" | "REVIEW_FLAG";

/**
 * Result of comparing a candidate keyword against an existing primary keyword.
 */
export interface KeywordComparisonResult {
  readonly candidate: string;
  readonly existing: string;
  readonly candidateScore: KeywordScoreBreakdown;
  readonly existingScore: KeywordScoreBreakdown;
  /** delta = candidateScore.compositeScore - existingScore.compositeScore */
  readonly delta: number;
  readonly decision: KeywordComparisonDecision;
  readonly rationale: string;
}

/**
 * Configuration options for the KeywordQualityComparator.
 */
export interface KeywordComparatorOptions {
  /** Superiority threshold delta required to replace existing keyword (default: 0.08) */
  readonly superiorityThreshold?: number;
  /** Ambiguity lower bound for flagging review (default: 0.03) */
  readonly reviewFlagThreshold?: number;
  /** Minimum acceptable safety score for replacement (default: 0.80) */
  readonly minAcceptableSafety?: number;
}
