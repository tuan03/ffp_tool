import { CONFLICT_REASON, type ConflictReasonCode } from "./conflict-reason";
import { cosineSimilarity } from "./cosine-similarity";
import { extractCanonicalTokens } from "./local-tfidf-vectorizer";
import type { CandidateRelevanceEvaluation, ConflictThresholds } from "./keyword-relevance-evaluator";

export interface SemanticClusterInfo {
  readonly representative: string;
  readonly members: readonly string[];
}

export interface SemanticClusteringResult {
  readonly approvedEvaluations: readonly CandidateRelevanceEvaluation[];
  readonly discardedEvaluations: ReadonlyArray<{
    readonly evaluation: CandidateRelevanceEvaluation;
    readonly reason: ConflictReasonCode;
  }>;
  readonly clusters: readonly SemanticClusterInfo[];
}

/**
 * Calculates Token Jaccard similarity between two keywords.
 */
function tokenJaccardSimilarity(textA: string, textB: string): number {
  const setA = new Set(extractCanonicalTokens(textA));
  const setB = new Set(extractCanonicalTokens(textB));

  if (setA.size === 0 && setB.size === 0) {
    return 1.0;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0.0;
  }

  let intersectionCount = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }

  const unionCount = setA.size + setB.size - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Maps provenance source name to priority rank (higher = better).
 */
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
 * Compares two candidates to order by quality / representation priority:
 * 1. Higher relevanceScore (difference > 0.02)
 * 2. Stronger provenance source priority
 * 3. Specificity: preferred length 3 to 4 words
 * 4. Original input order
 */
export function compareCandidatesForClustering(
  a: CandidateRelevanceEvaluation,
  b: CandidateRelevanceEvaluation,
): number {
  const diff = b.relevanceScore - a.relevanceScore;
  if (Math.abs(diff) > 0.02) {
    return diff > 0 ? 1 : -1;
  }

  // Provenance priority (higher = earlier in sort order)
  const prioA = getSourcePriority(a.candidate.source);
  const prioB = getSourcePriority(b.candidate.source);
  if (prioA !== prioB) {
    return prioB - prioA;
  }

  // Specificity (token count closest to ideal commercial length of 3-4 words)
  const tokensA = extractCanonicalTokens(a.candidate.keyword).length;
  const tokensB = extractCanonicalTokens(b.candidate.keyword).length;
  const idealLength = 3.5;
  const distA = Math.abs(tokensA - idealLength);
  const distB = Math.abs(tokensB - idealLength);
  if (distA !== distB) {
    return distA - distB;
  }

  // Tie-breaker: earlier input order
  return a.candidate.originalIndex - b.candidate.originalIndex;
}

export function pickBetterRepresentative(
  a: CandidateRelevanceEvaluation,
  b: CandidateRelevanceEvaluation,
): CandidateRelevanceEvaluation {
  return compareCandidatesForClustering(a, b) <= 0 ? a : b;
}

interface DuplicateCluster {
  readonly repIndex: number;
  readonly members: number[];
}

/**
 * Clusters semantic duplicates and near-duplicates to prevent keyword cannibalization:
 * - Uses Representative-Based Incremental Clustering (Leader Clustering) to prevent
 *   transitive over-merge chains (where A~B and B~C would mistakenly merge A and C).
 * - High-quality candidates are sorted first and established as cluster leaders.
 * - Subsequent candidates are compared strictly against active cluster representatives.
 * - Resolves gray-zone duplicate candidates using Token Jaccard overlap.
 * - Approves the representative keyword per cluster and discards the rest with reason 'semantic_duplicate'.
 */
export function clusterSemanticDuplicates(params: {
  readonly relevantEvaluations: readonly CandidateRelevanceEvaluation[];
  readonly similarityVectors: readonly (readonly number[])[];
  readonly thresholds: ConflictThresholds;
}): SemanticClusteringResult {
  const { relevantEvaluations, similarityVectors, thresholds } = params;

  const count = relevantEvaluations.length;
  if (count <= 1) {
    return {
      approvedEvaluations: [...relevantEvaluations],
      discardedEvaluations: [],
      clusters: relevantEvaluations.map((e) => ({
        representative: e.candidate.keyword,
        members: [e.candidate.keyword],
      })),
    };
  }

  // Sort candidate indices by quality/priority so the best candidates become cluster leaders
  const sortedIndices = Array.from({ length: count }, (_, i) => i);
  sortedIndices.sort((i, j) =>
    compareCandidatesForClustering(relevantEvaluations[i], relevantEvaluations[j]),
  );

  const clusters: DuplicateCluster[] = [];

  for (const idx of sortedIndices) {
    const candVector = similarityVectors[idx];
    const candEval = relevantEvaluations[idx];

    let matchedCluster: DuplicateCluster | undefined;

    // Check against existing cluster representatives only (prevents transitive over-merge)
    for (const cluster of clusters) {
      const repVector = similarityVectors[cluster.repIndex];
      const repEval = relevantEvaluations[cluster.repIndex];

      const sim = cosineSimilarity(candVector, repVector);
      let isDuplicate = false;

      if (sim >= thresholds.duplicateStrong) {
        isDuplicate = true;
      } else if (sim >= thresholds.duplicateReview) {
        const jaccard = tokenJaccardSimilarity(
          candEval.candidate.keyword,
          repEval.candidate.keyword,
        );
        if (jaccard >= 0.55) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.members.push(idx);
    } else {
      clusters.push({
        repIndex: idx,
        members: [idx],
      });
    }
  }

  const approvedEvaluations: CandidateRelevanceEvaluation[] = [];
  const discardedEvaluations: Array<{
    evaluation: CandidateRelevanceEvaluation;
    reason: ConflictReasonCode;
  }> = [];
  const clusterInfos: SemanticClusterInfo[] = [];

  for (const cluster of clusters) {
    approvedEvaluations.push(relevantEvaluations[cluster.repIndex]);
    clusterInfos.push({
      representative: relevantEvaluations[cluster.repIndex].candidate.keyword,
      members: cluster.members.map((m) => relevantEvaluations[m].candidate.keyword),
    });
    for (let k = 1; k < cluster.members.length; k++) {
      const discardedIdx = cluster.members[k];
      discardedEvaluations.push({
        evaluation: relevantEvaluations[discardedIdx],
        reason: CONFLICT_REASON.SEMANTIC_DUPLICATE,
      });
    }
  }

  return {
    approvedEvaluations,
    discardedEvaluations,
    clusters: clusterInfos,
  };
}

