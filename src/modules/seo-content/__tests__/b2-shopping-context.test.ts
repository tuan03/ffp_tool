import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProductUnderstanding,
  SeoPipelineContext,
} from "../internal/domain-types";
import {
  createInitialContext,
  evolveContext,
} from "../internal/pipeline-context";
import {
  b2ShoppingContextStage,
  createB2ShoppingContextStage,
  executeB2ShoppingContext,
} from "../internal/stages/b2-shopping-context";
import {
  parseAndNormalizeShoppingContext,
  ShoppingContextSchemaValidationError,
} from "../internal/shopping-context/shopping-context-normalizer";
import { GEMINI_SHOPPING_CONTEXT_SCHEMA } from "../internal/shopping-context/gemini-shopping-context-schema";
import {
  HeuristicShoppingContextAnalyzer,
  heuristicShoppingContextAnalyzer,
} from "../internal/shopping-context/heuristic-shopping-context-analyzer";
import {
  GeminiShoppingContextAnalyzer,
} from "../internal/shopping-context/gemini-shopping-context-analyzer";
import {
  FallbackShoppingContextAnalyzer,
} from "../internal/shopping-context/fallback-shopping-context-analyzer";
import type {
  ShoppingContextAnalysisInput,
  ShoppingContextAnalyzer,
} from "../internal/shopping-context/shopping-context-analyzer";
import {
  FakeGeminiContentGenerator,
  GeminiGeneratorError,
} from "../internal/product-understanding/gemini-content-generator";
import {
  createSeoPipeline,
  DEFAULT_SEO_PIPELINE_STAGES,
} from "../internal/pipeline";
import { seoContentMockInput } from "../mocks/data";

// ---------------------------------------------------------------------------
// GROUP A: Schema Validation & Normalization
// ---------------------------------------------------------------------------

test("Group A: Schema — parses valid JSON, trims whitespace, converts to lowercase, deduplicates", () => {
  const raw = JSON.stringify({
    targetAudience: ["  Cat Lovers  ", "cat lovers", "VINTAGE ENTHUSIASTS"],
    suitableOccasions: [" Halloween Party ", "everyday wear"],
    useCases: [" Everyday Casual Wear ", "casual lounging"],
    buyerIntentKeywords: [
      "Vintage Cat Shirt",
      "vintage cat shirt",
      "halloween cat apparel",
      "cute cat tee",
    ],
  });

  const parsed = parseAndNormalizeShoppingContext(raw);
  assert.deepEqual(parsed.targetAudience, [
    "cat lovers",
    "vintage enthusiasts",
  ]);
  assert.deepEqual(parsed.suitableOccasions, [
    "halloween party",
    "everyday wear",
  ]);
  assert.deepEqual(parsed.useCases, [
    "everyday casual wear",
    "casual lounging",
  ]);
  assert.deepEqual(parsed.buyerIntentKeywords, [
    "vintage cat shirt",
    "halloween cat apparel",
    "cute cat tee",
  ]);
});

test("Group A: Schema — strips markdown code fences (```json ... ```)", () => {
  const fenced = "```json\n" + JSON.stringify({
    targetAudience: ["book lovers"],
    suitableOccasions: ["cozy reading"],
    useCases: ["daily reading"],
    buyerIntentKeywords: ["bookish mug", "gift for reader", "cute book mug"],
  }) + "\n```";

  const parsed = parseAndNormalizeShoppingContext(fenced);
  assert.equal(parsed.targetAudience[0], "book lovers");
});

test("Group A: Schema — rejects malformed JSON and non-object inputs", () => {
  assert.throws(
    () => parseAndNormalizeShoppingContext("not a json"),
    ShoppingContextSchemaValidationError,
  );
  assert.throws(
    () => parseAndNormalizeShoppingContext(null),
    ShoppingContextSchemaValidationError,
  );
  assert.throws(
    () => parseAndNormalizeShoppingContext(["array"]),
    ShoppingContextSchemaValidationError,
  );
});

