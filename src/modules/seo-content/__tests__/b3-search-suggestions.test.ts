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
test("Group K: Selector and collector strictly enforce maximum 6 search seeds", async () => {
  const seeds = selectSearchSeeds({
    source: { niche: "home decor", title: "Luxury Wall Tapestry" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["tapestry"],
      dominantColors: [],
      visualStyle: "bohemian",
      productCategory: "tapestry",
    },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: [
        "seed 1",
        "seed 2",
        "seed 3",
        "seed 4",
        "seed 5",
        "seed 6",
        "seed 7",
        "seed 8",
      ],
    },
  });

  assert.ok(seeds.length <= MAX_SEARCH_SEEDS);
  assert.equal(seeds.length, 6);
  // First 4 must be B2 seeds
  assert.equal(seeds[0].source, QUERY_SOURCE.BUYER_INTENT_SEED);
  assert.equal(seeds[1].source, QUERY_SOURCE.BUYER_INTENT_SEED);
  assert.equal(seeds[2].source, QUERY_SOURCE.BUYER_INTENT_SEED);
  assert.equal(seeds[3].source, QUERY_SOURCE.BUYER_INTENT_SEED);
});

// ---------------------------------------------------------------------------
// GROUP L: B2 seeds prioritized over niche/title
// ---------------------------------------------------------------------------
test("Group L: B2 buyerIntentKeywords are prioritized over niche and title", () => {
  const seeds = selectSearchSeeds({
    source: { niche: "apparel", title: "Graphic T-Shirt Vintage Cat" },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["vintage cat shirt", "black cat tee"],
    },
  });

  assert.equal(seeds[0].query, "vintage cat shirt");
  assert.equal(seeds[0].source, QUERY_SOURCE.BUYER_INTENT_SEED);
  assert.equal(seeds[1].query, "black cat tee");
  assert.equal(seeds[1].source, QUERY_SOURCE.BUYER_INTENT_SEED);
});

// ---------------------------------------------------------------------------
// GROUP M: Rich B2 input does not explode title tokens
// ---------------------------------------------------------------------------
test("Group M: Rich B2 input does not fall back to single title token explosion", () => {
  const seeds = selectSearchSeeds({
    source: {
      niche: "pet apparel",
      title: "Personalized Vintage Black Cat Halloween Graphic T-Shirt",
    },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: [
        "vintage black cat t-shirt",
        "black cat halloween t-shirt",
        "t-shirt for cat lovers",
        "gift for cat lover",
      ],
    },
  });

  const queryStrings = seeds.map((s) => s.query);
  assert.ok(!queryStrings.includes("personalized"));
  assert.ok(!queryStrings.includes("vintage"));
  assert.ok(!queryStrings.includes("halloween"));
  assert.ok(!queryStrings.includes("graphic"));
});

// ---------------------------------------------------------------------------
// GROUP N: Global case-insensitive deduplication preserving original casing
// ---------------------------------------------------------------------------
test("Group N: Deduplicates case-insensitively while preserving original Google casing", async () => {
  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      if (query === "seed1") {
        return ["Vintage Cat Shirt", "black cat mug"];
      }
      // Returns identical query in lowercase
      return ["vintage cat shirt", "cute cat sticker"];
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
      buyerIntentKeywords: ["seed1", "seed2"],
    },
  });

  assert.equal(result.suggestedQueries.length, 3);
  // Preserved first-seen casing
  assert.equal(result.suggestedQueries[0], "Vintage Cat Shirt");
  assert.equal(result.suggestedQueries[1], "black cat mug");
  assert.equal(result.suggestedQueries[2], "cute cat sticker");
});

// ---------------------------------------------------------------------------
// GROUP O: Suggestion == Seed upgrades provenance to google_autocomplete without duplicate
// ---------------------------------------------------------------------------
test("Group O: Suggestion matching a seed upgrades seed provenance to google_autocomplete without duplicating array", async () => {
  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(): Promise<readonly string[]> {
      // Returns exact seed query
      return ["vintage cat shirt", "other cat shirt"];
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
      buyerIntentKeywords: ["vintage cat shirt"],
    },
  });

  // Upgraded provenance
  assert.equal(result.querySources["vintage cat shirt"], QUERY_SOURCE.GOOGLE_AUTOCOMPLETE);
  // Not duplicated in suggestedQueries
  assert.ok(!result.suggestedQueries.includes("vintage cat shirt"));
  assert.deepEqual(result.suggestedQueries, ["other cat shirt"]);
});

