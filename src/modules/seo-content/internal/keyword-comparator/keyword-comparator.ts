import {
  calculateCannibalizationSafety,
  calculateCommercialIntent,
  calculateEntityAlignment,
  calculateSearchValidation,
} from "./scoring-signals";
import type {
  KeywordComparatorOptions,
  KeywordComparisonDecision,
  KeywordComparisonResult,
  KeywordEvaluationContext,
  KeywordScoreBreakdown,
} from "./types";

const DEFAULT_SUPERIORITY_THRESHOLD = 0.08;
const DEFAULT_REVIEW_FLAG_THRESHOLD = 0.03;
const DEFAULT_MIN_ACCEPTABLE_SAFETY = 0.80;

/**
 * KeywordQualityComparator (R6 - Zero External Paid Providers)
 *
 * Evaluates and compares candidate primary keywords against existing primary keywords
 * using strictly internal repository signals (B1 vision, B2 shopping context, B3 Google Suggest,
 * B4 conflict corpus). Strictly NO external paid volume APIs.
 *
 * Objective Superiority Rule:
 * Candidate replaces existing primary keyword ONLY if delta >= 0.08 and safety is acceptable (>= 0.80).
 * Otherwise retains existing primary keyword to protect established search rankings.
 */
export class KeywordQualityComparator {
  private readonly superiorityThreshold: number;
  private readonly reviewFlagThreshold: number;
  private readonly minAcceptableSafety: number;

  constructor(options: KeywordComparatorOptions = {}) {
    this.superiorityThreshold = options.superiorityThreshold ?? DEFAULT_SUPERIORITY_THRESHOLD;
    this.reviewFlagThreshold = options.reviewFlagThreshold ?? DEFAULT_REVIEW_FLAG_THRESHOLD;
    this.minAcceptableSafety = options.minAcceptableSafety ?? DEFAULT_MIN_ACCEPTABLE_SAFETY;
  }

  /**
   * Computes the 4 internal signals and composite quality score for a single keyword.
   * Formula: S = 0.35 * S_entity + 0.25 * S_intent + 0.25 * S_search + 0.15 * S_safety
   */
  public evaluate(keyword: string, context: KeywordEvaluationContext): KeywordScoreBreakdown {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return {
        entityAlignment: 0.0,
        commercialIntent: 0.0,
        searchValidation: 0.0,
        cannibalizationSafety: 1.0,
        compositeScore: 0.0,
        isHardVeto: false,
        rationale: "Empty keyword provided",
      };
    }

    const entityAlignment = calculateEntityAlignment(trimmed, context);
    const commercialIntent = calculateCommercialIntent(trimmed, context);
    const searchValidation = calculateSearchValidation(trimmed, context.suggestions ?? []);
    const cannibalization = calculateCannibalizationSafety(trimmed, context);

    // Composite score formula: 0.35 * entity + 0.25 * intent + 0.25 * search + 0.15 * safety
    const rawComposite =
      0.35 * entityAlignment +
      0.25 * commercialIntent +
      0.25 * searchValidation +
      0.15 * cannibalization.score;

    const compositeScore = Number(rawComposite.toFixed(4));

    const rationaleParts = [
      `Entity Alignment: ${(entityAlignment * 100).toFixed(1)}%`,
      `Commercial Intent: ${(commercialIntent * 100).toFixed(1)}%`,
      `Search Validation: ${(searchValidation * 100).toFixed(1)}%`,
      `Cannibalization Safety: ${(cannibalization.score * 100).toFixed(1)}%`,
    ];
    if (cannibalization.isHardVeto) {
      rationaleParts.push(`HARD VETO: ${cannibalization.conflictReason || "Severe catalog conflict"}`);
    }