test("Group A: Schema — rejects missing required properties", () => {
  const missingField = JSON.stringify({
    targetAudience: ["coffee drinkers"],
    suitableOccasions: ["morning coffee"],
    useCases: ["drinking espresso"],
    // missing buyerIntentKeywords
  });

  assert.throws(
    () => parseAndNormalizeShoppingContext(missingField),
    ShoppingContextSchemaValidationError,
  );
});

test("Group A: Schema — rejects unexpected extra properties (additionalProperties: false)", () => {
  const extraField = JSON.stringify({
    targetAudience: ["coffee drinkers"],
    suitableOccasions: ["morning coffee"],
    useCases: ["drinking espresso"],
    buyerIntentKeywords: ["espresso mug", "coffee cup", "ceramic mug"],
    hallucinatedField: "unauthorized",
  });

  assert.throws(
    () => parseAndNormalizeShoppingContext(extraField),
    ShoppingContextSchemaValidationError,
  );
});

test("Group A: Schema — rejects non-string array elements", () => {
  const invalidElements = JSON.stringify({
    targetAudience: ["coffee drinkers", 123],
    suitableOccasions: ["morning coffee"],
    useCases: ["drinking espresso"],
    buyerIntentKeywords: ["espresso mug", "coffee cup", "ceramic mug"],
  });

  assert.throws(
    () => parseAndNormalizeShoppingContext(invalidElements),
    ShoppingContextSchemaValidationError,
  );
});

test("Group A: Schema — rejects when cardinality is below minItems", () => {
  const belowMin = JSON.stringify({
    targetAudience: [],
    suitableOccasions: ["morning coffee"],
    useCases: ["drinking espresso"],
    buyerIntentKeywords: ["espresso mug", "coffee cup", "ceramic mug"],
  });

  assert.throws(
    () => parseAndNormalizeShoppingContext(belowMin),
    ShoppingContextSchemaValidationError,
  );
});

test("Group A: Schema — rejects when cardinality exceeds maxItems", () => {
  const tooManyAudience = JSON.stringify({
    targetAudience: [
      "aud 1", "aud 2", "aud 3", "aud 4", "aud 5",
      "aud 6", "aud 7", "aud 8", "aud 9",
    ],
    suitableOccasions: ["morning coffee"],
    useCases: ["drinking espresso"],
    buyerIntentKeywords: ["espresso mug", "coffee cup", "ceramic mug"],
  });

  assert.throws(
    () => parseAndNormalizeShoppingContext(tooManyAudience),
    ShoppingContextSchemaValidationError,
  );
});

// ---------------------------------------------------------------------------
// GROUP B: B1 -> B2 Grounding
// ---------------------------------------------------------------------------

test("Group B: Grounding — B2 reflects visual evidence from B1 and does not hallucinate unrelated themes", async () => {
  const pu: ProductUnderstanding = {
    ocrTexts: ["Trick or Treat"],
    detectedEntities: ["black cat", "pumpkin"],
    dominantColors: ["black", "orange"],
    visualStyle: "vintage retro",
    productCategory: "t-shirt",
  };

  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "halloween apparel",
      title: "Vintage Black Cat Halloween T-Shirt",
      description: "Comfortable classic tee for spooky season",
      handle: "vintage-black-cat-halloween-t-shirt",
    },
    productUnderstanding: pu,
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  // Must contain cat and halloween and vintage apparel signals
  assert.ok(result.targetAudience.some((a) => a.includes("cat lovers")));
  assert.ok(result.suitableOccasions.some((o) => o.includes("halloween")));
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("cat") && k.includes("t-shirt")));

  // Must NOT hallucinate unrelated niches
  assert.ok(!result.targetAudience.some((a) => a.includes("dog")));
  assert.ok(!result.suitableOccasions.some((o) => o.includes("christmas")));
  assert.ok(!result.targetAudience.some((a) => a.includes("coffee")));
});

// ---------------------------------------------------------------------------
// GROUP C: OCR Recipient Semantics
// ---------------------------------------------------------------------------

