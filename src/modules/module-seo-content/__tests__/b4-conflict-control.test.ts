import assert from "node:assert/strict";
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
  ListBrandConflictPolicy,
  isEmbeddingCompatible,
  type ExistingSeoTarget,
  type SeoConflictCorpus,
  type StoredEmbedding,
  type TextEmbeddingProvider,
  type EmbeddingOptions,
} from "../internal/conflict-control";

import {
  createB4ConflictControlStage,
  executeB4ConflictControl,
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
