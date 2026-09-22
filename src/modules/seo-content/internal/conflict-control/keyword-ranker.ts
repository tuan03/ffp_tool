import { extractCanonicalTokens } from "./local-tfidf-vectorizer";
import type { CandidateRelevanceEvaluation } from "./keyword-relevance-evaluator";

function getSourcePriority(source: string): number {
  switch (source) {
    case "google_autocomplete":
      return 60;
    case "buyer_intent_seed":
      return 50;
    case "category_seed":
      return 40;
    case "niche_seed":
      return 30;
    case "title_seed":
      return 20;
    case "seed":
      return 15;
    default:
      return 10;
  }
}

/**
 * Deterministically sorts approved keyword candidates for downstream SEO Content generation (B5):
 * 1. relevanceScore descending (primary quality signal)
 * 2. source priority descending (autocomplete / buyer intent > generic seeds)
 * 3. token count specificity (closer to ideal 3-4 word phrase)
 * 4. original input index ascending
 */
export function rankApprovedKeywords(
  evaluations: readonly CandidateRelevanceEvaluation[],
): readonly string[] {
  const sorted = [...evaluations].sort((a, b) => {
    // 1. Relevance score (descending)
    const scoreDiff = b.relevanceScore - a.relevanceScore;
    if (Math.abs(scoreDiff) > 0.0001) {
      return scoreDiff;
    }

    // 2. Source priority (descending)
    const prioDiff = getSourcePriority(b.candidate.source) - getSourcePriority(a.candidate.source);
    if (prioDiff !== 0) {
      return prioDiff;
    }

    // 3. Specificity distance from ideal length 3.5
    const lenA = extractCanonicalTokens(a.candidate.keyword).length;
    const lenB = extractCanonicalTokens(b.candidate.keyword).length;
    const distA = Math.abs(lenA - 3.5);
    const distB = Math.abs(lenB - 3.5);
    if (distA !== distB) {
      return distA - distB;
    }

    // 4. Original index (ascending)
    return a.candidate.originalIndex - b.candidate.originalIndex;
  });

  return sorted.map((e) => e.candidate.keyword);
}