test("Group C: Recipient Semantics — OCR 'BEST NURSE EVER' infers nurse & nurse gift shoppers without equating buyer to nurse", async () => {
  const pu: ProductUnderstanding = {
    ocrTexts: ["BEST NURSE EVER"],
    detectedEntities: ["medical cross", "stethoscope"],
    dominantColors: ["white", "blue"],
    visualStyle: "clean minimalist",
    productCategory: "ceramic mug",
  };

  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "nursing gifts",
      title: "Best Nurse Ever Ceramic Mug",
      description: "Appreciation gift for dedicated nurses",
      handle: "best-nurse-ever-ceramic-mug",
    },
    productUnderstanding: pu,
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(result.targetAudience.includes("nurses"));
  assert.ok(result.targetAudience.includes("nurse gift shoppers"));
  assert.ok(result.suitableOccasions.includes("nurse appreciation"));
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("gift for nurse") || k.includes("nurse mug")));
});

// ---------------------------------------------------------------------------
// GROUP D: Color Non-Inference Invariant
// ---------------------------------------------------------------------------

test("Group D: Color Invariant — dominantColors 'pink' does not infer demographic audiences (women/girls/moms)", async () => {
  const pu: ProductUnderstanding = {
    ocrTexts: [],
    detectedEntities: ["geometric cube"],
    dominantColors: ["pink", "magenta"],
    visualStyle: "modern abstract",
    productCategory: "t-shirt",
  };

  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "abstract streetwear",
      title: "Geometric Cube Tee",
      description: "Vibrant abstract pattern tee",
      handle: "geometric-cube-tee",
    },
    productUnderstanding: pu,
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(!result.targetAudience.includes("women"));
  assert.ok(!result.targetAudience.includes("girls"));
  assert.ok(!result.targetAudience.includes("mothers"));
  assert.ok(!result.targetAudience.includes("moms"));
});

// ---------------------------------------------------------------------------
// GROUP E: Seasonal Occasions
// ---------------------------------------------------------------------------

test("Group E: Occasions — Halloween theme produces Halloween occasion without Christmas bleed", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "halloween gifts",
      title: "Spooky Jack O Lantern Mug",
      description: "Pumpkin coffee cup for October",
      handle: "spooky-jack-o-lantern-mug",
    },
    productUnderstanding: {
      ocrTexts: ["Spooky Season"],
      detectedEntities: ["pumpkin", "ghost"],
      dominantColors: ["orange", "black"],
      visualStyle: "cute cartoon",
      productCategory: "ceramic mug",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(result.suitableOccasions.some((o) => o.includes("halloween")));
  assert.ok(!result.suitableOccasions.some((o) => o.includes("christmas")));
  assert.ok(!result.suitableOccasions.some((o) => o.includes("valentine")));
});

// ---------------------------------------------------------------------------
// GROUP F: Category Use Cases
// ---------------------------------------------------------------------------

test("Group F: Category Use Cases — physical category matches realistic use cases", async () => {
  const analyzer = new HeuristicShoppingContextAnalyzer();

  const mugRes = await analyzer.analyze({
    source: { niche: "coffee", title: "Plain Mug", description: "", handle: "plain-mug" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["white"],
      visualStyle: "minimalist",
      productCategory: "ceramic mug",
    },
  });
  assert.ok(mugRes.useCases.includes("daily coffee or tea"));

  const rugRes = await analyzer.analyze({
    source: { niche: "home", title: "Living Room Rug", description: "", handle: "living-room-rug" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["beige"],
      visualStyle: "minimalist",
      productCategory: "rug",
    },
  });
  assert.ok(rugRes.useCases.includes("room styling"));

  const bagRes = await analyzer.analyze({
    source: { niche: "accessories", title: "Leather Handbag", description: "", handle: "leather-handbag" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["brown"],
      visualStyle: "classic",
      productCategory: "leather handbag",
    },
  });
  assert.ok(bagRes.useCases.includes("everyday carry"));

  const teeRes = await analyzer.analyze({
    source: { niche: "apparel", title: "Cotton Tee", description: "", handle: "cotton-tee" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["black"],
      visualStyle: "casual",
      productCategory: "t-shirt",
    },
  });
  assert.ok(teeRes.useCases.includes("everyday casual wear"));
});

// ---------------------------------------------------------------------------
// GROUP G: Personalization Invariant
// ---------------------------------------------------------------------------

