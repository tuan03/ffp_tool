import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONFLICT_REASON,
  cosineSimilarity,
  canonicalizeKeyword,
  buildKeywordCandidates,
  removeExactDuplicates,
  buildProductReferences,
  LocalTfidfVectorizer,
  evaluateCandidateRelevance,
  clusterSemanticDuplicates,
  rankApprovedKeywords,
  DefaultKeywordConflictAnalyzer,
  EmptySeoConflictCorpus,
  FileSeoConflictCorpus,
  SeoConflictCorpusCorruptError,
  CorpusRevisionConflictError,
  CorpusLockTimeoutError,
  ListBrandConflictPolicy,
  isEmbeddingCompatible,
  isSameProduct,
  computeProductKey,
  type ExistingSeoTarget,
  type SeoConflictCorpus,
  type SeoConflictLookup,
  type SeoProductIdentity,
  type SeoProductKeywordRegistration,
  type StoredEmbedding,
  type TextEmbeddingProvider,
  type EmbeddingOptions,
} from "../internal/conflict-control";

import {
  createB4ConflictControlStage,
  executeB4ConflictControl,
  registerProductKeywords,
  retryOnCorpusRevisionConflict,
} from "../internal/stages/b4-conflict-control";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import type { SeoPipelineContext } from "../internal/domain-types";
import type { SeoContentInput } from "../types";

const mockSampleProduct: SeoContentInput = {
  title: "Vintage Black Cat Halloween T-Shirt",
  description: "Retro spooky black cat graphic apparel for Halloween party and cat lovers.",
  niche: "halloween cat t-shirt",
  handle: "vintage-black-cat-halloween-t-shirt",
  images: [{ url: "https://example.com/cat.jpg", alt: "Black Cat T-Shirt" }],
};

// ============================================================================
// Group A & B: Cosine Similarity Helper Tests
// ============================================================================

test("Cosine Similarity: calculates exact 1.0 for identical non-zero vectors", () => {
  const vecA = [1, 2, 3];
  const vecB = [1, 2, 3];
  const sim = cosineSimilarity(vecA, vecB);
  assert.ok(Math.abs(sim - 1.0) < 1e-6);
});

test("Cosine Similarity: calculates 0.0 for orthogonal vectors", () => {
  const vecA = [1, 0];
  const vecB = [0, 1];
  const sim = cosineSimilarity(vecA, vecB);
  assert.equal(sim, 0);
});

test("Cosine Similarity: calculates -1.0 for opposite vectors", () => {
  const vecA = [1, 2];
  const vecB = [-1, -2];
  const sim = cosineSimilarity(vecA, vecB);
  assert.ok(Math.abs(sim - (-1.0)) < 1e-6);
});

test("Cosine Similarity: guards length mismatch and returns 0 safely", () => {
  const vecA = [1, 2, 3];
  const vecB = [1, 2];
  assert.equal(cosineSimilarity(vecA, vecB), 0);
});

test("Cosine Similarity: guards zero vectors and returns 0 safely", () => {
  const vecA = [0, 0, 0];
  const vecB = [1, 2, 3];
  assert.equal(cosineSimilarity(vecA, vecB), 0);
});

test("Cosine Similarity: guards NaN and Infinity and returns 0 safely", () => {
  const vecA = [Number.NaN, 2, 3];
  const vecB = [1, 2, 3];
  assert.equal(cosineSimilarity(vecA, vecB), 0);

  const vecC = [Number.POSITIVE_INFINITY, 2, 3];
  assert.equal(cosineSimilarity(vecC, vecB), 0);
});

// ============================================================================
// Group C & D: Product References Builder Tests
// ============================================================================

test("Product References: builds deterministic Product Identity reference", () => {
  const refs = buildProductReferences({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: ["Spooky Night"],
      detectedEntities: ["black cat", "crescent moon"],
      dominantColors: ["black", "orange"],
      visualStyle: "vintage gothic",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers", "halloween enthusiasts"],
      suitableOccasions: ["halloween party"],
      useCases: ["casual wear"],
      buyerIntentKeywords: ["vintage black cat shirt", "spooky cat tee"],
    },
  });

  assert.match(refs.productIdentityText, /Product Category: t-shirt/);
  assert.match(refs.productIdentityText, /Product Title: Vintage Black Cat Halloween T-Shirt/);
  assert.match(refs.productIdentityText, /Visual Entities: black cat, crescent moon/);
  assert.match(refs.productIdentityText, /Design Text: Spooky Night/);
  assert.match(refs.shoppingIntentText, /Target Audience: cat lovers, halloween enthusiasts/);
  assert.match(refs.shoppingIntentText, /Buyer Search Intent: vintage black cat shirt, spooky cat tee/);
});

// ============================================================================
// Group J & K: Canonicalization and Exact Deduplication Tests
// ============================================================================

test("Keyword Candidate: canonicalizes case, hyphens, and whitespace consistently", () => {
  assert.equal(canonicalizeKeyword("  Black  Cat   T - Shirt  "), "black cat t-shirt");
  assert.equal(canonicalizeKeyword("VINTAGE   HALLOWEEN  TEE"), "vintage halloween tee");
  assert.equal(canonicalizeKeyword(""), "");
});

test("Keyword Candidate: removes exact duplicates prior to vectorization", () => {
  const candidates = buildKeywordCandidates({
    seedKeywords: ["Black Cat T-Shirt", "black cat t shirt", "vintage tee"],
    suggestedQueries: ["Black Cat T-Shirt", "black   cat   t-shirt", "retro tee"],
    querySources: {
      "Black Cat T-Shirt": "seed",
      "vintage tee": "category_seed",
    },
  });

  const dedup = removeExactDuplicates(candidates);
  assert.equal(dedup.uniqueCandidates.length, 4); // "black cat t-shirt" (x1), "black cat t shirt" (x1), "vintage tee", "retro tee"
  assert.equal(dedup.discardedCandidates.length, 2);
  assert.equal(dedup.discardedCandidates[0].reason, CONFLICT_REASON.EXACT_DUPLICATE);
});

// ============================================================================
// Group Q & R: Local Vectorizer Determinism & Synonym Normalization
// ============================================================================

test("Local TF-IDF Vectorizer: produces 100% identical vectors across 50 runs", () => {
  const text = "vintage black cat halloween t-shirt";
  const vectorizer = new LocalTfidfVectorizer();
  vectorizer.buildVocabulary([text, "retro black kitty halloween tee"]);

  const firstVec = vectorizer.vectorize(text);
  for (let i = 0; i < 50; i++) {
    const runVec = vectorizer.vectorize(text);
    assert.deepEqual(runVec, firstVec);
  }
});