// ---------------------------------------------------------------------------
// GROUP P: Google best/cheap/near me/etsy evidence IS PRESERVED (CRITICAL INVARIANT!)
// ---------------------------------------------------------------------------
test("Group P: Real search terms (best, cheap, near me, etsy, amazon, for, with) from Google are NEVER filtered at B3", async () => {
  const googleResults = [
    "best halloween cat shirts",
    "cheap cat shirts",
    "cat shirt near me",
    "cat shirts etsy",
    "cat shirts amazon",
    "cat shirt for women",
    "cat shirt with pockets",
  ];

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(): Promise<readonly string[]> {
      return googleResults;
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
      buyerIntentKeywords: ["cat shirt"],
    },
  });

  for (const query of googleResults) {
    assert.ok(
      result.suggestedQueries.includes(query),
      `Expected ${query} to be preserved in B3 output`,
    );
  }
});

// ---------------------------------------------------------------------------
// GROUP Q: Technical junk/empty/control chars filtering
// ---------------------------------------------------------------------------
test("Group Q: Filters empty strings, control characters, URL-only queries, and excessive tokens", () => {
  assert.equal(normalizeSuggestionQuery(""), undefined);
  assert.equal(normalizeSuggestionQuery("   "), undefined);
  assert.equal(normalizeSuggestionQuery("cat\u0000mug"), undefined);
  assert.equal(normalizeSuggestionQuery("cat\u001Fmug"), undefined);
  assert.equal(normalizeSuggestionQuery("https://google.com/search"), undefined);
  assert.equal(normalizeSuggestionQuery("www.amazon.com/product"), undefined);

  // Excessive tokens (> 12 words)
  const excessiveWords = "one two three four five six seven eight nine ten eleven twelve thirteen";
  assert.equal(normalizeSuggestionQuery(excessiveWords), undefined);

  // Excessive character length (> 120 chars)
  const longQuery = "a".repeat(125);
  assert.equal(normalizeSuggestionQuery(longQuery), undefined);

  // Normal valid query
  assert.equal(normalizeSuggestionQuery("  cat  mug  with   lid  "), "cat mug with lid");
});

// ---------------------------------------------------------------------------
// GROUP R: Cardinality limits: max 8 per seed, max 40 global
// ---------------------------------------------------------------------------
test("Group R1: Limits suggestions to maximum 8 per seed", async () => {
  const manySuggestions = Array.from({ length: 20 }, (_, i) => `suggestion number ${i + 1}`);

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(): Promise<readonly string[]> {
      return manySuggestions;
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: {},
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["cat seed"],
    },
  });

  assert.equal(result.suggestedQueries.length, MAX_PER_SEED_SUGGESTIONS);
});

test("Group R2: Limits global suggestions to maximum 40 across all seeds", async () => {
  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      return Array.from({ length: 8 }, (_, i) => `${query} option ${i + 1}`);
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
      buyerIntentKeywords: ["s1", "s2", "s3", "s4", "s5", "s6"],
    },
  });

  assert.ok(result.suggestedQueries.length <= MAX_GLOBAL_SUGGESTIONS);
  assert.equal(result.suggestedQueries.length, 40);
});

// ---------------------------------------------------------------------------
// GROUP S: Google unavailable -> suggestedQueries [], zero fabricated results (CRITICAL INVARIANT!)
// ---------------------------------------------------------------------------
test("Group S: When Google is completely unavailable, suggestedQueries is empty [] and no synthetic results are fabricated", async () => {
  const fakeFailingClient: GoogleSuggestClient = {
    async getSuggestions(): Promise<readonly string[]> {
      throw new GoogleSuggestError("Connection refused", { isRetryable: true });
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeFailingClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: {},
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["vintage cat mug", "funny cat cup"],
    },
  });

  assert.deepEqual(result.suggestedQueries, []);
  assert.equal(result.seedKeywords.length, 2);
  assert.equal(result.querySources["vintage cat mug"], QUERY_SOURCE.BUYER_INTENT_SEED);
  assert.equal(result.querySources["funny cat cup"], QUERY_SOURCE.BUYER_INTENT_SEED);
});

// ---------------------------------------------------------------------------
// GROUP T: Fallback collector sources NEVER contain google_autocomplete (CRITICAL INVARIANT!)
// ---------------------------------------------------------------------------
test("Group T: Fallback collector strictly prohibits the google_autocomplete label", async () => {
  const fallback = new FallbackSearchSuggestionsCollector();
  const result = await fallback.collect({
    source: { niche: "vintage clothing", title: "Cat Shirt" },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["vintage cat shirt", "retro cat tee"],
    },
  });

  assert.deepEqual(result.suggestedQueries, []);
  for (const [query, source] of Object.entries(result.querySources)) {
    assert.notEqual(
      source,
      QUERY_SOURCE.GOOGLE_AUTOCOMPLETE,
      `Query ${query} must not have google_autocomplete in fallback mode`,
    );
  }
});

