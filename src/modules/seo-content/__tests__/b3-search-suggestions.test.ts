import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProductUnderstanding,
  SearchResearchResult,
  SeoPipelineContext,
  ShoppingContext,
} from "../internal/domain-types";
import {
  createInitialContext,
  evolveContext,
} from "../internal/pipeline-context";
import {
  QUERY_SOURCE,
  shouldUpgradeSource,
} from "../internal/search-suggestions/query-source";
import {
  GoogleSuggestBlockedError,
  GoogleSuggestError,
  GoogleSuggestRateLimitError,
} from "../internal/search-suggestions/search-suggestion-errors";
import {
  MAX_B2_SEEDS,
  MAX_SEARCH_SEEDS,
  selectSearchSeeds,
} from "../internal/search-suggestions/search-seed-selector";
import {
  canonicalKey,
  MAX_GLOBAL_SUGGESTIONS,
  MAX_PER_SEED_SUGGESTIONS,
  normalizeSuggestionQuery,
} from "../internal/search-suggestions/search-suggestions-normalizer";
import {
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  type GoogleSuggestClient,
  type GoogleSuggestRequestOptions,
  UnofficialGoogleSuggestClient,
} from "../internal/search-suggestions/google-suggest-client";
import {
  createSuggestCacheKey,
  InMemoryGoogleSuggestCache,
} from "../internal/search-suggestions/search-suggestions-cache";
import {
  FallbackSearchSuggestionsCollector,
  fallbackSearchSuggestionsCollector,
} from "../internal/search-suggestions/fallback-search-suggestions-collector";
import {
  GoogleSearchSuggestionsCollector,
} from "../internal/search-suggestions/google-search-suggestions-collector";
import {
  b3SearchSuggestionsStage,
  createB3SearchSuggestionsStage,
  createDefaultSearchSuggestionsCollector,
  executeB3SearchSuggestions,
} from "../internal/stages/b3-search-suggestions";
import { createSeoPipeline } from "../internal/pipeline";
import { b1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";
import { b2ShoppingContextStage } from "../internal/stages/b2-shopping-context";
import { b4ConflictControlStage } from "../internal/stages/b4-conflict-control";
import { seoContentMockInput } from "../mocks/data";
import { buildKeywordCandidates } from "../internal/conflict-control/keyword-candidate";
import { GeminiSearchQueryVariantGenerator } from "../internal/search-suggestions/gemini-search-query-variant-generator";
import { FakeGeminiContentGenerator } from "../internal/product-understanding/gemini-content-generator";

// Helper to create a fake fetch Response
function createMockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// GROUP A: Google valid [query, string[]] response parsing
// ---------------------------------------------------------------------------
test("Group A: Google valid [query, string[]] response parses correctly", async () => {
  const mockFetch: typeof fetch = async (url) => {
    return createMockJsonResponse(["cat mug", ["cat mug funny", "cat mug gift"]]);
  };

  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });
  const result = await client.getSuggestions("cat mug");

  assert.deepEqual(result, ["cat mug funny", "cat mug gift"]);
});

// ---------------------------------------------------------------------------
// GROUP B: Response with extra metadata is still parsed successfully
// ---------------------------------------------------------------------------
test("Group B: Response with extra metadata at index 2+ ignores metadata and parses suggestions", async () => {
  const mockFetch: typeof fetch = async () => {
    return createMockJsonResponse([
      "cat mug",
      ["cat mug funny", "cat mug with lid"],
      ["extra metadata", 12345],
      { additionalInfo: true },
    ]);
  };

  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });
  const result = await client.getSuggestions("cat mug");

  assert.deepEqual(result, ["cat mug funny", "cat mug with lid"]);
});

// ---------------------------------------------------------------------------
// GROUP C: Malformed JSON / Malformed shape rejection
// ---------------------------------------------------------------------------
test("Group C1: Non-array root response is rejected as non-retryable", async () => {
  const mockFetch: typeof fetch = async () => createMockJsonResponse({ error: "malformed" });
  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });

  await assert.rejects(
    async () => client.getSuggestions("cat"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(err.isRetryable, false);
      return true;
    },
  );
});