test("Local TF-IDF Vectorizer: maps synonyms (retro->vintage, tee->t-shirt, kitty->cat)", () => {
  const vectorizer = new LocalTfidfVectorizer();
  vectorizer.buildVocabulary([
    "vintage black cat t-shirt",
    "retro black kitty tee",
  ]);

  const vecA = vectorizer.vectorize("vintage black cat t-shirt");
  const vecB = vectorizer.vectorize("retro black kitty tee");

  const sim = cosineSimilarity(vecA, vecB);
  // Synonym normalization should map tokens together, yielding high similarity
  assert.ok(sim > 0.70, `Expected synonym similarity > 0.70, got ${sim}`);
});

// ============================================================================
// Group E, F, G, H, I: Relevance, Guardrails, and Semantic Drift Tests
// ============================================================================

test("Conflict Analyzer: black-cat t-shirt accepts relevant keywords and rejects irrelevant drift", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer();

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: ["halloween"],
      useCases: ["casual wear"],
      buyerIntentKeywords: ["black cat t-shirt"],
    },
    searchResearch: {
      seedKeywords: ["black cat t-shirt", "cat lover shirt"],
      suggestedQueries: [
        "vintage halloween black cat tee",
        "rugby world cup 2026", // complete semantic drift & category conflict
        "cat food salmon kibble", // competing pet food category
        "how to draw a black cat", // informational intent query
      ],
      querySources: {},
    },
  });

  // Relevant keywords should be approved
  assert.ok(result.approvedKeywords.includes("black cat t-shirt"));
  assert.ok(result.approvedKeywords.includes("cat lover shirt"));
  assert.ok(result.approvedKeywords.includes("vintage halloween black cat tee"));

  // Rugby should be rejected
  assert.ok(result.discardedKeywords.includes("rugby world cup 2026"));
  assert.ok(
    result.conflictReasons["rugby world cup 2026"] === CONFLICT_REASON.CATEGORY_CONFLICT ||
      result.conflictReasons["rugby world cup 2026"] === CONFLICT_REASON.SEMANTIC_DRIFT,
  );

  // Cat food should be rejected as category conflict or semantic drift
  assert.ok(result.discardedKeywords.includes("cat food salmon kibble"));
  assert.ok(
    result.conflictReasons["cat food salmon kibble"] === CONFLICT_REASON.CATEGORY_CONFLICT ||
      result.conflictReasons["cat food salmon kibble"] === CONFLICT_REASON.SEMANTIC_DRIFT,
  );

  // How to draw should be rejected as search intent mismatch
  assert.ok(result.discardedKeywords.includes("how to draw a black cat"));
  assert.equal(
    result.conflictReasons["how to draw a black cat"],
    CONFLICT_REASON.SEARCH_INTENT_MISMATCH,
  );
});

test("Conflict Analyzer: 'gift for cat lover' is retained despite no category token", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer();

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lover", "cat lovers"],
      suitableOccasions: ["birthday gift", "halloween"],
      useCases: ["gift giving"],
      buyerIntentKeywords: ["gift for cat lover"],
    },
    searchResearch: {
      seedKeywords: ["gift for cat lover"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  assert.ok(
    result.approvedKeywords.includes("gift for cat lover"),
    "Expected 'gift for cat lover' to be approved as buyer intent",
  );
});

// ============================================================================
// Group L, M, N: Semantic Duplicate Clustering and Winner Selection
// ============================================================================

test("Conflict Analyzer: clusters semantic duplicates and retains the best representative", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer();

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: ["halloween"],
      useCases: ["casual wear"],
      buyerIntentKeywords: ["vintage black cat shirt"],
    },
    searchResearch: {
      seedKeywords: ["vintage black cat shirt"],
      suggestedQueries: [
        "retro black cat t-shirt", // semantic duplicate via synonym mapping
        "halloween black cat tee",  // distinct angle
      ],
      querySources: {
        "vintage black cat shirt": "seed",
        "retro black cat t-shirt": "google_autocomplete",
      },
    },
  });

  // Only one of "vintage black cat shirt" or "retro black cat t-shirt" should be approved
  const hasVintage = result.approvedKeywords.includes("vintage black cat shirt");
  const hasRetro = result.approvedKeywords.includes("retro black cat t-shirt");

  assert.ok(
    (hasVintage && !hasRetro) || (!hasVintage && hasRetro),
    "Expected exactly one in semantic duplicate pair to be approved",
  );

  const duplicateCandidate = hasVintage ? "retro black cat t-shirt" : "vintage black cat shirt";
  assert.ok(result.discardedKeywords.includes(duplicateCandidate));
  assert.equal(
    result.conflictReasons[duplicateCandidate],
    CONFLICT_REASON.SEMANTIC_DUPLICATE,
  );
});

test("Semantic Duplicate Clusterer: prevents transitive over-merge (A~B, B~C does NOT merge A and C)", () => {
  // Vector A: [1, 0, 0]
  // Vector B: angle 15 deg from A -> cos(15 deg) = 0.966 (duplicate with A)
  // Vector C: angle 35 deg from A (20 deg from B) -> cos(20 deg) = 0.940 from B, but cos(35 deg) = 0.819 from A (< 0.85)
  const rad15 = (15 * Math.PI) / 180;
  const rad35 = (35 * Math.PI) / 180;

  const vecA = [1, 0, 0];
  const vecB = [Math.cos(rad15), Math.sin(rad15), 0];
  const vecC = [Math.cos(rad35), Math.sin(rad35), 0];

  const candA = {
    candidate: {
      keyword: "black cat halloween shirt",
      normalized: "black cat halloween shirt",
      canonical: "black cat halloween shirt",
      source: "google_autocomplete",
      originalIndex: 0,
    },
    identitySimilarity: 0.95,
    intentSimilarity: 0.95,
    relevanceScore: 0.95,
    isRelevant: true,
  };
  const candB = {
    candidate: {
      keyword: "halloween cat shirt",
      normalized: "halloween cat shirt",
      canonical: "halloween cat shirt",
      source: "buyer_intent_seed",
      originalIndex: 1,
    },
    identitySimilarity: 0.9,
    intentSimilarity: 0.9,
    relevanceScore: 0.9,
    isRelevant: true,
  };
  const candC = {
    candidate: {
      keyword: "cute cat shirt",
      normalized: "cute cat shirt",
      canonical: "cute cat shirt",
      source: "niche_seed",
      originalIndex: 2,
    },
    identitySimilarity: 0.85,
    intentSimilarity: 0.85,
    relevanceScore: 0.85,
    isRelevant: true,
  };


  const thresholds = {
    relevancePass: 0.64,
    relevanceReject: 0.54,
    duplicateStrong: 0.9,
    duplicateReview: 0.85,
    informationalIntentThreshold: 0.55,
  };

  const result = clusterSemanticDuplicates({
    relevantEvaluations: [candA, candB, candC],
    similarityVectors: [vecA, vecB, vecC],
    thresholds,
  });

  // A is leader of Cluster 1
  // B matches A (sim >= 0.90) -> joins Cluster 1 (discarded)
  // C compared against leader A: sim ≈ 0.819 < 0.85 -> does NOT join Cluster 1!
  // C creates Cluster 2 -> C is APPROVED!
  const approvedKeywords = result.approvedEvaluations.map((e) => e.candidate.keyword);
  const discardedKeywords = result.discardedEvaluations.map((d) => d.evaluation.candidate.keyword);

  assert.deepEqual(approvedKeywords, ["black cat halloween shirt", "cute cat shirt"]);
  assert.deepEqual(discardedKeywords, ["halloween cat shirt"]);
  assert.equal(result.discardedEvaluations[0].reason, CONFLICT_REASON.SEMANTIC_DUPLICATE);
});

