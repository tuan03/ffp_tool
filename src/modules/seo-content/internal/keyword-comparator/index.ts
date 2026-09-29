export {
  calculateCannibalizationSafety,
  calculateCommercialIntent,
  calculateEntityAlignment,
  calculateSearchValidation,
  extractSignificantTokens,
  normalizeKeyword,
} from "./scoring-signals";
export type { CannibalizationEvaluation } from "./scoring-signals";

export {
  KeywordQualityComparator,
  compareKeywordQuality,
  evaluateKeywordQuality,
} from "./keyword-comparator";

export type {
  KeywordComparatorOptions,
  KeywordComparisonDecision,
  KeywordComparisonResult,
  KeywordEvaluationContext,
  KeywordScoreBreakdown,
} from "./types";