test("Group C2: Array with length < 2 is rejected as non-retryable", async () => {
  const mockFetch: typeof fetch = async () => createMockJsonResponse(["only-query"]);
  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });

  await assert.rejects(
    async () => client.getSuggestions("cat"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(err.isRetryable, false);
      return true;
    },
  );
});

test("Group C3: Array where index 1 contains non-string elements is rejected", async () => {
  const mockFetch: typeof fetch = async () => createMockJsonResponse(["cat", [123, null]]);
  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });

  await assert.rejects(
    async () => client.getSuggestions("cat"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(err.isRetryable, false);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// GROUP D: Query URL encoding
// ---------------------------------------------------------------------------
test("Group D: Query string with spaces and special characters is properly URL-encoded", async () => {
  let requestedUrl = "";
  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return createMockJsonResponse(["cat & dog #1", []]);
  };

  const client = new UnofficialGoogleSuggestClient({ fetchFn: mockFetch });
  await client.getSuggestions("cat & dog #1");

  assert.ok(requestedUrl.includes("q=cat+%26+dog+%231") || requestedUrl.includes("q=cat%20%26%20dog%20%231"));
});

// ---------------------------------------------------------------------------
// GROUP E: Locale explicit parameters (hl and gl)
// ---------------------------------------------------------------------------
test("Group E: Client transmits explicit hl and gl parameters from configuration", async () => {
  let requestedUrl = "";
  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return createMockJsonResponse(["test", []]);
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    language: "fr",
    country: "ca",
  });
  await client.getSuggestions("test");

  assert.ok(requestedUrl.includes("hl=fr"));
  assert.ok(requestedUrl.includes("gl=ca"));
  assert.ok(requestedUrl.includes("client=firefox"));
});

// ---------------------------------------------------------------------------
// GROUP F: Timeout 3s -> retry exactly once
// ---------------------------------------------------------------------------
test("Group F: Request timeout triggers exactly 1 retry and fails if second attempt also times out", async () => {
  let attempts = 0;
  const mockFetch: typeof fetch = async (_url, init) => {
    attempts++;
    // Simulate delay exceeding timeout
    return new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          const abortError = new Error("This operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      }
    });
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    timeoutMs: 50, // fast timeout for test
    retryDelayMs: 10,
  });

  await assert.rejects(
    async () => client.getSuggestions("test"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(attempts, 2); // 1 initial + 1 retry
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// GROUP G: Status Code Retry Matrix (429/502/503/504 retry; 400/403 do not retry)
// ---------------------------------------------------------------------------
test("Group G1: HTTP 503 triggers retry once and succeeds if retry returns 200", async () => {
  let attempts = 0;
  const mockFetch: typeof fetch = async () => {
    attempts++;
    if (attempts === 1) {
      return createMockJsonResponse({ error: "Unavailable" }, 503);
    }
    return createMockJsonResponse(["query", ["ok result"]]);
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    retryDelayMs: 5,
  });
  const result = await client.getSuggestions("query");

  assert.equal(attempts, 2);
  assert.deepEqual(result, ["ok result"]);
});

test("Group G2: HTTP 403 fails immediately with GoogleSuggestBlockedError and zero retries", async () => {
  let attempts = 0;
  const mockFetch: typeof fetch = async () => {
    attempts++;
    return createMockJsonResponse({ error: "Forbidden" }, 403);
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    retryDelayMs: 5,
  });

  await assert.rejects(
    async () => client.getSuggestions("query"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestBlockedError);
      assert.equal(attempts, 1); // zero retry
      return true;
    },
  );
});