test("Group G: Personalization — only generates personalized seeds when explicit personalization signal exists", async () => {
  const analyzer = new HeuristicShoppingContextAnalyzer();

  // Case 1: with personalized signal
  const withPersonalized = await analyzer.analyze({
    source: {
      niche: "pets",
      title: "Personalized Custom Name Cat Mug",
      description: "Upload photo and add your name",
      handle: "personalized-cat-mug",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cat"],
      dominantColors: ["white"],
      visualStyle: "cute",
      productCategory: "ceramic mug",
    },
  });

  assert.ok(
    withPersonalized.buyerIntentKeywords.some(
      (k) => k.includes("personalized") || k.includes("custom"),
    ),
    "Must include personalized/custom keyword when signal present",
  );

  // Case 2: without personalized signal
  const withoutPersonalized = await analyzer.analyze({
    source: {
      niche: "pets",
      title: "Vintage Cat Ceramic Mug",
      description: "Classic ceramic coffee mug featuring retro cat art",
      handle: "vintage-cat-ceramic-mug",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cat"],
      dominantColors: ["white"],
      visualStyle: "vintage",
      productCategory: "ceramic mug",
    },
  });

  assert.ok(
    !withoutPersonalized.buyerIntentKeywords.some(
      (k) => k.includes("personalized") || k.includes("custom"),
    ),
    "Must NOT include personalized/custom keyword when NO signal exists",
  );
});

// ---------------------------------------------------------------------------
// GROUP H: Style
// ---------------------------------------------------------------------------

test("Group H: Style — visualStyle influences audience and keywords without overriding product category", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "apparel",
      title: "Retro Sunset Tee",
      description: "70s aesthetic graphic t-shirt",
      handle: "retro-sunset-tee",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["sunset"],
      dominantColors: ["orange", "yellow"],
      visualStyle: "vintage retro",
      productCategory: "t-shirt",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(result.targetAudience.includes("vintage aesthetic enthusiasts"));
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("vintage")));
  // Style must NOT be the sole product category
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("t-shirt")));
});

// ---------------------------------------------------------------------------
// GROUP I: Buyer Keyword Quality
// ---------------------------------------------------------------------------

test("Group I: Keyword Quality — validates no banned terms, no empty, and contains category", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "cats",
      title: "Cute Cat Hoodie",
      description: "Warm casual sweatshirt with cat illustration",
      handle: "cute-cat-hoodie",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cat"],
      dominantColors: ["gray"],
      visualStyle: "cute cartoon",
      productCategory: "hoodie",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(result.buyerIntentKeywords.length >= 3 && result.buyerIntentKeywords.length <= 12);

  for (const kw of result.buyerIntentKeywords) {
    assert.ok(kw.length > 0, "Keyword must not be empty");
    assert.equal(kw, kw.toLowerCase(), "Keyword must be lowercase");
    assert.ok(!kw.includes("best"), "Must not contain 'best'");
    assert.ok(!kw.includes("cheap"), "Must not contain 'cheap'");
    assert.ok(!kw.includes("near me"), "Must not contain 'near me'");
    assert.ok(!kw.includes("ideas"), "Must not contain 'ideas'");
    assert.ok(!kw.includes("amazon"), "Must not contain 'amazon'");
    assert.ok(!kw.includes("etsy"), "Must not contain 'etsy'");
  }

  // At least one seed must contain category
  assert.ok(
    result.buyerIntentKeywords.some((k) => k.includes("hoodie")),
    "At least one keyword must contain product category noun",
  );
});

// ---------------------------------------------------------------------------
// GROUP J: Heuristic Determinism
// ---------------------------------------------------------------------------

