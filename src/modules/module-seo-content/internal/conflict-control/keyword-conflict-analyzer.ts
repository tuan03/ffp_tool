import {
  CONFLICT_REASON,
  REASON_PRECEDENCE_RANK,
  type ConflictReasonCode,
} from "./conflict-reason";
import {
  buildKeywordCandidates,
  removeExactDuplicates,
  type KeywordCandidate,
} from "./keyword-candidate";
import {
  DENSE_VERTEX_THRESHOLDS,
  LOCAL_SPARSE_THRESHOLDS,
  evaluateCandidateRelevance,
  type CandidateRelevanceEvaluation,
  type ConflictThresholds,
} from "./keyword-relevance-evaluator";
import { rankApprovedKeywords } from "./keyword-ranker";
import { buildProductReferences } from "./product-reference-builder";
import { clusterSemanticDuplicates } from "./semantic-duplicate-clusterer";
import { EmptySeoConflictCorpus } from "./empty-seo-conflict-corpus";
import { NoopBrandConflictPolicy, type BrandConflictPolicy } from "./brand-conflict-policy";
import { LocalTfidfVectorizer } from "./local-tfidf-vectorizer";
import type { SeoConflictCorpus, StoredEmbedding } from "./seo-conflict-corpus";
import type { TextEmbeddingProvider } from "./text-embedding-provider";

import type {
  ConflictResult,
  KeywordCluster,
  ProductUnderstanding,
  SearchResearchResult,
  ShoppingContext,
} from "../domain-types";
import type { SeoContentInput } from "../../types";

export interface KeywordConflictAnalysisInput {
  readonly searchResearch?: SearchResearchResult;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly source: SeoContentInput;
}

export interface KeywordConflictAnalyzerConfig {
  readonly primaryEmbeddingProvider?: TextEmbeddingProvider;
  readonly fallbackEmbeddingProvider?: TextEmbeddingProvider;
  readonly conflictCorpus?: SeoConflictCorpus;
  readonly brandPolicy?: BrandConflictPolicy;
  readonly denseThresholds?: ConflictThresholds;
  readonly localThresholds?: ConflictThresholds;
  readonly onFallback?: (error: unknown) => void;
}

export interface KeywordConflictAnalyzer {
  analyze(input: KeywordConflictAnalysisInput): Promise<ConflictResult>;
}

interface VectorSession {
  readonly providerId: string;
  readonly thresholds: ConflictThresholds;
  readonly identityVector: readonly number[];
  readonly intentVector: readonly number[];
  readonly candidateQueryVectors: readonly (readonly number[])[];
  readonly candidateSimilarityVectors: readonly (readonly number[])[];
}

function recordConflict(
  keyword: string,
  reason: ConflictReasonCode,
  conflictReasons: Record<string, string>,
  discardedKeywords: string[],
): void {
  const existingReason = conflictReasons[keyword] as ConflictReasonCode | undefined;
  if (!existingReason) {
    conflictReasons[keyword] = reason;
    discardedKeywords.push(keyword);
    return;
  }
  const existingRank = REASON_PRECEDENCE_RANK[existingReason] ?? 999;
  const newRank = REASON_PRECEDENCE_RANK[reason] ?? 999;
  if (newRank < existingRank) {
    conflictReasons[keyword] = reason;
  }
}

/**
 * Production implementation of KeywordConflictAnalyzer.
 * Enforces Vector-First Hybrid Conflict Engine with strict single-vector-space invariant
 * and deterministic reason precedence:
 * exact_duplicate -> brand_conflict -> existing_url_cannibalization -> category_conflict ->
 * search_intent_mismatch -> semantic_drift_irrelevant -> semantic_duplicate -> low_specificity_generic.
 */
export class DefaultKeywordConflictAnalyzer implements KeywordConflictAnalyzer {
  private readonly primaryProvider?: TextEmbeddingProvider;
  private readonly fallbackProvider: TextEmbeddingProvider;
  private readonly corpus: SeoConflictCorpus;
  private readonly brandPolicy: BrandConflictPolicy;
  private readonly denseThresholds: ConflictThresholds;
  private readonly localThresholds: ConflictThresholds;
  private readonly onFallback?: (error: unknown) => void;

  constructor(config?: KeywordConflictAnalyzerConfig) {
    this.primaryProvider = config?.primaryEmbeddingProvider;
    this.fallbackProvider = config?.fallbackEmbeddingProvider ?? new LocalTfidfVectorizer();
    this.corpus = config?.conflictCorpus ?? new EmptySeoConflictCorpus();
    this.brandPolicy = config?.brandPolicy ?? new NoopBrandConflictPolicy();
    this.denseThresholds = config?.denseThresholds ?? DENSE_VERTEX_THRESHOLDS;
    this.localThresholds = config?.localThresholds ?? LOCAL_SPARSE_THRESHOLDS;
    this.onFallback = config?.onFallback;
  }

