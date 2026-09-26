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
import { cosineSimilarity } from "./cosine-similarity";
import {
  isSameProduct,
  isEmbeddingCompatible,
  type ExistingSeoTarget,
  type SeoConflictCorpus,
  type SeoConflictCorpusFile,
  type SeoConflictLookup,
  type SeoProductIdentity,
  type StoredEmbedding,
} from "./seo-conflict-corpus";
import type { TextEmbeddingProvider } from "./text-embedding-provider";

import type {
  ConflictDetail,
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

export interface CatalogKeywordTarget {
  readonly storeId?: string;
  readonly productKey: string;
  readonly productId?: string;
  readonly handle?: string;
  readonly url?: string;
  readonly title?: string;
  readonly keyword: string;
  readonly normalizedKeyword: string;
  readonly rank: number;
  readonly embedding?: StoredEmbedding;
}

import {
  checkContextualConflict,
  type ContextualConflictParams,
} from "./contextual-conflict-evaluator";

export { checkContextualConflict, type ContextualConflictParams };

interface VectorSession {
  readonly providerId: string;
  readonly thresholds: ConflictThresholds;
  readonly identityVector: readonly number[];
  readonly intentVector: readonly number[];
  readonly candidateQueryVectors: readonly (readonly number[])[];
  readonly candidateSimilarityVectors: readonly (readonly number[])[];
  readonly catalogSimilarityVectors?: readonly (readonly number[])[];
  readonly vectorSpaceId?: string;
  readonly reusableAcrossRuns: boolean;
}

function collectMeaningfulTerms(value: string | undefined): ReadonlySet<string> {
  return new Set((value?.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
}

function hasSupportedSceneClaim(params: {
  readonly keyword: string;
  readonly sceneContext: string | undefined;
  readonly productEvidence: string;
}): boolean {
  const sceneTerms = collectMeaningfulTerms(params.sceneContext);
  const candidateTerms = collectMeaningfulTerms(params.keyword);
  const claimedSceneTerms = [...candidateTerms].filter((term) => sceneTerms.has(term));
  if (claimedSceneTerms.length === 0) return true;

  const productTerms = collectMeaningfulTerms(params.productEvidence);
  return claimedSceneTerms.every((term) => productTerms.has(term));
}

async function findCorpusConflicts(
  corpus: SeoConflictCorpus,
  lookup: SeoConflictLookup,
): Promise<readonly ExistingSeoTarget[]> {
  try {
    return await corpus.findConflicts(lookup);
  } catch (err) {
    if (
      err instanceof TypeError &&
      (String(err.message).includes("toLowerCase") ||
        String(err.message).includes("includes") ||
        String(err.message).includes("indexOf") ||
        String(err.message).includes("trim") ||
        String(err.message).includes("startsWith"))
    ) {
      return await (corpus.findConflicts as (
        kw: string,
        vec?: StoredEmbedding | readonly number[],
      ) => Promise<readonly ExistingSeoTarget[]>)(lookup.keyword, lookup.embedding);
    }
    throw err;
  }
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
    readonly catalogKeywords?: readonly string[];
  }): Promise<VectorSession> {
    const { identityText, intentText, candidateKeywords, catalogKeywords = [] } = params;

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
            vectorSpaceId: "vertex:text-embedding-004:SEMANTIC_SIMILARITY:768",
            reusableAcrossRuns: true,
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

    // Fallback: build ONE deterministic local TF-IDF vectorizer session
    // combining references, candidateKeywords, AND stored catalogKeywords in the exact same vocabulary space
    const localVectorizer = new LocalTfidfVectorizer({
      referenceTexts: [identityText, intentText],
      candidateTexts: [...candidateKeywords, ...catalogKeywords],
    });

    const [refVectors, queryVectors, catalogVectors] = await Promise.all([
      localVectorizer.embed([identityText, intentText], {
        taskType: "RETRIEVAL_DOCUMENT",
      }),
      candidateKeywords.length > 0
        ? localVectorizer.embed(candidateKeywords, {
            taskType: "RETRIEVAL_QUERY",
          })
        : Promise.resolve([]),
      catalogKeywords.length > 0
        ? localVectorizer.embed(catalogKeywords, {
            taskType: "SEMANTIC_SIMILARITY",
          })
        : Promise.resolve([]),
    ]);

    const sessionVectorSpaceId = `local_tfidf_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return {
      providerId: "local_tfidf",
      thresholds: this.localThresholds,
      identityVector: refVectors[0] ?? [],
      intentVector: refVectors[1] ?? [],
      candidateQueryVectors: queryVectors,
      candidateSimilarityVectors: queryVectors,
      catalogSimilarityVectors: catalogVectors,
      vectorSpaceId: sessionVectorSpaceId,
      reusableAcrossRuns: false,
    };
  }

  async analyze(input: KeywordConflictAnalysisInput): Promise<ConflictResult> {
    const conflictReasons: Record<string, string> = {};
    const discardedKeywords: string[] = [];
    const conflictDetails: Record<string, ConflictDetail> = {};

    const owner: SeoProductIdentity = {
      storeId: input.source.storeId,
      productId: input.source.productId,
      handle: input.source.handle,
      url:
        input.source.url ??
        (input.source.handle ? `/products/${input.source.handle}` : undefined),
    };

    // Obtain single snapshot of corpus at the start for immutable snapshot consistency
    const corpusSnapshot = await (this.corpus.getSnapshot
      ? this.corpus.getSnapshot()
      : Promise.resolve(undefined));
    const corpusRevision = corpusSnapshot?.revision;

    // 1. Build Candidate Pool
    const allCandidates = buildKeywordCandidates(input.searchResearch);
    const sceneSeedSet = new Set(
      Object.entries(input.searchResearch?.querySources ?? {})
        .filter(([, source]) => source === "scene_context_seed")
        .map(([query]) => query.toLowerCase().trim()),
    );
    const productEvidence = [
      input.source.title,
      input.source.description,
      input.source.niche,
      input.productUnderstanding?.physicalProductIdentity,
      input.productUnderstanding?.visualEntities,
      input.productUnderstanding?.typography.styleSummary,
      ...(input.productUnderstanding?.typography.visibleTexts ?? []),
    ].join(" ").toLowerCase();
    const candidates = allCandidates.filter((candidate) => {
      if (!sceneSeedSet.has(candidate.keyword.toLowerCase().trim())) return true;
      if (hasSupportedSceneClaim({
        keyword: candidate.keyword,
        sceneContext: input.productUnderstanding?.sceneContext,
        productEvidence,
      })) return true;
      recordConflict(candidate.keyword, CONFLICT_REASON.SCENE_CONTEXT_ONLY, conflictReasons, discardedKeywords);
      return false;
    });

    // 2. Precedence Rank 1: Exact Normalization and Deduplication
    const exactResult = removeExactDuplicates(candidates);
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
        conflictDetails:
          Object.keys(conflictDetails).length > 0 ? conflictDetails : undefined,
        corpusRevision,
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
        conflictDetails:
          Object.keys(conflictDetails).length > 0 ? conflictDetails : undefined,
        corpusRevision,
      };
    }

    // 4. Precedence Rank 3 (Text Check): Existing URL Cannibalization in Corpus
    const nonCorpusCandidates: KeywordCandidate[] = [];
    for (const candidate of nonBrandCandidates) {
      let exactConflict: ExistingSeoTarget | undefined;

      if (corpusSnapshot) {
        for (const product of corpusSnapshot.products) {
          if (
            owner.storeId &&
            product.storeId &&
            owner.storeId.trim() !== product.storeId.trim()
          ) {
            continue;
          }

          if (
            owner &&
            isSameProduct(owner, {
              storeId: product.storeId,
              productId: product.productId,
              handle: product.handle,
              url: product.url,
            })
          ) {
            continue;
          }

          const productUrl =
            product.url ?? (product.handle ? `/products/${product.handle}` : "");

          for (const kw of product.keywords) {
            if (candidate.canonical === kw.normalizedKeyword) {
              exactConflict = {
                productKey: product.productKey,
                productId: product.productId,
                handle: product.handle,
                url: productUrl,
                title: product.title,
                primaryKeyword: kw.keyword,
                keyword: kw.keyword,
                normalizedKeyword: kw.normalizedKeyword,
                rank: kw.rank,
                matchType: "exact",
                similarity: 1.0,
              };
              break;
            }
          }
          if (exactConflict) break;
        }
      } else {
        const conflicts = await findCorpusConflicts(this.corpus, {
          keyword: candidate.keyword,
          normalizedKeyword: candidate.canonical,
          owner,
        });
        if (conflicts.length > 0) {
          exactConflict = conflicts[0];
        }
      }

      if (exactConflict) {
        recordConflict(
          candidate.keyword,
          CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictReasons,
          discardedKeywords,
        );
        conflictDetails[candidate.keyword] = {
          reason: CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictingProductKey: exactConflict.productKey,
          conflictingHandle: exactConflict.handle,
          conflictingUrl: exactConflict.url,
          conflictingTitle: exactConflict.title,
          conflictingKeyword: exactConflict.keyword ?? exactConflict.primaryKeyword,
          matchType: "exact",
          similarity: exactConflict.similarity ?? 1.0,
        };
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
        conflictDetails:
          Object.keys(conflictDetails).length > 0 ? conflictDetails : undefined,
        corpusRevision,
      };
    }

    // Collect all stored catalog keywords from other products in the corpus snapshot
    const catalogTargets: CatalogKeywordTarget[] = [];
    if (corpusSnapshot) {
      for (const product of corpusSnapshot.products) {
        if (
          owner.storeId &&
          product.storeId &&
          owner.storeId.trim() !== product.storeId.trim()
        ) {
          continue;
        }

        if (
          owner &&
          isSameProduct(owner, {
            storeId: product.storeId,
            productId: product.productId,
            handle: product.handle,
            url: product.url,
          })
        ) {
          continue;
        }
        const productUrl =
          product.url ?? (product.handle ? `/products/${product.handle}` : "");
        for (const kw of product.keywords) {
          catalogTargets.push({
            storeId: product.storeId,
            productKey: product.productKey,
            productId: product.productId,
            handle: product.handle,
            url: productUrl,
            title: product.title,
            keyword: kw.keyword,
            normalizedKeyword: kw.normalizedKeyword,
            rank: kw.rank,
            embedding: kw.embedding,
          });
        }
      }
    }

    // 5. Build Dual Reference Texts
    const references = buildProductReferences({
      source: input.source,
      productUnderstanding: input.productUnderstanding,
      shoppingContext: input.shoppingContext,
    });

    // 6. Create Vector Session (enforcing single vector space invariant)
    const candidateKeywords = nonCorpusCandidates.map((c) => c.keyword);
    const catalogKeywords = catalogTargets.map((c) => c.keyword);

    const session = await this.createVectorSession({
      identityText: references.productIdentityText,
      intentText: references.shoppingIntentText,
      candidateKeywords,
      catalogKeywords,
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

    // 9. Precedence Rank 3 (Semantic Vector Check): Site-wide URL Cannibalization against Catalog Keywords
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
            vectorSpaceId: session.vectorSpaceId,
            reusableAcrossRuns: session.reusableAcrossRuns,
          }
        : undefined;

      let topConflict: ExistingSeoTarget | undefined;

      // Check against catalogTargets from snapshot in the current vector session
      if (vector && catalogTargets.length > 0) {
        for (let catIdx = 0; catIdx < catalogTargets.length; catIdx++) {
          const catTarget = catalogTargets[catIdx];
          let sim: number | undefined;

          if (session.providerId === "local_tfidf" && session.catalogSimilarityVectors) {
            const catVec = session.catalogSimilarityVectors[catIdx];
            if (catVec && catVec.length > 0) {
              sim = cosineSimilarity(vector, catVec);
            }
          } else if (
            catTarget.embedding &&
            isEmbeddingCompatible(storedEmbedding, catTarget.embedding)
          ) {
            sim = cosineSimilarity(vector, catTarget.embedding.values);
          }

          if (sim !== undefined) {
            const isPrimary = catTarget.rank === 0;
            let isConflict = false;

            const strongThreshold = session.thresholds.duplicateStrong;
            const reviewThreshold =
              session.providerId === "local_tfidf"
                ? session.thresholds.duplicateReview
                : (this.denseThresholds?.duplicateReview ?? 0.86);

            if (sim >= strongThreshold) {
              isConflict = true;
            } else if (sim >= reviewThreshold) {
              // Gray zone [reviewThreshold, strongThreshold)
              if (isPrimary) {
                isConflict = checkContextualConflict({
                  candidateKeyword: kw,
                  candidateCategory:
                    input.productUnderstanding?.physicalProductIdentity ?? input.source.niche,
                  candidateTitle: input.source.title,
                  catalogTitle: catTarget.title,
                  catalogKeyword: catTarget.keyword,
                });
              }
            }

            if (isConflict && (!topConflict || sim > (topConflict.similarity ?? 0))) {
              topConflict = {
                productKey: catTarget.productKey,
                productId: catTarget.productId,
                handle: catTarget.handle,
                url: catTarget.url ?? (catTarget.handle ? `/products/${catTarget.handle}` : ""),
                title: catTarget.title,
                primaryKeyword: catTarget.keyword,
                keyword: catTarget.keyword,
                normalizedKeyword: catTarget.normalizedKeyword,
                rank: catTarget.rank,
                matchType: "semantic",
                similarity: Number(sim.toFixed(4)),
              };
            }
          }
        }
      }

      // Fallback to corpus.findConflicts if snapshot was absent or no conflict found yet
      if (!topConflict) {
        const legacyConflicts = await findCorpusConflicts(this.corpus, {
          keyword: kw,
          normalizedKeyword: evalItem.candidate.canonical,
          owner,
          embedding: storedEmbedding,
          snapshot: corpusSnapshot,
          productCategory:
            input.productUnderstanding?.physicalProductIdentity ?? input.source.niche,
          productTitle: input.source.title,
        });
        if (legacyConflicts.length > 0) {
          topConflict = legacyConflicts[0];
        }
      }

      if (topConflict) {
        recordConflict(
          kw,
          CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictReasons,
          discardedKeywords,
        );
        conflictDetails[kw] = {
          reason: CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
          conflictingProductKey: topConflict.productKey,
          conflictingHandle: topConflict.handle,
          conflictingUrl: topConflict.url,
          conflictingTitle: topConflict.title,
          conflictingKeyword: topConflict.keyword ?? topConflict.primaryKeyword,
          matchType: topConflict.matchType ?? "semantic",
          similarity: topConflict.similarity,
        };
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

    const approvedEmbeddings: Record<string, StoredEmbedding> = {};
    for (const kw of approvedKeywords) {
      const candIdx = nonCorpusCandidates.findIndex((c) => c.keyword === kw);
      if (candIdx >= 0) {
        const vec = session.candidateSimilarityVectors[candIdx];
        if (vec && vec.length > 0) {
          approvedEmbeddings[kw] = {
            values: vec,
            provider: session.providerId,
            model:
              session.providerId === "vertex" || session.providerId === "vertex_ai"
                ? "text-embedding-004"
                : "local_tfidf",
            taskType: "SEMANTIC_SIMILARITY",
            dimensions: vec.length,
            vectorSpaceId: session.vectorSpaceId,
            reusableAcrossRuns: session.reusableAcrossRuns,
          };
        }
      }
    }

    return {
      approvedKeywords,
      discardedKeywords,
      conflictReasons,
      relevanceScores,
      keywordClusters,
      conflictDetails:
        Object.keys(conflictDetails).length > 0 ? conflictDetails : undefined,
      corpusRevision,
      approvedEmbeddings:
        Object.keys(approvedEmbeddings).length > 0 ? approvedEmbeddings : undefined,
    };
  }
}