test("Group J: Determinism — 100 runs on identical input yield exact identical results", async () => {
  const analyzer = new HeuristicShoppingContextAnalyzer();
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "book lovers",
      title: "Just One More Chapter Ceramic Mug",
      description: "Cozy reading mug for bookworms",
      handle: "just-one-more-chapter-ceramic-mug",
    },
    productUnderstanding: {
      ocrTexts: ["Just One More Chapter"],
      detectedEntities: ["book", "reading"],
      dominantColors: ["white", "black"],
      visualStyle: "minimalist",
      productCategory: "ceramic mug",
    },
  };

  const baseline = await analyzer.analyze(input);

  for (let i = 0; i < 100; i++) {
    const run = await analyzer.analyze(input);
    assert.deepEqual(run.targetAudience, baseline.targetAudience);
    assert.deepEqual(run.suitableOccasions, baseline.suitableOccasions);
    assert.deepEqual(run.useCases, baseline.useCases);
    assert.deepEqual(run.buyerIntentKeywords, baseline.buyerIntentKeywords);
  }
});

// ---------------------------------------------------------------------------
// GROUP K: Sparse Input
// ---------------------------------------------------------------------------

test("Group K: Sparse Input — survives missing/empty B1 and empty source fields with safe defaults", async () => {
  const analyzer = new HeuristicShoppingContextAnalyzer();

  const emptyInput: ShoppingContextAnalysisInput = {
    source: {
      niche: "",
      title: "",
      description: "",
      handle: "",
    },
    productUnderstanding: undefined,
  };

  const result = await analyzer.analyze(emptyInput);

  assert.ok(result.targetAudience.length >= 1, "targetAudience must not be empty");
  assert.ok(result.suitableOccasions.length >= 1, "suitableOccasions must not be empty");
  assert.ok(result.useCases.length >= 1, "useCases must not be empty");
  assert.ok(result.buyerIntentKeywords.length >= 1, "buyerIntentKeywords must not be empty");
  assert.deepEqual(result.targetAudience, ["general shoppers"]);
  assert.deepEqual(result.suitableOccasions, ["everyday use"]);
  assert.deepEqual(result.useCases, ["personal use"]);
});

// ---------------------------------------------------------------------------
// GROUP L: Gemini Fallback & Retry Policy
// ---------------------------------------------------------------------------

test("Group L: Fallback — FallbackShoppingContextAnalyzer falls back to heuristic on Gemini failure", async () => {
  const fakeGenerator = new FakeGeminiContentGenerator();
  fakeGenerator.setTextHandler(async () => {
    throw new GeminiGeneratorError("Service Unavailable", 503, true);
  });

  let fallbackCalled = false;
  const geminiAnalyzer = new GeminiShoppingContextAnalyzer({
    generator: fakeGenerator,
    maxRetries: 0,
  });

  const fallbackAnalyzer = new FallbackShoppingContextAnalyzer({
    primary: geminiAnalyzer,
    fallback: heuristicShoppingContextAnalyzer,
    onFallback: () => {
      fallbackCalled = true;
    },
  });

  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "cats",
      title: "Cat T-Shirt",
      description: "",
      handle: "cat-t-shirt",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cat"],
      dominantColors: ["black"],
      visualStyle: "casual",
      productCategory: "t-shirt",
    },
  };

  const result = await fallbackAnalyzer.analyze(input);

  assert.ok(fallbackCalled, "Fallback callback must be called on primary error");
  assert.ok(result.targetAudience.includes("cat lovers"));
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("t-shirt")));
});

test("Group L: Retry — GeminiShoppingContextAnalyzer retries once on retryable error (429) and succeeds", async () => {
  let callCount = 0;
  const fakeGenerator = new FakeGeminiContentGenerator();

  fakeGenerator.setTextHandler(async () => {
    callCount++;
    if (callCount === 1) {
      throw new GeminiGeneratorError("Rate Limit", 429, true);
    }
    return {
      rawText: JSON.stringify({
        targetAudience: ["cat lovers"],
        suitableOccasions: ["everyday wear"],
        useCases: ["casual wear"],
        buyerIntentKeywords: ["cat t-shirt", "gift for cat lover", "cute cat shirt"],
      }),
    };
  });

  const geminiAnalyzer = new GeminiShoppingContextAnalyzer({
    generator: fakeGenerator,
    maxRetries: 1,
  });

  const result = await geminiAnalyzer.analyze({
    source: { niche: "cats", title: "Cat Tee", description: "", handle: "cat-tee" },
  });

  assert.equal(callCount, 2, "Must retry once on 429 error and succeed");
  assert.deepEqual(result.targetAudience, ["cat lovers"]);
});