    return {
      entityAlignment,
      commercialIntent,
      searchValidation,
      cannibalizationSafety: cannibalization.score,
      compositeScore,
      isHardVeto: cannibalization.isHardVeto,
      rationale: rationaleParts.join("; "),
    };
  }

  /**
   * Compares a candidate keyword against an existing primary keyword using the Objective Superiority Rule.
   */
  public compare(
    candidate: string,
    existing: string,
    context: KeywordEvaluationContext,
  ): KeywordComparisonResult {
    const candidateScore = this.evaluate(candidate, context);

    // If no existing keyword is defined, evaluate candidate standalone
    if (!existing || !existing.trim()) {
      const decision: KeywordComparisonDecision =
        candidateScore.isHardVeto || candidateScore.compositeScore < 0.40
          ? "REVIEW_FLAG"
          : "REPLACE";

      return {
        candidate,
        existing: "",
        candidateScore,
        existingScore: {
          entityAlignment: 0,
          commercialIntent: 0,
          searchValidation: 0,
          cannibalizationSafety: 1,
          compositeScore: 0,
          isHardVeto: false,
          rationale: "No existing primary keyword",
        },
        delta: candidateScore.compositeScore,
        decision,
        rationale:
          decision === "REPLACE"
            ? `Initial primary keyword adopted with composite score ${candidateScore.compositeScore.toFixed(4)}.`
            : `Initial candidate flagged for review due to low composite score (${candidateScore.compositeScore.toFixed(4)}) or safety risk.`,
      };
    }

    const existingScore = this.evaluate(existing, context);
    const delta = Number((candidateScore.compositeScore - existingScore.compositeScore).toFixed(4));

    let decision: KeywordComparisonDecision;
    let rationale: string;

    // 1. Hard Veto on Candidate
    if (candidateScore.isHardVeto || candidateScore.cannibalizationSafety < 0.50) {
      decision = "RETAIN";
      rationale = `Candidate rejected due to severe catalog cannibalization risk (safety: ${candidateScore.cannibalizationSafety.toFixed(2)}, hard veto). Retaining existing primary keyword to protect store rankings.`;
      return { candidate, existing, candidateScore, existingScore, delta, decision, rationale };
    }

    // 2. Conflicting Signals Check
    // e.g. Candidate has significantly higher search demand, but significantly lower entity alignment
    const isConflictingSignals =
      candidateScore.searchValidation - existingScore.searchValidation >= 0.40 &&
      candidateScore.entityAlignment - existingScore.entityAlignment <= -0.25;

    // 3. Marginal Safety Check
    const hasMarginalSafety =
      candidateScore.cannibalizationSafety < this.minAcceptableSafety &&
      candidateScore.cannibalizationSafety >= 0.50;

    // 4. Decision Rule Branching
    if (delta >= this.superiorityThreshold && !hasMarginalSafety && !isConflictingSignals) {
      // Clear objective superiority
      decision = "REPLACE";
      rationale = `Candidate is objectively superior by delta +${delta.toFixed(4)} (>= ${this.superiorityThreshold} threshold) with acceptable safety (${candidateScore.cannibalizationSafety.toFixed(2)}).`;
    } else if (isConflictingSignals) {
      // Conflicting signals: high search but low entity alignment
      decision = "REVIEW_FLAG";
      rationale = `Conflicting signals detected: candidate has higher search validation (+${(candidateScore.searchValidation - existingScore.searchValidation).toFixed(2)}) but lower product entity alignment (${(candidateScore.entityAlignment - existingScore.entityAlignment).toFixed(2)}). Flagged for manual review.`;
    } else if (hasMarginalSafety && delta >= this.superiorityThreshold) {
      // Superior score but secondary cannibalization risk
      decision = "REVIEW_FLAG";
      rationale = `Candidate achieved superior composite score (+${delta.toFixed(4)}), but presents secondary catalog conflict risk (safety: ${candidateScore.cannibalizationSafety.toFixed(2)} < ${this.minAcceptableSafety}). Flagged for manual review.`;
    } else if (delta >= this.reviewFlagThreshold && delta < this.superiorityThreshold) {
      // Close delta zone: candidate is slightly ahead but did not meet the +0.08 superiority threshold
      decision = "REVIEW_FLAG";
      rationale = `Ambiguous score margin: candidate is slightly ahead (+${delta.toFixed(4)}) but did not clear the +${this.superiorityThreshold} objective superiority threshold. Flagged for review; default action is to protect established rankings.`;
    } else {
      // Candidate is inferior or equal (delta < reviewFlagThreshold)
      decision = "RETAIN";
      rationale = `Candidate does not meet objective superiority threshold (delta: ${delta.toFixed(4)} < ${this.superiorityThreshold}). Retaining existing primary keyword to protect established search rankings.`;
    }

    return {
      candidate,
      existing,
      candidateScore,
      existingScore,
      delta,
      decision,
      rationale,
    };
  }
}

/**
 * Functional helper to evaluate a single keyword's quality score.
 */
export function evaluateKeywordQuality(
  keyword: string,
  context: KeywordEvaluationContext,
  options?: KeywordComparatorOptions,
): KeywordScoreBreakdown {
  const comparator = new KeywordQualityComparator(options);
  return comparator.evaluate(keyword, context);
}

/**
 * Functional helper to compare candidate against existing primary keyword.
 */
export function compareKeywordQuality(
  candidate: string,
  existing: string,
  context: KeywordEvaluationContext,
  options?: KeywordComparatorOptions,
): KeywordComparisonResult {
  const comparator = new KeywordQualityComparator(options);
  return comparator.compare(candidate, existing, context);
}