test("Group G3: HTTP 400 fails immediately with zero retries", async () => {
  let attempts = 0;
  const mockFetch: typeof fetch = async () => {
    attempts++;
    return createMockJsonResponse({ error: "Bad Request" }, 400);
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    retryDelayMs: 5,
  });

  await assert.rejects(
    async () => client.getSuggestions("query"),
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(err.status, 400);
      assert.equal(err.isRetryable, false);
      assert.equal(attempts, 1);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// GROUP H: 403 circuit-break remaining seeds
// ---------------------------------------------------------------------------
test("Group H: HTTP 403 trips batch circuit breaker and immediately stops remaining seeds", async () => {
  const queriedQueries: string[] = [];

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      queriedQueries.push(query);
      if (queriedQueries.length === 1) {
        return ["first suggestion"];
      }
      // Second query gets 403 blocked
      throw new GoogleSuggestBlockedError("Blocked by Google");
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { niche: "cats", title: "Cat Mug" },
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["cat mug", "cute cat cup", "funny cat mug", "cat lover gift"],
    },
  });

  // Second seed threw 403, so third and fourth seeds were never queried
  assert.equal(queriedQueries.length, 2);
  assert.deepEqual(result.suggestedQueries, ["first suggestion"]);
});

// ---------------------------------------------------------------------------
// GROUP I: Repeated 429 circuit-break
// ---------------------------------------------------------------------------
test("Group I: Repeated 429 on a seed trips batch circuit breaker and stops remaining seeds", async () => {
  const queriedQueries: string[] = [];

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      queriedQueries.push(query);
      if (queriedQueries.length === 1) {
        // Repeated 429 (already retried in client)
        throw new GoogleSuggestRateLimitError("Rate limited");
      }
      return ["never reached"];
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { niche: "cats" },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["seed1", "seed2", "seed3"],
    },
  });

  assert.equal(queriedQueries.length, 1);
  assert.deepEqual(result.suggestedQueries, []);
});

// ---------------------------------------------------------------------------
// GROUP J: Partial failure preserves successful seeds
// ---------------------------------------------------------------------------
test("Group J: Transient failure on one seed does not discard successful suggestions from other seeds", async () => {
  let partialFailureReported = false;

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      if (query === "failing-seed") {
        throw new GoogleSuggestError("Transient 503 error", { status: 503, isRetryable: true });
      }
      return [`${query} suggestion 1`, `${query} suggestion 2`];
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
    onPartialFailure: (failed, total) => {
      partialFailureReported = true;
      assert.equal(failed, 1);
      assert.equal(total, 3);
    },
  });

  const result = await collector.collect({
    source: {},
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["seed1", "failing-seed", "seed3"],
    },
  });

  assert.ok(partialFailureReported);
  assert.equal(result.seedKeywords.length, 3);
  assert.ok(result.suggestedQueries.includes("seed1 suggestion 1"));
  assert.ok(result.suggestedQueries.includes("seed3 suggestion 1"));
});

test("Default Google collector reports partial network failure so the server pipeline can retry", async () => {
  const collector = createDefaultSearchSuggestionsCollector({
    client: {
      async getSuggestions(): Promise<readonly string[]> {
        throw new GoogleSuggestError("Transient 503 error", { status: 503, isRetryable: true });
      },
    },
    onPartialFailure: (failedCount, totalCount) => {
      throw new Error(`Google Suggest incomplete: ${failedCount}/${totalCount}`);
    },
  });

  await assert.rejects(
    () => collector.collect({ source: { niche: "cat mug" } }),
    /Google Suggest incomplete: 1\/1/,
  );
});

// ---------------------------------------------------------------------------
// GROUP K: Max 6 searched seeds cardinality limit
// ---------------------------------------------------------------------------
test("B3 labels scene context as discovery-only provenance", () => {
  const seeds = selectSearchSeeds({
    source: { title: "Music Player Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Media player interface", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor"],
      buyerIntentKeywords: ["personalized music rug"], sceneSearchSeeds: ["home studio rug"],
    },
  });
  assert.deepEqual(seeds.find((seed) => seed.query === "home studio rug"), {
    query: "home studio rug", source: QUERY_SOURCE.SCENE_CONTEXT_SEED,
  });
});