test("Group L: Non-retryable — throws immediately without retry on non-retryable error (403)", async () => {
  let callCount = 0;
  const fakeGenerator = new FakeGeminiContentGenerator();

  fakeGenerator.setTextHandler(async () => {
    callCount++;
    throw new GeminiGeneratorError("Permission Denied", 403, false);
  });

  const geminiAnalyzer = new GeminiShoppingContextAnalyzer({
    generator: fakeGenerator,
    maxRetries: 2,
  });

  await assert.rejects(
    async () => {
      await geminiAnalyzer.analyze({
        source: { niche: "cats", title: "Cat Tee", description: "", handle: "cat-tee" },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof GeminiGeneratorError);
      assert.equal(err.status, 403);
      return true;
    },
  );

  assert.equal(callCount, 1, "Must NOT retry non-retryable 403 error");
});

// ---------------------------------------------------------------------------
// GROUP M: Observability
// ---------------------------------------------------------------------------

test("Group M: Observability — onFallback callback emits warning once on primary failure", async () => {
  const loggedWarnings: string[] = [];

  const mockFailingPrimary: ShoppingContextAnalyzer = {
    async analyze() {
      throw new Error("Simulated primary failure");
    },
  };

  const fallbackAnalyzer = new FallbackShoppingContextAnalyzer({
    primary: mockFailingPrimary,
    fallback: heuristicShoppingContextAnalyzer,
    onFallback: (err, inp) => {
      loggedWarnings.push(`[SEO B2 Fallback] ${inp.source.title}: ${(err as Error).message}`);
    },
  });

  const input: ShoppingContextAnalysisInput = {
    source: { niche: "test", title: "Observable Mug", description: "", handle: "test-mug" },
  };

  const result = await fallbackAnalyzer.analyze(input);

  assert.equal(loggedWarnings.length, 1);
  assert.ok(loggedWarnings[0].includes("[SEO B2 Fallback] Observable Mug: Simulated primary failure"));
  assert.ok(result.targetAudience.length >= 1);
});

// ---------------------------------------------------------------------------
// GROUP N: Dependency Injection
// ---------------------------------------------------------------------------

test("Group N: DI — createB2ShoppingContextStage respects custom injected analyzer with zero network", async () => {
  let injectedCalled = false;

  const mockAnalyzer: ShoppingContextAnalyzer = {
    async analyze(inp: ShoppingContextAnalysisInput) {
      injectedCalled = true;
      return {
        targetAudience: ["custom injected audience"],
        suitableOccasions: ["custom occasion"],
        useCases: ["custom use case"],
        buyerIntentKeywords: [
          `custom ${inp.source.niche}`,
          "custom keyword 2",
          "custom keyword 3",
        ],
      };
    },
  };

  const stage = createB2ShoppingContextStage({ analyzer: mockAnalyzer });
  const initial = createInitialContext(seoContentMockInput);
  const next = await stage.execute(initial);

  assert.ok(injectedCalled, "Injected analyzer must be invoked");
  assert.deepEqual(next.shoppingContext?.targetAudience, ["custom injected audience"]);
});

// ---------------------------------------------------------------------------
// GROUP O: Context Immutability
// ---------------------------------------------------------------------------

test("Group O: Immutability — B2 returns new context without mutating original context", async () => {
  const initial = createInitialContext(seoContentMockInput);
  assert.equal(initial.shoppingContext, undefined);

  const evolved = await b2ShoppingContextStage.execute(initial);

  assert.notEqual(evolved, initial, "Evolved context must be a new object reference");
  assert.equal(evolved.source, initial.source, "Context source must be identical reference");
  assert.equal(evolved.productUnderstanding, initial.productUnderstanding);
  assert.equal(initial.shoppingContext, undefined, "Initial context must remain unmutated");
  assert.ok(evolved.shoppingContext !== undefined, "Evolved context must contain shoppingContext");
});

// ---------------------------------------------------------------------------
// GROUP P: Pipeline Integration & Regression
// ---------------------------------------------------------------------------

test("Group P: Pipeline Integration — B1 -> B2 -> B3 flows cleanly, downstream stages consume B2", async () => {
  const pipeline = createSeoPipeline(DEFAULT_SEO_PIPELINE_STAGES);
  const output = await pipeline.execute(seoContentMockInput);

  assert.ok(output.productTitle, "Pipeline must succeed and output product title");
  assert.ok(output.productHandle, "Pipeline must succeed and output product handle");
  assert.equal(output.images.length, seoContentMockInput.images.length);
});

// ---------------------------------------------------------------------------
// GROUP Q: Heuristic Precision & Fallback Isolation
// ---------------------------------------------------------------------------

test("Group Q1: Heuristic Precision — generic fallback keywords are excluded when rich entity/occasion signals exist", async () => {
  const pu: ProductUnderstanding = {
    ocrTexts: ["Trick or Treat"],
    detectedEntities: ["black cat", "pumpkin"],
    dominantColors: ["black", "orange"],
    visualStyle: "vintage retro",
    productCategory: "t-shirt",
  };

  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "halloween apparel",
      title: "Vintage Black Cat Halloween T-Shirt",
      description: "Comfortable classic tee for spooky season",
      handle: "vintage-black-cat-halloween-t-shirt",
    },
    productUnderstanding: pu,
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  // Must have rich specific keywords
  assert.ok(result.buyerIntentKeywords.length >= 3);
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("vintage black cat t-shirt")));
  assert.ok(result.buyerIntentKeywords.some((k) => k.includes("black cat halloween t-shirt")));

  // MUST NOT contain generic fallback keywords
  assert.ok(!result.buyerIntentKeywords.includes("casual t-shirt"), "Must not include generic 'casual t-shirt'");
  assert.ok(!result.buyerIntentKeywords.includes("everyday t-shirt"), "Must not include generic 'everyday t-shirt'");
  assert.ok(!result.buyerIntentKeywords.includes("t-shirt"), "Must not include generic standalone 't-shirt'");
});