// ---------------------------------------------------------------------------
// GROUP U: Deterministic Ordering (Seed order -> Google response order -> first-seen)
// ---------------------------------------------------------------------------
test("Group U: Preserves deterministic Google response order without alphabetical sorting", async () => {
  const googleOrderedSuggestions = [
    "zebra shirt",
    "alpha shirt",
    "beta shirt",
    "delta shirt",
  ];

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(): Promise<readonly string[]> {
      return googleOrderedSuggestions;
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { niche: "apparel" },
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["shirt"],
    },
  });

  assert.deepEqual(result.suggestedQueries, googleOrderedSuggestions);
});

// ---------------------------------------------------------------------------
// GROUP V: Dependency Injection zero network execution
// ---------------------------------------------------------------------------
test("Group V: createB3SearchSuggestionsStage respects custom injected collector with zero network calls", async () => {
  let collectorInvoked = false;

  const mockCollector = {
    async collect(): Promise<SearchResearchResult> {
      collectorInvoked = true;
      return {
        seedKeywords: ["custom seed"],
        suggestedQueries: ["custom query"],
        querySources: {
          "custom seed": QUERY_SOURCE.BUYER_INTENT_SEED,
          "custom query": QUERY_SOURCE.GOOGLE_AUTOCOMPLETE,
        },
      };
    },
  };

  const stage = createB3SearchSuggestionsStage({ collector: mockCollector });
  const initial = createInitialContext(seoContentMockInput);
  const next = await stage.execute(initial);

  assert.ok(collectorInvoked);
  assert.equal(next.searchResearch?.seedKeywords[0], "custom seed");
  assert.equal(next.searchResearch?.suggestedQueries[0], "custom query");
});

// ---------------------------------------------------------------------------
// GROUP W: Context Immutability in B3 execution
// ---------------------------------------------------------------------------
test("Group W: B3 execution strictly evolves context without mutating original input context", async () => {
  const initial = createInitialContext(seoContentMockInput);
  const contextWithB2 = evolveContext(initial, {
    shoppingContext: {
      targetAudience: ["cat lovers"],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["cat mug"],
    },
  });

  const nextContext = await executeB3SearchSuggestions(contextWithB2, {
    collector: fallbackSearchSuggestionsCollector,
  });

  assert.notEqual(contextWithB2, nextContext);
  assert.equal(contextWithB2.searchResearch, undefined);
  assert.ok(nextContext.searchResearch);
  assert.ok(Object.isFrozen(nextContext));
});

// ---------------------------------------------------------------------------
// GROUP X: B2 -> B3 Integration
// ---------------------------------------------------------------------------
test("Group X: B2 shoppingContext flows cleanly into B3 searchResearch seeds and sources", async () => {
  const initial = createInitialContext(seoContentMockInput);
  const contextWithB2 = await b2ShoppingContextStage.execute(initial);

  assert.ok(contextWithB2.shoppingContext);
  assert.ok(contextWithB2.shoppingContext.buyerIntentKeywords.length >= 3);

  const contextWithB3 = await executeB3SearchSuggestions(contextWithB2, {
    collector: fallbackSearchSuggestionsCollector,
  });

  const research = contextWithB3.searchResearch;
  assert.ok(research);
  assert.ok(research.seedKeywords.length >= 3);
  assert.ok(research.seedKeywords.length <= 6);

  // All selected seeds have proper provenance
  for (const seed of research.seedKeywords) {
    assert.ok(research.querySources[seed]);
  }
});

// ---------------------------------------------------------------------------
// GROUP Y: Pipeline regression across B1 -> B2 -> B3 -> B4
// ---------------------------------------------------------------------------
test("Group Y: Pipeline regression passes across stages B1, B2, B3, and B4", async () => {
  const pipeline = createSeoPipeline();
  const output = await pipeline.execute(seoContentMockInput);

  assert.ok(output.productTitle);
  assert.ok(output.productDescription);
  assert.ok(output.productSeoTitle);
  assert.ok(output.productSeoDescription);
  assert.ok(output.productHandle);
  assert.ok(output.images.length > 0);
});