// ============================================================================
// Group S, T: Existing URL Cannibalization & Corpus Separation
// ============================================================================


test("Conflict Analyzer: never claims existing URL cannibalization when corpus is absent", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer({
    conflictCorpus: new EmptySeoConflictCorpus(),
  });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    searchResearch: {
      seedKeywords: ["black cat t-shirt"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  for (const reason of Object.values(result.conflictReasons)) {
    assert.notEqual(
      reason,
      CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
      "Must not emit existing_url_cannibalization when corpus is absent",
    );
  }
});

test("Conflict Analyzer: detects existing URL conflict when corpus provides matches", async () => {
  const fakeCorpus: SeoConflictCorpus = {
    async findConflicts(keyword: string): Promise<readonly ExistingSeoTarget[]> {
      if (keyword.toLowerCase().includes("black cat t-shirt")) {
        return [
          {
            url: "https://example.com/products/black-cat-t-shirt-classic",
            primaryKeyword: "black cat t-shirt",
          },
        ];
      }
      return [];
    },
  };

  const analyzer = new DefaultKeywordConflictAnalyzer({
    conflictCorpus: fakeCorpus,
  });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    searchResearch: {
      seedKeywords: ["black cat t-shirt", "halloween cat graphic tee"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  assert.ok(result.discardedKeywords.includes("black cat t-shirt"));
  assert.equal(
    result.conflictReasons["black cat t-shirt"],
    CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
  );
  assert.ok(result.approvedKeywords.includes("halloween cat graphic tee"));
});

test("Corpus Vector Compatibility: rejects comparing embeddings with different taskType even if provider, model, and dimensions match", () => {
  const embeddingDoc: StoredEmbedding = {
    values: [0.1, 0.2, 0.3],
    provider: "vertex_ai",
    model: "text-embedding-004",
    taskType: "RETRIEVAL_DOCUMENT",
    dimensions: 3,
  };

  const embeddingSim: StoredEmbedding = {
    values: [0.1, 0.2, 0.3],
    provider: "vertex_ai",
    model: "text-embedding-004",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 3,
  };

  assert.equal(
    isEmbeddingCompatible(embeddingDoc, embeddingSim),
    false,
    "Embeddings with different taskType must be incompatible",
  );
});

test("Corpus Vector Compatibility: accepts embeddings when provider, model, taskType, and dimensions all match", () => {
  const embeddingA: StoredEmbedding = {
    values: [0.1, 0.2, 0.3],
    provider: "vertex_ai",
    model: "text-embedding-004",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 3,
  };

  const embeddingB: StoredEmbedding = {
    values: [0.4, 0.5, 0.6],
    provider: "vertex_ai",
    model: "text-embedding-004",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 3,
  };

  assert.equal(
    isEmbeddingCompatible(embeddingA, embeddingB),
    true,
    "Embeddings with matching provider, model, taskType, and dimensions must be compatible",
  );
});

// ============================================================================
// Group U, V: Brand Conflict Guardrail Tests
// ============================================================================


test("Conflict Analyzer: never invents brand conflict when brand policy is absent", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer();

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    searchResearch: {
      seedKeywords: ["nike black cat shirt"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  // Without brand policy, Nike is not flagged as brand conflict
  assert.notEqual(
    result.conflictReasons["nike black cat shirt"],
    CONFLICT_REASON.BRAND_CONFLICT,
  );
});

test("Conflict Analyzer: flags prohibited brand when BrandConflictPolicy is injected", async () => {
  const brandPolicy = new ListBrandConflictPolicy(["nike", "disney"]);
  const analyzer = new DefaultKeywordConflictAnalyzer({ brandPolicy });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    searchResearch: {
      seedKeywords: ["black cat shirt", "nike black cat shirt"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  assert.ok(result.discardedKeywords.includes("nike black cat shirt"));
  assert.equal(
    result.conflictReasons["nike black cat shirt"],
    CONFLICT_REASON.BRAND_CONFLICT,
  );
});

// ============================================================================
// Group P & R: Single Vector Space Invariant (Fallback on failure)
// ============================================================================

test("Conflict Analyzer: recomputes ALL vectors locally if primary provider fails (never mixes vector spaces)", async () => {
  let fallbackLogged = false;

  // Fake provider that throws on embed
  const failingProvider: TextEmbeddingProvider = {
    providerId: "failing_vertex",
    async embed(): Promise<readonly (readonly number[])[]> {
      throw new Error("Simulated Vertex 503 Unavailable");
    },
  };

  const analyzer = new DefaultKeywordConflictAnalyzer({
    primaryEmbeddingProvider: failingProvider,
    onFallback: () => {
      fallbackLogged = true;
    },
  });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    searchResearch: {
      seedKeywords: ["black cat t-shirt"],
      suggestedQueries: ["spooky cat t-shirt"],
      querySources: {},
    },
  });

  assert.ok(fallbackLogged, "Expected fallback callback to be invoked");
  assert.ok(result.approvedKeywords.length > 0);
  assert.ok(result.approvedKeywords.includes("black cat t-shirt"));
});

// ============================================================================
// Group Z & AA: Pipeline Stage & Context Immutability
// ============================================================================

test("Stage B4: executes cleanly in SeoPipelineContext and enforces context immutability", async () => {
  const initial = createInitialContext(mockSampleProduct);
  const contextWithResearch = evolveContext(initial, {
    searchResearch: {
      seedKeywords: ["vintage black cat shirt", "vintage black cat shirt"],
      suggestedQueries: ["retro black cat tee", "rugby world cup"],
      querySources: {},
    },
  });

  const b4Stage = createB4ConflictControlStage();
  const nextContext = await b4Stage.execute(contextWithResearch);

  assert.notStrictEqual(nextContext, contextWithResearch);
  assert.strictEqual(nextContext.source, contextWithResearch.source);
  assert.ok(nextContext.conflictResult);
  assert.ok(Array.isArray(nextContext.conflictResult.approvedKeywords));
  assert.ok(Array.isArray(nextContext.conflictResult.discardedKeywords));
  assert.ok(typeof nextContext.conflictResult.conflictReasons === "object");
});

// ============================================================================
// Group BB: Gray Zone & Score Rejection Enforcement
// ============================================================================

test("Relevance Evaluator: rejects candidate keyword with score below relevanceReject even if anchor matches", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer({
    localThresholds: {
      relevancePass: 0.12,
      relevanceReject: 0.05, // Raised reject threshold
      duplicateStrong: 0.72,
      duplicateReview: 0.62,
      informationalIntentThreshold: 0.08,
    },
  });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: ["halloween"],
      useCases: ["casual wear"],
      buyerIntentKeywords: ["black cat t-shirt"],
    },
    searchResearch: {
      seedKeywords: ["black cat t-shirt"],
      // "cat carrier backpack airline approved" contains "cat" anchor, but its relevance is well below 0.05
      suggestedQueries: ["cat carrier backpack airline approved"],
      querySources: {},
    },
  });

  assert.ok(result.approvedKeywords.includes("black cat t-shirt"));
  assert.ok(result.discardedKeywords.includes("cat carrier backpack airline approved"));
  assert.equal(
    result.conflictReasons["cat carrier backpack airline approved"],
    CONFLICT_REASON.SEMANTIC_DRIFT,
  );
});