test("Group Q2: Heuristic Precision — generic fallback keywords are still active when input is sparse", async () => {
  // Completely sparse input: only category known, no entities, no style, no occasion
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "",
      title: "Plain Shirt",
      description: "",
      handle: "plain-shirt",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: [],
      visualStyle: "",
      productCategory: "t-shirt",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  // Must have at least 3 keywords by falling back to generic category seeds
  assert.ok(result.buyerIntentKeywords.length >= 3, "Sparse input must receive >= 3 buyer intent keywords");
  assert.ok(
    result.buyerIntentKeywords.includes("casual t-shirt") ||
    result.buyerIntentKeywords.includes("everyday t-shirt") ||
    result.buyerIntentKeywords.includes("t-shirt"),
    "Sparse input must contain generic category fallback seeds",
  );
});

// ---------------------------------------------------------------------------
// GROUP R: Robustness & Precision Enhancements
// ---------------------------------------------------------------------------

test("Group R1: Schema — extracts JSON when markdown fence is surrounded by explanatory text", () => {
  const llmOutput = `Here is your shopping context JSON:
\`\`\`json
{
  "targetAudience": ["cat lovers"],
  "suitableOccasions": ["halloween party"],
  "useCases": ["casual lounging"],
  "buyerIntentKeywords": ["vintage cat shirt", "halloween cat apparel", "cute cat tee"]
}
\`\`\`
Hope this helps your ecommerce store!`;

  const parsed = parseAndNormalizeShoppingContext(llmOutput);
  assert.deepEqual(parsed.targetAudience, ["cat lovers"]);
  assert.deepEqual(parsed.suitableOccasions, ["halloween party"]);
  assert.equal(parsed.buyerIntentKeywords.length, 3);
});

test("Group R2: Recipient Semantics — 'friend' recipient produces unbanned 'gift for friend' seeds", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "friend gifts",
      title: "Friendship Coffee Mug",
      description: "Gift for a dear friend",
      handle: "friendship-coffee-mug",
    },
    productUnderstanding: {
      ocrTexts: ["FOR MY BEST FRIEND"],
      detectedEntities: [],
      dominantColors: ["white"],
      visualStyle: "minimalist",
      productCategory: "mug",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(result.targetAudience.includes("friends"));
  assert.ok(result.targetAudience.includes("gift shoppers"));
  assert.ok(
    result.buyerIntentKeywords.includes("gift for friend"),
    "Must generate 'gift for friend' and not be dropped by banned terms filter",
  );
  assert.ok(
    result.buyerIntentKeywords.some((k) => k.includes("friend") && k.includes("mug")),
    "Must include friend mug keyword",
  );
});