// ---------------------------------------------------------------------------
// GROUP Z1: InMemoryGoogleSuggestCache basic get/set/has/size/clear & immutability
// ---------------------------------------------------------------------------
test("Group Z1: InMemoryGoogleSuggestCache basic operations and defensive copying", () => {
  const cache = new InMemoryGoogleSuggestCache({ ttlMs: 1000, maxSize: 10 });
  const key = createSuggestCacheKey("cat mug", "en", "us");

  assert.equal(cache.has(key), false);
  assert.equal(cache.get(key), undefined);
  assert.equal(cache.size(), 0);

  const originalSuggestions = ["cat mug funny", "cat mug cute"];
  cache.set(key, originalSuggestions);

  assert.equal(cache.has(key), true);
  assert.equal(cache.size(), 1);

  const cached = cache.get(key);
  assert.deepEqual(cached, originalSuggestions);

  // Assert defensive copy (mutating returned array does not mutate cache)
  (cached as string[]).push("mutated");
  assert.deepEqual(cache.get(key), originalSuggestions);

  cache.clear();
  assert.equal(cache.size(), 0);
  assert.equal(cache.get(key), undefined);
});

// ---------------------------------------------------------------------------
// GROUP Z2: InMemoryGoogleSuggestCache TTL expiration
// ---------------------------------------------------------------------------
test("Group Z2: InMemoryGoogleSuggestCache expires entries after TTL", async () => {
  const cache = new InMemoryGoogleSuggestCache({ ttlMs: 25, maxSize: 10 });
  const key = createSuggestCacheKey("quick expire", "en", "us");

  cache.set(key, ["item1"]);
  assert.equal(cache.has(key), true);
  assert.deepEqual(cache.get(key), ["item1"]);

  // Wait past TTL
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(cache.has(key), false);
  assert.equal(cache.get(key), undefined);
});

// ---------------------------------------------------------------------------
// GROUP Z3: InMemoryGoogleSuggestCache maxSize LRU eviction
// ---------------------------------------------------------------------------
test("Group Z3: InMemoryGoogleSuggestCache evicts least-recently-used item when maxSize is exceeded", () => {
  const cache = new InMemoryGoogleSuggestCache({ ttlMs: 60000, maxSize: 2 });
  const key1 = createSuggestCacheKey("query1", "en", "us");
  const key2 = createSuggestCacheKey("query2", "en", "us");
  const key3 = createSuggestCacheKey("query3", "en", "us");

  cache.set(key1, ["result1"]);
  cache.set(key2, ["result2"]);

  // Touch key1 to make it most recently used
  cache.get(key1);

  // Add key3 -> should evict key2 (the oldest untouched item)
  cache.set(key3, ["result3"]);

  assert.equal(cache.size(), 2);
  assert.deepEqual(cache.get(key1), ["result1"]);
  assert.equal(cache.get(key2), undefined); // evicted
  assert.deepEqual(cache.get(key3), ["result3"]);
});

// ---------------------------------------------------------------------------
// GROUP Z4: UnofficialGoogleSuggestClient caching prevents redundant requests and bypassCache works
// ---------------------------------------------------------------------------
test("Group Z4: UnofficialGoogleSuggestClient caches responses and bypassCache forces fresh request", async () => {
  let fetchCount = 0;
  const mockFetch: typeof fetch = async () => {
    fetchCount++;
    return createMockJsonResponse(["cat mug", [`cat mug suggestion ${fetchCount}`]]);
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    cache: new InMemoryGoogleSuggestCache(),
  });

  // First call -> calls fetch
  const result1 = await client.getSuggestions("cat mug");
  assert.equal(fetchCount, 1);
  assert.deepEqual(result1, ["cat mug suggestion 1"]);

  // Second call with same query (different case/spacing) -> hits cache, fetchCount remains 1
  const result2 = await client.getSuggestions("  Cat   Mug  ");
  assert.equal(fetchCount, 1);
  assert.deepEqual(result2, ["cat mug suggestion 1"]);

  // Third call with bypassCache -> forces fresh request
  const result3 = await client.getSuggestions("cat mug", { bypassCache: true });
  assert.equal(fetchCount, 2);
  assert.deepEqual(result3, ["cat mug suggestion 2"]);
});