test("B3 preserves scene-only provenance when Google expands a scene seed", async () => {
  const collector = new GoogleSearchSuggestionsCollector({
    client: { async getSuggestions(seed) { return seed === "guitar amplifier decor" ? ["guitar amplifier wall decor"] : []; } },
    interRequestDelayMs: 0,
  });
  const result = await collector.collect({
    source: { title: "Music Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor"],
      buyerIntentKeywords: [], sceneSearchSeeds: ["guitar amplifier decor"],
    },
  });
  assert.equal(result.querySources["guitar amplifier wall decor"], QUERY_SOURCE.SCENE_CONTEXT_SEED);
});

test("B3 generates only valid prefix probes from each product-grounded seed", async () => {
  const generator = new FakeGeminiContentGenerator();
  generator.setTextHandler(() => ({
    rawText: JSON.stringify({
      variantGroups: [
        {
          seedIndex: 0,
          variants: [
            "personalized music player rug",
            "music moon",
            "music player ru",
            "music player ru",
            "music ru",
          ],
        },
      ],
    }),
  }));
  const variantGenerator = new GeminiSearchQueryVariantGenerator({ generator });

  const variants = await variantGenerator.generate({
    seeds: [{ query: "personalized music player rug", source: QUERY_SOURCE.BUYER_INTENT_SEED }],
    source: { niche: "personalized rug", title: "Personalized Music Player Rug" },
  });

  assert.deepEqual(variants, [{
    seedQuery: "personalized music player rug",
    variants: ["music player ru", "music ru"],
  }]);
});

test("B3 queries original seeds before Gemini probes, excludes scene probes, and keeps probes out of B4 candidates", async () => {
  const calls: string[] = [];
  const collector = new GoogleSearchSuggestionsCollector({
    client: {
      async getSuggestions(query) {
        calls.push(query);
        return query === "music player ru" ? ["music player rug"] : [];
      },
    },
    variantGenerator: {
      async generate() {
        return [
          {
            seedQuery: "personalized music player rug",
            variants: ["music player ru", "personalized rug"],
          },
          {
            seedQuery: "home studio rug",
            variants: ["studio ru"],
          },
          {
            seedQuery: "personalized rug",
            variants: ["music ru"],
          },
        ];
      },
    },
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { title: "Music Player Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "unknown",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: [], suitableOccasions: [], useCases: [],
      buyerIntentKeywords: ["personalized music player rug"],
      sceneSearchSeeds: ["home studio rug"],
    },
  });

  assert.deepEqual(calls, [
    "personalized music player rug",
    "home studio rug",
    "personalized rug",
    "music player ru",
    "music ru",
  ]);
  assert.deepEqual(result.autocompleteProbes, [
    { query: "personalized music player rug", parentSeed: "personalized music player rug", kind: "original" },
    { query: "home studio rug", parentSeed: "home studio rug", kind: "original" },
    { query: "personalized rug", parentSeed: "personalized rug", kind: "original" },
    { query: "music player ru", parentSeed: "personalized music player rug", kind: "gemini_variant" },
    { query: "music ru", parentSeed: "personalized rug", kind: "gemini_variant" },
  ]);
  assert.deepEqual(result.suggestedQueries, ["music player rug"]);
  assert.deepEqual(
    buildKeywordCandidates(result).map((candidate) => candidate.keyword),
    [
      "personalized music player rug",
      "home studio rug",
      "personalized rug",
      "music player rug",
    ],
  );
});

test("B3 falls back to original seeds when Gemini variant generation fails", async () => {
  const calls: string[] = [];
  const collector = new GoogleSearchSuggestionsCollector({
    client: {
      async getSuggestions(query) {
        calls.push(query);
        return [];
      },
    },
    variantGenerator: {
      async generate() {
        throw new Error("Vertex unavailable");
      },
    },
    onVariantGenerationFailure: () => undefined,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "unknown",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "unknown",
    },
  });

  assert.deepEqual(calls, ["personalized rug"]);
  assert.deepEqual(result.autocompleteProbes, [
    { query: "personalized rug", parentSeed: "personalized rug", kind: "original" },
  ]);
});