test("Group R3: Category Ordering — more specific 'coffee mug' matches before generic 'mug'", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "drinkware",
      title: "Handmade Ceramic Coffee Mug",
      description: "Artisan coffee mug",
      handle: "handmade-ceramic-coffee-mug",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["beige"],
      visualStyle: "artisan",
      productCategory: "", // empty so title resolution is exercised
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(
    result.buyerIntentKeywords.some((k) => k.includes("coffee mug")),
    "Must resolve to 'coffee mug' noun rather than just 'mug'",
  );
});

test("Group R4: Category Coverage — recognizes sticker, quilt, and bedding set with proper domains", async () => {
  const stickerRes = await heuristicShoppingContextAnalyzer.analyze({
    source: { niche: "stationery", title: "Cute Cat Vinyl Sticker", description: "", handle: "cat-sticker" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["cat"],
      dominantColors: ["white"],
      visualStyle: "cute cartoon",
      productCategory: "sticker",
    },
  });

  assert.ok(stickerRes.targetAudience.includes("sticker collectors"));
  assert.ok(stickerRes.useCases.includes("laptop or water bottle decoration"));
  assert.ok(stickerRes.buyerIntentKeywords.some((k) => k.includes("sticker")));

  const quiltRes = await heuristicShoppingContextAnalyzer.analyze({
    source: { niche: "home", title: "Patchwork Quilt", description: "", handle: "patchwork-quilt" },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: ["blue"],
      visualStyle: "vintage",
      productCategory: "quilt",
    },
  });

  assert.ok(quiltRes.targetAudience.includes("home comfort shoppers"));
  assert.ok(quiltRes.useCases.includes("bed or couch layering"));
  assert.ok(quiltRes.buyerIntentKeywords.some((k) => k.includes("quilt")));
});

test("Group R5: Entity Preservation — non-allowlist visual entity 'sunset' forms natural product seeds", async () => {
  const input: ShoppingContextAnalysisInput = {
    source: {
      niche: "nature apparel",
      title: "Retro Sunset Tee",
      description: "Sunset design",
      handle: "retro-sunset-tee",
    },
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["sunset"],
      dominantColors: ["orange"],
      visualStyle: "vintage retro",
      productCategory: "t-shirt",
    },
  };

  const result = await heuristicShoppingContextAnalyzer.analyze(input);

  assert.ok(
    result.buyerIntentKeywords.some((k) => k === "vintage sunset t-shirt"),
    "Must generate Axis 1 phrase 'vintage sunset t-shirt'",
  );
  assert.ok(
    result.buyerIntentKeywords.some((k) => k === "sunset t-shirt"),
    "Must generate Axis 4 phrase 'sunset t-shirt'",
  );
  // Ensure no awkward phrases like "gift for sunset lover"
  assert.ok(
    !result.buyerIntentKeywords.some((k) => k.includes("sunset lover")),
    "Must not generate awkward 'sunset lover' phrase",
  );
});

test("Group R6: Gemini Prompt — includes handle in SOURCE PRODUCT metadata", () => {
  const fakeGenerator = new FakeGeminiContentGenerator();
  const analyzer = new GeminiShoppingContextAnalyzer({
    generator: fakeGenerator,
  });

  const prompt = analyzer.buildPrompt({
    source: {
      niche: "pets",
      title: "Design #42",
      description: "Great tee",
      handle: "vintage-black-cat-halloween-shirt",
    },
    productUnderstanding: {
      ocrTexts: ["Boo"],
      detectedEntities: ["cat"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "t-shirt",
    },
  });

  assert.ok(prompt.includes("Handle: vintage-black-cat-halloween-shirt"));
  assert.ok(prompt.includes("Title: Design #42"));
});