// ============================================================================
// Group CC: Regex Metacharacters Safety
// ============================================================================

test("Regex Safety: handles regex metacharacters in entities and brand policies without throwing", async () => {
  const brandPolicy = new ListBrandConflictPolicy(["Disney+", "Toys \"R\" Us", "C++", "A&F"]);
  const analyzer = new DefaultKeywordConflictAnalyzer({ brandPolicy });

  const result = await analyzer.analyze({
    source: {
      ...mockSampleProduct,
      niche: "gothic (retro) cat",
    },
    productUnderstanding: {
      ocrTexts: ["100% cotton!"],
      detectedEntities: ["cat (spooky)", "+size", "[limited] edition"],
      dominantColors: ["black"],
      visualStyle: "vintage [retro]",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers (all)"],
      suitableOccasions: ["halloween party"],
      useCases: ["casual"],
      buyerIntentKeywords: ["black cat tee"],
    },
    searchResearch: {
      seedKeywords: ["black cat tee", "disney+ black cat tee", "c++ programming shirt"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  assert.ok(result.approvedKeywords.includes("black cat tee"));
  assert.ok(result.discardedKeywords.includes("disney+ black cat tee"));
  assert.equal(
    result.conflictReasons["disney+ black cat tee"],
    CONFLICT_REASON.BRAND_CONFLICT,
  );
  assert.ok(result.discardedKeywords.includes("c++ programming shirt"));
  assert.equal(
    result.conflictReasons["c++ programming shirt"],
    CONFLICT_REASON.BRAND_CONFLICT,
  );
});

// ============================================================================
// Group DD: Canonicalization Punctuation Trimming
// ============================================================================

test("Canonicalization: trims punctuation quotes, commas, and exclamation marks for exact deduplication", () => {
  assert.equal(canonicalizeKeyword('"vintage black cat t-shirt"'), "vintage black cat t-shirt");
  assert.equal(canonicalizeKeyword("vintage black cat t-shirt,"), "vintage black cat t-shirt");
  assert.equal(canonicalizeKeyword("spooky cat tee!"), "spooky cat tee");

  const candidates = buildKeywordCandidates({
    seedKeywords: ['"vintage black cat t-shirt"', "vintage black cat t-shirt,"],
    suggestedQueries: ["spooky cat tee!", "spooky cat tee"],
    querySources: {},
  });

  const dedup = removeExactDuplicates(candidates);
  assert.equal(dedup.uniqueCandidates.length, 2);
  assert.equal(dedup.discardedCandidates.length, 2);
  assert.equal(dedup.discardedCandidates[0].reason, CONFLICT_REASON.EXACT_DUPLICATE);
  assert.equal(dedup.discardedCandidates[1].reason, CONFLICT_REASON.EXACT_DUPLICATE);
});

// ============================================================================
// Group EE: Vector Session Batch Length Guard
// ============================================================================

test("Vector Session: falls back safely if primary provider returns partial/mismatched batch", async () => {
  let fallbackInvoked = false;

  // Faulty provider that returns 2 ref doc vectors but only 1 query vector when 2 were requested
  const partialProvider: TextEmbeddingProvider = {
    providerId: "partial_vertex",
    async embed(texts: readonly string[], options: EmbeddingOptions): Promise<readonly (readonly number[])[]> {
      if (options.taskType === "RETRIEVAL_DOCUMENT") {
        return [[1, 0], [0, 1]];
      }
      // Return fewer vectors than requested texts
      return [[0.5, 0.5]];
    },
  };

  const analyzer = new DefaultKeywordConflictAnalyzer({
    primaryEmbeddingProvider: partialProvider,
    onFallback: () => {
      fallbackInvoked = true;
    },
  });

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    searchResearch: {
      seedKeywords: ["black cat t-shirt", "halloween cat tee"],
      suggestedQueries: [],
      querySources: {},
    },
  });

  assert.ok(fallbackInvoked, "Expected fallback to trigger due to batch mismatch");
  assert.ok(result.approvedKeywords.length > 0);
});

// ============================================================================
// Group FF: Metadata Enrichment in ConflictResult
// ============================================================================

test("Conflict Result: populates relevanceScores and keywordClusters for downstream Stage B5", async () => {
  const analyzer = new DefaultKeywordConflictAnalyzer();

  const result = await analyzer.analyze({
    source: mockSampleProduct,
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: ["halloween"],
      useCases: ["casual wear"],
      buyerIntentKeywords: ["vintage black cat shirt"],
    },
    searchResearch: {
      seedKeywords: ["vintage black cat shirt"],
      suggestedQueries: [
        "retro black cat t-shirt", // duplicate of vintage black cat shirt
        "cute halloween cat tee",  // distinct
      ],
      querySources: {},
    },
  });

  assert.ok(result.relevanceScores, "Expected relevanceScores to be defined");
  for (const approvedKw of result.approvedKeywords) {
    assert.equal(typeof result.relevanceScores[approvedKw], "number");
    assert.ok(result.relevanceScores[approvedKw] > 0);
  }

  assert.ok(Array.isArray(result.keywordClusters), "Expected keywordClusters array");
  assert.ok(result.keywordClusters.length > 0);
  for (const cluster of result.keywordClusters) {
    assert.ok(cluster.representative);
    assert.ok(Array.isArray(cluster.members));
    assert.ok(cluster.members.includes(cluster.representative));
  }
});

// ============================================================================
// Group GG: Corpus Provider Compatibility Alias ("vertex" vs "vertex_ai")
// ============================================================================

test("Corpus Vector Compatibility: accepts provider aliases ('vertex' and 'vertex_ai')", () => {
  const embeddingA: StoredEmbedding = {
    values: [0.1, 0.2, 0.3],
    provider: "vertex",
    model: "text-embedding-004",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 3,
  };

  const embeddingB: StoredEmbedding = {
    values: [0.4, 0.5, 0.6],
    provider: "vertex_ai",
    model: "text-embedding-004",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 3,
  };

  assert.equal(
    isEmbeddingCompatible(embeddingA, embeddingB),
    true,
    "Expected 'vertex' and 'vertex_ai' to be treated as compatible provider aliases",
  );
});

// ============================================================================
// Group AC to BC: File-based Store Catalog SEO Conflict Corpus & Cross-Product Cannibalization
// ============================================================================

test("Corpus File: missing JSON file initializes empty corpus with schemaVersion 1", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    const snapshot = await corpus.getSnapshot();

    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.normalizationVersion, 1);
    assert.equal(snapshot.revision, 0);
    assert.deepEqual(snapshot.products, []);

    const conflicts = await corpus.findConflicts("personalized music rug");
    assert.deepEqual(conflicts, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Corpus File: save -> reload round-trip preserves products, keywords, ranks, and revision", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus1 = new FileSeoConflictCorpus({ filePath });
    const regResult = await corpus1.upsertProduct({
      identity: {
        productId: "prod_101",
        handle: "personalized-music-player-rug",
        url: "/products/personalized-music-player-rug",
      },
      title: "Personalized Music Player Rug",
      approvedKeywords: [
        "personalized music player rug",
        "custom music carpet",
        "spotify code rug",
      ],
    });

    assert.equal(regResult.revision, 1);

    // Instantiate a new corpus reader pointing to the same file
    const corpus2 = new FileSeoConflictCorpus({ filePath });
    const snapshot = await corpus2.getSnapshot();

    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.products.length, 1);
    const prod = snapshot.products[0];
    assert.equal(prod.productId, "prod_101");
    assert.equal(prod.handle, "personalized-music-player-rug");
    assert.equal(prod.title, "Personalized Music Player Rug");
    assert.equal(prod.keywords.length, 3);
    assert.equal(prod.keywords[0].rank, 0);
    assert.equal(prod.keywords[0].keyword, "personalized music player rug");
    assert.equal(prod.keywords[1].rank, 1);
    assert.equal(prod.keywords[2].rank, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Corpus File: corrupt JSON throws SeoConflictCorpusCorruptError and never silently resets", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "corrupt-corpus.json");

  try {
    fs.writeFileSync(filePath, "{ invalid json: [corrupt... }", "utf-8");
    const corpus = new FileSeoConflictCorpus({ filePath });

    await assert.rejects(
      async () => corpus.getSnapshot(),
      SeoConflictCorpusCorruptError,
      "Expected getSnapshot() to throw SeoConflictCorpusCorruptError on corrupt file",
    );

    await assert.rejects(
      async () => corpus.findConflicts("music rug"),
      SeoConflictCorpusCorruptError,
      "Expected findConflicts() to throw on corrupt file",
    );

    await assert.rejects(
      async () =>
        corpus.upsertProduct({
          identity: { handle: "test" },
          approvedKeywords: ["test"],
        }),
      SeoConflictCorpusCorruptError,
      "Expected upsertProduct() to throw on corrupt file",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Cross-Product Conflict: exact keyword match across products triggers existing_url_cannibalization", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    // Product 1 registers keywords
    await corpus.upsertProduct({
      identity: {
        productId: "prod_001",
        handle: "personalized-music-player-rug",
      },
      title: "Personalized Music Player Rug",
      approvedKeywords: ["personalized music player rug", "music album rug"],
    });

    // Product 2 tries to use Product 1's keyword
    const analyzer = new DefaultKeywordConflictAnalyzer({ conflictCorpus: corpus });
    const product2: SeoContentInput = {
      title: "Custom Spotify Song Carpet",
      handle: "custom-spotify-song-carpet",
      niche: "custom music rug",
      description: "Custom printed carpet with your favorite song code.",
      images: [],
    };

    const result = await analyzer.analyze({
      source: product2,
      searchResearch: {
        seedKeywords: [
          "personalized music player rug", // Exact match with Product 1 -> cannibalization!
          "custom spotify song carpet",    // Unique to Product 2
        ],
        suggestedQueries: [],
        querySources: {},
      },
    });

    assert.ok(result.discardedKeywords.includes("personalized music player rug"));
    assert.equal(
      result.conflictReasons["personalized music player rug"],
      CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
    );
    assert.ok(result.conflictDetails);
    assert.equal(
      result.conflictDetails["personalized music player rug"].conflictingHandle,
      "personalized-music-player-rug",
    );
    assert.equal(
      result.conflictDetails["personalized music player rug"].matchType,
      "exact",
    );
    assert.ok(result.approvedKeywords.includes("custom spotify song carpet"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Cross-Product Conflict: dense semantic vector similarity detects cannibalization", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Store Product 1 with an embedding
    const unitVectorA = [1, 0, 0];
    await corpus.upsertProduct({
      identity: { handle: "retro-music-rug" },
      title: "Retro Music Rug",
      approvedKeywords: [
        {
          keyword: "vintage vinyl record carpet",
          rank: 0,
          embedding: {
            values: unitVectorA,
            provider: "vertex_ai",
            model: "text-embedding-004",
            taskType: "SEMANTIC_SIMILARITY",
            dimensions: 3,
            vectorSpaceId: "vertex:text-embedding-004:SEMANTIC_SIMILARITY:768",
            reusableAcrossRuns: true,
          },
        },
      ],
    });

    // Product 2 looks up with very similar vector (cosine similarity ~ 0.999 >= 0.86 review threshold)
    const unitVectorB = [0.999, 0.04, 0];
    const conflicts = await corpus.findConflicts({
      keyword: "retro vinyl disc rug",
      owner: { handle: "new-turntable-mat" },
      embedding: {
        values: unitVectorB,
        provider: "vertex_ai",
        model: "text-embedding-004",
        taskType: "SEMANTIC_SIMILARITY",
        dimensions: 3,
        vectorSpaceId: "vertex:text-embedding-004:SEMANTIC_SIMILARITY:768",
        reusableAcrossRuns: true,
      },
    });

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].matchType, "semantic");
    assert.equal(conflicts[0].handle, "retro-music-rug");
    assert.ok(conflicts[0].similarity! >= 0.86);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Cross-Product Conflict: low similarity below threshold remains approved", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    await corpus.upsertProduct({
      identity: { handle: "retro-music-rug" },
      approvedKeywords: [
        {
          keyword: "vintage vinyl record carpet",
          rank: 0,
          embedding: {
            values: [1, 0, 0],
            provider: "vertex_ai",
            model: "text-embedding-004",
            taskType: "SEMANTIC_SIMILARITY",
            dimensions: 3,
            vectorSpaceId: "vertex:text-embedding-004:SEMANTIC_SIMILARITY:768",
            reusableAcrossRuns: true,
          },
        },
      ],
    });

    // Orthogonal / low similarity vector
    const conflicts = await corpus.findConflicts({
      keyword: "outdoor camping tent",
      owner: { handle: "hiking-gear" },
      embedding: {
        values: [0, 1, 0],
        provider: "vertex_ai",
        model: "text-embedding-004",
        taskType: "SEMANTIC_SIMILARITY",
        dimensions: 3,
        vectorSpaceId: "vertex:text-embedding-004:SEMANTIC_SIMILARITY:768",
        reusableAcrossRuns: true,
      },
    });

    assert.equal(conflicts.length, 0, "Orthogonal vector must not produce conflict");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Self-Conflict Prevention: same productId does not cannibalize its own keywords on rerun", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    await corpus.upsertProduct({
      identity: {
        productId: "prod_music_99",
        handle: "music-rug-v1",
      },
      title: "Music Rug",
      approvedKeywords: ["personalized music player rug"],
    });

    // Lookup with identical productId (rerun of same product)
    const conflicts = await corpus.findConflicts({
      keyword: "personalized music player rug",
      owner: { productId: "prod_music_99" },
    });

    assert.equal(
      conflicts.length,
      0,
      "Lookup from same productId must be excluded from conflict check",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Self-Conflict Prevention: same handle does not cannibalize its own keywords on rerun", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    await corpus.upsertProduct({
      identity: { handle: "music-player-rug" },
      approvedKeywords: ["personalized music player rug"],
    });

    const conflicts = await corpus.findConflicts({
      keyword: "personalized music player rug",
      owner: { handle: "music-player-rug" },
    });

    assert.equal(
      conflicts.length,
      0,
      "Lookup from same handle must be excluded from conflict check",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Corpus Upsert: replaces entire keyword claim set (never appends old zombie keywords)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    const id = { handle: "music-rug" };

    // First run registers Old A and Old B
    await corpus.upsertProduct({
      identity: id,
      approvedKeywords: ["old keyword a", "old keyword b"],
    });

    let snapshot = await corpus.getSnapshot();
    assert.deepEqual(
      snapshot.products[0].keywords.map((k) => k.keyword),
      ["old keyword a", "old keyword b"],
    );

    // Second run replaces with New C and New D
    await corpus.upsertProduct({
      identity: id,
      approvedKeywords: ["new keyword c", "new keyword d"],
    });

    snapshot = await corpus.getSnapshot();
    assert.equal(snapshot.products.length, 1);
    assert.deepEqual(
      snapshot.products[0].keywords.map((k) => k.keyword),
      ["new keyword c", "new keyword d"],
      "Upsert must replace, not append old keywords",
    );

    // Old A should no longer cause conflict for other products
    const conflicts = await corpus.findConflicts({
      keyword: "old keyword a",
      owner: { handle: "other-product" },
    });
    assert.equal(conflicts.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Corpus Remove: removeProduct releases keyword ownership", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    await corpus.upsertProduct({
      identity: { handle: "deleted-item" },
      approvedKeywords: ["unique deleted keyword"],
    });

    let conflicts = await corpus.findConflicts({
      keyword: "unique deleted keyword",
      owner: { handle: "other-product" },
    });
    assert.equal(conflicts.length, 1);

    await corpus.removeProduct({ handle: "deleted-item" });

    conflicts = await corpus.findConflicts({
      keyword: "unique deleted keyword",
      owner: { handle: "other-product" },
    });
    assert.equal(conflicts.length, 0, "Keyword should be released after product removal");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Persistent Embedding Invariant: local TF-IDF embeddings with reusableAcrossRuns === false are never reused", () => {
  const embeddingA: StoredEmbedding = {
    values: [0.5, 0.5],
    provider: "local_tfidf",
    model: "local_tfidf",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 2,
    vectorSpaceId: "session_1",
    reusableAcrossRuns: false,
  };

  const embeddingB: StoredEmbedding = {
    values: [0.5, 0.5],
    provider: "local_tfidf",
    model: "local_tfidf",
    taskType: "SEMANTIC_SIMILARITY",
    dimensions: 2,
    vectorSpaceId: "session_2",
    reusableAcrossRuns: false,
  };

  assert.equal(
    isEmbeddingCompatible(embeddingA, embeddingB),
    false,
    "Dynamic embeddings from different sessions with reusableAcrossRuns: false must never be compatible",
  );
});