// ---------------------------------------------------------------------------
// GROUP Z5: UnofficialGoogleSuggestClient caller abort with AbortSignal aborts immediately without retry
// ---------------------------------------------------------------------------
test("Group Z5: Caller abort via AbortSignal fails immediately with zero retries and cleans up listener", async () => {
  let attempts = 0;
  const controller = new AbortController();

  const mockFetch: typeof fetch = async (_url, init) => {
    attempts++;
    const signal = init?.signal as AbortSignal | undefined;
    return new Promise((_resolve, reject) => {
      if (signal) {
        signal.addEventListener("abort", () => {
          const abortError = new Error("Aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      }
    });
  };

  const client = new UnofficialGoogleSuggestClient({
    fetchFn: mockFetch,
    timeoutMs: 5000,
    retryDelayMs: 10,
    cache: null, // disable cache
  });

  const queryPromise = client.getSuggestions("aborted query", {
    signal: controller.signal,
  });

  // Abort immediately from caller
  setTimeout(() => {
    controller.abort();
  }, 10);

  await assert.rejects(
    async () => queryPromise,
    (err: unknown) => {
      assert.ok(err instanceof GoogleSuggestError);
      assert.equal(err.isRetryable, false);
      // Must not retry
      assert.equal(attempts, 1);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// GROUP Z6: selectSearchSeeds invalid category filtering and duplicate word avoidance
// ---------------------------------------------------------------------------
test("Group Z6: selectSearchSeeds ignores invalid category values and avoids repetitive concatenation", () => {
  // Case 1: Category is "unspecified" or "none" -> should not create seed like "cat unspecified"
  const seeds1 = selectSearchSeeds({
    source: { niche: "cats" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cute kitten"],
      dominantColors: [],
      visualStyle: "vintage",
      productCategory: "unspecified",
    },
  });

  const queryStrings1 = seeds1.map((s) => s.query);
  assert.ok(!queryStrings1.some((q) => q.includes("unspecified")));

  // Case 2: firstEntity already contains category -> should not double category word
  const seeds2 = selectSearchSeeds({
    source: { niche: "apparel" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["black cat t-shirt"],
      dominantColors: [],
      visualStyle: "retro",
      productCategory: "t-shirt",
    },
  });

  const categorySeed = seeds2.find((s) => s.source === QUERY_SOURCE.CATEGORY_SEED);
  assert.ok(categorySeed);
  // Must NOT be "black cat t-shirt t-shirt"
  assert.equal(categorySeed.query, "black cat t-shirt");
});

// ---------------------------------------------------------------------------
// GROUP Z7: selectSearchSeeds fallback noun is 'product' when category is 'unspecified'
// ---------------------------------------------------------------------------
test("Group Z7: selectSearchSeeds uses 'product' as fallback seed when category is 'unspecified'", () => {
  const seeds = selectSearchSeeds({
    source: {},
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: [],
      visualStyle: "",
      productCategory: "unspecified",
    },
  });

  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].query, "product");
  assert.equal(seeds[0].source, QUERY_SOURCE.FALLBACK_SEED);
});

// ---------------------------------------------------------------------------
// GROUP Z8: GoogleSearchSuggestionsCollector trips circuit breaker on generic GoogleSuggestError 403/429
// ---------------------------------------------------------------------------
test("Group Z8: GoogleSearchSuggestionsCollector trips circuit breaker on generic GoogleSuggestError with status 403 or 429", async () => {
  const queriedQueries: string[] = [];

  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      queriedQueries.push(query);
      if (queriedQueries.length === 1) {
        return ["first suggestion"];
      }
      // Generic error with status 403 (not necessarily instance of GoogleSuggestBlockedError)
      throw new GoogleSuggestError("Generic 403 Forbidden", { status: 403, isRetryable: false });
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: {},
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["seed1", "seed2", "seed3", "seed4"],
    },
  });

  // Circuit breaker stopped after seed2
  assert.equal(queriedQueries.length, 2);
  assert.deepEqual(result.suggestedQueries, ["first suggestion"]);
});

// ---------------------------------------------------------------------------
// GROUP Z9: Hyphen/space canonical matching upgrades provenance without duplicating suggestion
// ---------------------------------------------------------------------------
test("Group Z9: Hyphen/space canonical key matching upgrades seed provenance and avoids duplicate suggestions", async () => {
  const fakeClient: GoogleSuggestClient = {
    async getSuggestions(query: string): Promise<readonly string[]> {
      // Return space-separated variant of hyphenated seed
      if (query === "vintage black cat t-shirt") {
        return ["vintage black cat t shirt", "vintage black cat hoodie"];
      }
      return [];
    },
  };

  const collector = new GoogleSearchSuggestionsCollector({
    client: fakeClient,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: {},
    shoppingContext: {
      targetAudience: [],
      suitableOccasions: [],
      useCases: [],
      buyerIntentKeywords: ["vintage black cat t-shirt"],
    },
  });

  // Provenance upgraded
  assert.equal(
    result.querySources["vintage black cat t-shirt"],
    QUERY_SOURCE.GOOGLE_AUTOCOMPLETE,
  );
  // "vintage black cat t shirt" was matched as seed, so NOT duplicated in suggestedQueries
  assert.ok(!result.suggestedQueries.includes("vintage black cat t shirt"));
  assert.deepEqual(result.suggestedQueries, ["vintage black cat hoodie"]);
});