  /**
   * Creates a vector session ensuring 100% of vectors come from ONE provider.
   * If primary fails, discards all partial vectors and recomputes everything locally.
   */
  private async createVectorSession(params: {
    readonly identityText: string;
    readonly intentText: string;
    readonly candidateKeywords: readonly string[];
  }): Promise<VectorSession> {
    const { identityText, intentText, candidateKeywords } = params;

    if (this.primaryProvider && this.primaryProvider.providerId !== "local_tfidf") {
      try {
        const [refDocVectors, candidateQueryVectors, candidateSimVectors] = await Promise.all([
          this.primaryProvider.embed([identityText, intentText], {
            taskType: "RETRIEVAL_DOCUMENT",
          }),
          candidateKeywords.length > 0
            ? this.primaryProvider.embed(candidateKeywords, {
                taskType: "RETRIEVAL_QUERY",
              })
            : Promise.resolve([]),
          candidateKeywords.length > 0
            ? this.primaryProvider.embed(candidateKeywords, {
                taskType: "SEMANTIC_SIMILARITY",
              })
            : Promise.resolve([]),
        ]);

        if (
          refDocVectors.length >= 2 &&
          candidateQueryVectors.length === candidateKeywords.length &&
          candidateSimVectors.length === candidateKeywords.length
        ) {
          return {
            providerId: this.primaryProvider.providerId,
            thresholds: this.denseThresholds,
            identityVector: refDocVectors[0],
            intentVector: refDocVectors[1],
            candidateQueryVectors,
            candidateSimilarityVectors: candidateSimVectors,
          };
        }
        throw new Error(
          `Primary provider returned incomplete vector batch: expected ${candidateKeywords.length} query/sim vectors, got ${candidateQueryVectors.length}/${candidateSimVectors.length}`,
        );
      } catch (err) {
        if (this.onFallback) {
          this.onFallback(err);
        } else {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[SEO B4 Fallback] Primary vector embedding failed: ${errMsg}. Recomputing all vectors using deterministic local vectorizer.`,
          );
        }
      }
    }

    // Fallback: build deterministic local TF-IDF vectorizer session
    const localVectorizer = new LocalTfidfVectorizer({
      referenceTexts: [identityText, intentText],
      candidateTexts: candidateKeywords,
    });

    const [refVectors, queryVectors] = await Promise.all([
      localVectorizer.embed([identityText, intentText], {
        taskType: "RETRIEVAL_DOCUMENT",
      }),
      candidateKeywords.length > 0
        ? localVectorizer.embed(candidateKeywords, {
            taskType: "RETRIEVAL_QUERY",
          })
        : Promise.resolve([]),
    ]);

    return {
      providerId: "local_tfidf",
      thresholds: this.localThresholds,
      identityVector: refVectors[0] ?? [],
      intentVector: refVectors[1] ?? [],
      candidateQueryVectors: queryVectors,
      // For local TF-IDF, normalized vectors serve in the same space for pairwise similarity
      candidateSimilarityVectors: queryVectors,
    };
  }

  async analyze(input: KeywordConflictAnalysisInput): Promise<ConflictResult> {
    const conflictReasons: Record<string, string> = {};
    const discardedKeywords: string[] = [];

    // 1. Build Candidate Pool
    const allCandidates = buildKeywordCandidates(input.searchResearch);

    // 2. Precedence Rank 1: Exact Normalization and Deduplication
    const exactResult = removeExactDuplicates(allCandidates);
    for (const item of exactResult.discardedCandidates) {
      recordConflict(
        item.candidate.keyword,
        CONFLICT_REASON.EXACT_DUPLICATE,
        conflictReasons,
        discardedKeywords,
      );
    }

    const uniqueCandidates = exactResult.uniqueCandidates;
    if (uniqueCandidates.length === 0) {
      return {
        approvedKeywords: [],
        discardedKeywords,
        conflictReasons,
        relevanceScores: {},
        keywordClusters: [],
      };
    }

    // 3. Precedence Rank 2: Brand Conflict Guard
    const nonBrandCandidates: KeywordCandidate[] = [];
    for (const candidate of uniqueCandidates) {
      const brandCheck = this.brandPolicy.evaluate(candidate.keyword);
      if (brandCheck.conflict) {
        recordConflict(
          candidate.keyword,
          CONFLICT_REASON.BRAND_CONFLICT,
          conflictReasons,
          discardedKeywords,
        );
      } else {
        nonBrandCandidates.push(candidate);
      }
    }

    if (nonBrandCandidates.length === 0) {
      return {
        approvedKeywords: [],
        discardedKeywords,
        conflictReasons,
        relevanceScores: {},
        keywordClusters: [],
      };
    }

    // 4. Precedence Rank 3 (Text Check): Existing URL Cannibalization in Corpus
    const nonCorpusCandidates: KeywordCandidate[] = [];
    for (const candidate of nonBrandCandidates) {
      const conflicts = await this.corpus.findConflicts(candidate.keyword);
      if (conflicts.length > 0) {
        recordConflict(
          candidate.keyword,
          CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictReasons,
          discardedKeywords,
        );
      } else {
        nonCorpusCandidates.push(candidate);
      }
    }

    if (nonCorpusCandidates.length === 0) {
      return {
        approvedKeywords: [],
        discardedKeywords,
        conflictReasons,
        relevanceScores: {},
        keywordClusters: [],
      };
    }

    // 5. Build Dual Reference Texts
    const references = buildProductReferences({
      source: input.source,
      productUnderstanding: input.productUnderstanding,
      shoppingContext: input.shoppingContext,
    });

    // 6. Create Vector Session (enforcing single vector space invariant)
    const candidateKeywords = nonCorpusCandidates.map((c) => c.keyword);
    const session = await this.createVectorSession({
      identityText: references.productIdentityText,
      intentText: references.shoppingIntentText,
      candidateKeywords,
    });

    // 7. Precedence Rank 4, 5, 6: Category Conflict, Search Intent Mismatch, Semantic Drift
    const relevanceEvaluations = evaluateCandidateRelevance({
      candidates: nonCorpusCandidates,
      candidateQueryVectors: session.candidateQueryVectors,
      productIdentityVector: session.identityVector,
      shoppingIntentVector: session.intentVector,
      thresholds: session.thresholds,
      productContext: {
        source: input.source,
        productUnderstanding: input.productUnderstanding,
        shoppingContext: input.shoppingContext,
      },
    });

    const passedRelevance: CandidateRelevanceEvaluation[] = [];
    const passedSimVectors: Array<readonly number[]> = [];

    for (let i = 0; i < relevanceEvaluations.length; i++) {
      const evaluation = relevanceEvaluations[i];
      if (evaluation.isRelevant) {
        passedRelevance.push(evaluation);
        passedSimVectors.push(session.candidateSimilarityVectors[i]);
      } else {
        const kw = evaluation.candidate.keyword;
        recordConflict(
          kw,
          evaluation.conflictReason ?? CONFLICT_REASON.SEMANTIC_DRIFT,
          conflictReasons,
          discardedKeywords,
        );
      }
    }

    // 8. Precedence Rank 7: Semantic Duplicate Clustering within current product
    const clusterResult = clusterSemanticDuplicates({
      relevantEvaluations: passedRelevance,
      similarityVectors: passedSimVectors,
      thresholds: session.thresholds,
    });

    for (const item of clusterResult.discardedEvaluations) {
      const kw = item.evaluation.candidate.keyword;
      recordConflict(kw, item.reason, conflictReasons, discardedKeywords);
    }

    // 9. Precedence Rank 3 (Semantic Vector Check): Site-wide URL Cannibalization against Corpus Embeddings
    const afterCorpusVectorCheck: CandidateRelevanceEvaluation[] = [];
    for (let i = 0; i < clusterResult.approvedEvaluations.length; i++) {
      const evalItem = clusterResult.approvedEvaluations[i];
      const kw = evalItem.candidate.keyword;
      const vectorIdx = nonCorpusCandidates.findIndex(
        (c) => c.canonical === evalItem.candidate.canonical,
      );
      const vector = vectorIdx >= 0 ? session.candidateSimilarityVectors[vectorIdx] : undefined;

      const storedEmbedding: StoredEmbedding | undefined = vector
        ? {
            values: vector,
            provider: session.providerId,
            model:
              session.providerId === "vertex" || session.providerId === "vertex_ai"
                ? "text-embedding-004"
                : "local_tfidf",
            taskType: "SEMANTIC_SIMILARITY",
            dimensions: vector.length,
          }
        : undefined;

      const conflicts = await this.corpus.findConflicts(kw, storedEmbedding);
      if (conflicts.length > 0) {
        recordConflict(
          kw,
          CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictReasons,
          discardedKeywords,
        );
      } else {
        afterCorpusVectorCheck.push(evalItem);
      }
    }

    // 10. Precedence Rank 8: Low Specificity Generic Guard
    const afterSpecificityCheck: CandidateRelevanceEvaluation[] = [];
    for (const evalItem of afterCorpusVectorCheck) {
      const tokens = evalItem.candidate.canonical.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length === 0 || (tokens.length === 1 && tokens[0].length <= 2)) {
        recordConflict(
          evalItem.candidate.keyword,
          CONFLICT_REASON.LOW_SPECIFICITY,
          conflictReasons,
          discardedKeywords,
        );
      } else {
        afterSpecificityCheck.push(evalItem);
      }
    }

    // 11. Deterministic Ranking for Approved Keywords
    const approvedKeywords = rankApprovedKeywords(afterSpecificityCheck);
    const approvedSet = new Set(approvedKeywords);

    const relevanceScores: Record<string, number> = {};
    for (const evalItem of afterSpecificityCheck) {
      relevanceScores[evalItem.candidate.keyword] = Number(evalItem.relevanceScore.toFixed(4));
    }

    const keywordClusters = clusterResult.clusters
      .filter((c) => approvedSet.has(c.representative))
      .map((c) => ({
        representative: c.representative,
        members: c.members,
      }));

    return {
      approvedKeywords,
      discardedKeywords,
      conflictReasons,
      relevanceScores,
      keywordClusters,
    };
  }
}