test("Deterministic Serialization: products sorted by productKey ASC and keywords sorted by rank ASC", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Insert out of alphabetical order: zebra -> apple -> mango
    await corpus.upsertProduct({ identity: { handle: "zebra" }, approvedKeywords: ["z kw"] });
    await corpus.upsertProduct({ identity: { handle: "apple" }, approvedKeywords: ["a kw"] });
    await corpus.upsertProduct({ identity: { handle: "mango" }, approvedKeywords: ["m kw"] });

    const rawFileContent = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(rawFileContent);

    const keys = parsed.products.map((p: { productKey: string }) => p.productKey);
    assert.deepEqual(keys, ["handle:apple", "handle:mango", "handle:zebra"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Optimistic Concurrency: rejects upsert when expectedRevision does not match current revision", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });
    // Write 1: revision becomes 1
    await corpus.upsertProduct({ identity: { handle: "prod-1" }, approvedKeywords: ["kw1"] });

    // Worker expects revision 0, but current is 1
    await assert.rejects(
      async () =>
        corpus.upsertProduct({
          identity: { handle: "prod-2" },
          approvedKeywords: ["kw2"],
          expectedRevision: 0,
        }),
      CorpusRevisionConflictError,
      "Expected CorpusRevisionConflictError when expectedRevision differs from actual revision",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Atomic Write & Lock: concurrent upserts serialize safely without corruption", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Run 5 concurrent writes simultaneously
    const tasks = Array.from({ length: 5 }, (_, i) =>
      corpus.upsertProduct({
        identity: { handle: `concurrent-prod-${i}` },
        approvedKeywords: [`keyword for ${i}`],
      }),
    );

    const results = await Promise.all(tasks);
    assert.equal(results.length, 5);

    const snapshot = await corpus.getSnapshot();
    assert.equal(snapshot.products.length, 5);
    assert.equal(snapshot.revision, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Cross-Product Integration: Product 1 ('Personalized Music Player Rug') vs Product 2 ('Custom Spotify Song Carpet')", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // 1. Stage B4 on Product 1
    const product1: SeoContentInput = {
      title: "Personalized Music Player Rug",
      handle: "personalized-music-player-rug",
      niche: "music rug",
      description: "Custom printed song album player mat for bedroom decoration.",
      images: [],
    };

    const analyzer1 = new DefaultKeywordConflictAnalyzer({ conflictCorpus: corpus });
    const result1 = await analyzer1.analyze({
      source: product1,
      searchResearch: {
        seedKeywords: ["personalized music player rug", "music album player rug"],
        suggestedQueries: ["custom song mat"],
        querySources: {},
      },
    });

    assert.ok(result1.approvedKeywords.includes("personalized music player rug"));

    // 2. Register approved keywords of Product 1 into the Store Database
    const regResult = await registerProductKeywords(
      corpus,
      product1,
      result1.approvedKeywords,
    );
    assert.equal(regResult.revision, 1);

    // 3. Stage B4 on Product 2 (Different Product in Catalog)
    const product2: SeoContentInput = {
      title: "Custom Spotify Song Carpet",
      handle: "custom-spotify-song-carpet",
      niche: "song carpet",
      description: "Custom music player scannable soundwave carpet.",
      images: [],
    };

    const analyzer2 = new DefaultKeywordConflictAnalyzer({ conflictCorpus: corpus });
    const result2 = await analyzer2.analyze({
      source: product2,
      searchResearch: {
        seedKeywords: [
          "personalized music player rug", // Belongs to Product 1 -> must be discarded!
          "custom spotify song carpet",    // Unique to Product 2 -> must be approved!
        ],
        suggestedQueries: ["spotify soundwave carpet"],
        querySources: {},
      },
    });

    // Verification: Cannibalized keyword was rejected with conflict details
    assert.ok(result2.discardedKeywords.includes("personalized music player rug"));
    assert.equal(
      result2.conflictReasons["personalized music player rug"],
      CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
    );
    assert.ok(result2.conflictDetails);
    assert.equal(
      result2.conflictDetails["personalized music player rug"].conflictingHandle,
      "personalized-music-player-rug",
    );

    // Verification: Product 2 unique keywords are approved
    assert.ok(result2.approvedKeywords.includes("custom spotify song carpet"));
    assert.ok(!result2.approvedKeywords.includes("personalized music player rug"));

    // 4. Idempotent rerun: Product 1 reruns with the same corpus -> does NOT cannibalize itself!
    const rerunResult1 = await analyzer1.analyze({
      source: product1,
      searchResearch: {
        seedKeywords: ["personalized music player rug"],
        suggestedQueries: [],
        querySources: {},
      },
    });

    assert.ok(
      rerunResult1.approvedKeywords.includes("personalized music player rug"),
      "Product 1 must not self-conflict with its own existing registration in corpus",
    );
    assert.ok(!rerunResult1.discardedKeywords.includes("personalized music player rug"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Group AS: Shared Local TF-IDF Vectorization with Catalog Keywords
// ============================================================================

test("Group AS: Rebuilds one shared local vector space with corpus stored raw keywords for semantic fallback", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // 1. Existing catalog product has registered keywords (raw text only, no persistent Vertex vectors)
    await corpus.upsertProduct({
      identity: { handle: "vintage-halloween-cat-tee", productId: "prod_cat_1" },
      title: "Vintage Halloween Cat T-Shirt",
      approvedKeywords: [
        "vintage halloween cat tee", // rank 0 primary
        "spooky kitten retro apparel", // rank 1 secondary
      ],
    });

    // 2. Product 2 runs locally with LocalTfidfVectorizer (NO Vertex)
    const product2: SeoContentInput = {
      title: "Retro Spooky Kitty Autumn Shirt",
      handle: "retro-spooky-kitty-autumn-shirt",
      niche: "halloween apparel",
      description: "Spooky kitten retro apparel for autumn lovers.",
      images: [],
    };

    const analyzer = new DefaultKeywordConflictAnalyzer({
      fallbackEmbeddingProvider: new LocalTfidfVectorizer(),
      conflictCorpus: corpus,
    });

    const result = await analyzer.analyze({
      source: product2,
      productUnderstanding: {
        ocrTexts: [],
        detectedEntities: ["kitten", "halloween"],
        dominantColors: ["black"],
        visualStyle: "retro",
        productCategory: "t-shirt",
      },
      searchResearch: {
        seedKeywords: [
          // Semantic match with Product 1's rank 0 ("vintage halloween cat tee") via synonym "retro" -> "vintage", "tee" -> "t-shirt"
          "retro halloween cat t-shirt",
          // Unique to Product 2
          "autumn kitten pumpkin shirt",
        ],
        suggestedQueries: [],
        querySources: {},
      },
    });

    // Verify: "retro halloween cat t-shirt" is identified as existing URL cannibalization
    // via shared local TF-IDF vectorization against the corpus snapshot!
    assert.ok(
      result.discardedKeywords.includes("retro halloween cat t-shirt"),
      "Must discard semantic equivalent in local fallback mode",
    );
    assert.equal(
      result.conflictReasons["retro halloween cat t-shirt"],
      CONFLICT_REASON.EXISTING_URL_CANNIBALIZATION,
    );
    assert.ok(result.conflictDetails);
    assert.equal(
      result.conflictDetails["retro halloween cat t-shirt"].conflictingHandle,
      "vintage-halloween-cat-tee",
    );
    assert.equal(
      result.conflictDetails["retro halloween cat t-shirt"].matchType,
      "semantic",
    );

    // Verify: Unique keyword is approved
    assert.ok(result.approvedKeywords.includes("autumn kitten pumpkin shirt"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Group AI: Gray-Zone Contextual Review (0.86 - 0.90)
// ============================================================================

test("Group AI: Gray-zone contextual review (0.86 - 0.90) conflicts on same category/intent but keeps on materially different intent", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Vector with length 1: [1, 0] for catalog primary keyword
    const baseVec: StoredEmbedding = {
      values: [1, 0],
      provider: "vertex_ai",
      model: "text-embedding-004",
      taskType: "SEMANTIC_SIMILARITY",
      dimensions: 2,
    };

    // Vector with cosine similarity exactly 0.87: [0.87, Math.sqrt(1 - 0.87*0.87)]
    const sim087Vec: StoredEmbedding = {
      values: [0.87, Math.sqrt(1 - 0.87 * 0.87)],
      provider: "vertex_ai",
      model: "text-embedding-004",
      taskType: "SEMANTIC_SIMILARITY",
      dimensions: 2,
    };

    // 1. Existing product in Catalog: "Personalized Music Player Rug"
    await corpus.upsertProduct({
      identity: { handle: "personalized-music-player-rug" },
      title: "Personalized Music Player Rug",
      approvedKeywords: [
        {
          keyword: "personalized music player rug",
          rank: 0,
          embedding: baseVec,
        },
      ],
    });

    // Fixture 1: similarity 0.87 + same category / intent ("rug", "music") -> CONFLICT!
    const conflictsA = await corpus.findConflicts({
      keyword: "custom song player mat",
      embedding: sim087Vec,
      productCategory: "rug",
      productTitle: "Custom Song Player Mat",
    });

    assert.equal(
      conflictsA.length,
      1,
      "similarity 0.87 + same category + same theme/intent must conflict",
    );
    assert.equal(conflictsA[0].handle, "personalized-music-player-rug");
    assert.equal(conflictsA[0].matchType, "semantic");
    assert.equal(conflictsA[0].similarity, 0.87);

    // Fixture 2: similarity 0.87 + materially different search intent / category ("pin") -> KEEP / APPROVE!
    const conflictsB = await corpus.findConflicts({
      keyword: "music player enamel pin",
      embedding: sim087Vec,
      productCategory: "pin",
      productTitle: "Music Player Enamel Pin Badge",
    });

    assert.equal(
      conflictsB.length,
      0,
      "similarity 0.87 + materially different search intent must be kept (no conflict)",
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Group BC: Pipeline Integration (B4 -> B5/B6 -> Registration)
// ============================================================================

test("Group BC: Pipeline integration carries corpusRevision from B4 through B5/B6 to registerProductKeywords", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Initial corpus at revision 0
    const snapshot0 = await corpus.getSnapshot();
    assert.equal(snapshot0.revision, 0);

    const product: SeoContentInput = {
      title: "Cute Highland Cow Ceramic Mug",
      handle: "cute-highland-cow-ceramic-mug",
      niche: "cow mug",
      description: "Rustic farmhouse Scottish highland cow coffee cup.",
      images: [{ url: "https://example.com/mug.jpg", alt: "Cow Mug" }],
    };

    // Stage B4 execution
    const initialContext = createInitialContext(product);
    const contextWithResearch = evolveContext(initialContext, {
      searchResearch: {
        seedKeywords: ["cute highland cow mug", "scottish cow coffee cup"],
        suggestedQueries: [],
        querySources: {},
      },
      productUnderstanding: {
        ocrTexts: [],
        detectedEntities: ["highland cow"],
        dominantColors: ["brown"],
        visualStyle: "rustic",
        productCategory: "ceramic mug",
      },
    });

    const b4Stage = createB4ConflictControlStage({ conflictCorpus: corpus });
    const b4Context = await b4Stage.execute(contextWithResearch);

    assert.ok(b4Context.conflictResult);
    assert.equal(b4Context.conflictResult.corpusRevision, 0);
    assert.ok(b4Context.conflictResult.approvedKeywords.length > 0);

    // Mock Stage B5 / B6 completion
    const b5b6Context = evolveContext(b4Context, {
      contentResult: {
        productTitle: "Cute Highland Cow Ceramic Mug",
        productDescription: "Handcrafted coffee mug.",
        productSeoTitle: "Cute Highland Cow Ceramic Mug | Coffee Cup",
        productSeoDescription: "Scottish cow cup.",
        productHandle: product.handle,
      },
    });

    // Final Catalog Registration carrying the revision captured during B4
    const regResult = await registerProductKeywords(
      corpus,
      b5b6Context.source,
      b5b6Context.conflictResult!.approvedKeywords,
      {
        expectedRevision: b5b6Context.conflictResult!.corpusRevision,
      },
    );

    assert.equal(regResult.revision, 1);

    const snapshot1 = await corpus.getSnapshot();
    assert.equal(snapshot1.revision, 1);
    assert.equal(snapshot1.products.length, 1);
    assert.equal(snapshot1.products[0].handle, "cute-highland-cow-ceramic-mug");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Group Race: Concurrent Writers & Optimistic Revision Conflict Retry
// ============================================================================

test("Race Condition: concurrent pipeline worker detects stale expectedRevision, retries from B4, and commits safely", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-test-corpus-"));
  const filePath = path.join(tmpDir, "conflict-corpus.json");

  try {
    const corpus = new FileSeoConflictCorpus({ filePath });

    // Seed product in database -> revision = 1
    await corpus.upsertProduct({
      identity: { handle: "seed-item" },
      approvedKeywords: ["seed keyword"],
    });

    const baseSnapshot = await corpus.getSnapshot();
    assert.equal(baseSnapshot.revision, 1);

    // Worker A and Worker B both analyze at revision 1
    const productA: SeoContentInput = {
      title: "Worker A Sunflower Tote Bag",
      handle: "worker-a-sunflower-tote-bag",
      niche: "tote bag",
      description: "Floral canvas tote bag.",
      images: [],
    };

    const productB: SeoContentInput = {
      title: "Worker B Daisy Tote Bag",
      handle: "worker-b-daisy-tote-bag",
      niche: "tote bag",
      description: "Canvas shoulder bag with flowers.",
      images: [],
    };

    const analyzerA = new DefaultKeywordConflictAnalyzer({ conflictCorpus: corpus });
    const analyzerB = new DefaultKeywordConflictAnalyzer({ conflictCorpus: corpus });

    // Both analyze simultaneously reading revision 1
    const resultA = await analyzerA.analyze({
      source: productA,
      searchResearch: {
        seedKeywords: ["sunflower canvas tote bag"],
        suggestedQueries: [],
        querySources: {},
      },
    });
    assert.equal(resultA.corpusRevision, 1);

    const resultB = await analyzerB.analyze({
      source: productB,
      searchResearch: {
        seedKeywords: ["daisy floral shoulder bag"],
        suggestedQueries: [],
        querySources: {},
      },
    });
    assert.equal(resultB.corpusRevision, 1);

    // Worker A finishes and commits first -> revision becomes 2!
    const commitA = await registerProductKeywords(
      corpus,
      productA,
      resultA.approvedKeywords,
      { expectedRevision: resultA.corpusRevision },
    );
    assert.equal(commitA.revision, 2);

    // Worker B attempts to commit with stale expectedRevision (1), but actual is now 2
    await assert.rejects(
      async () =>
        registerProductKeywords(
          corpus,
          productB,
          resultB.approvedKeywords,
          { expectedRevision: resultB.corpusRevision },
        ),
      CorpusRevisionConflictError,
      "Worker B must fail on stale expectedRevision",
    );

    // Worker B retries using retryOnCorpusRevisionConflict
    let retriesHappened = 0;
    const retryCommit = await retryOnCorpusRevisionConflict(
      async (attempt) => {
        if (attempt === 0) {
          // Attempt 0 uses the initial result with stale revision 1 -> triggers conflict
          return registerProductKeywords(
            corpus,
            productB,
            resultB.approvedKeywords,
            { expectedRevision: resultB.corpusRevision },
          );
        }
        // Attempt > 0: re-runs B4 with fresh corpus snapshot
        const freshResultB = await analyzerB.analyze({
          source: productB,
          searchResearch: {
            seedKeywords: ["daisy floral shoulder bag"],
            suggestedQueries: [],
            querySources: {},
          },
        });
        return registerProductKeywords(
          corpus,
          productB,
          freshResultB.approvedKeywords,
          { expectedRevision: freshResultB.corpusRevision },
        );
      },
      {
        onRetry: () => {
          retriesHappened++;
        },
      },
    );

    // Retry succeeded with revision 3!
    assert.equal(retriesHappened, 1);
    assert.equal(retryCommit.revision, 3);

    const finalSnapshot = await corpus.getSnapshot();
    assert.equal(finalSnapshot.revision, 3);
    assert.equal(finalSnapshot.products.length, 3); // seed-item, worker-a, worker-b
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


