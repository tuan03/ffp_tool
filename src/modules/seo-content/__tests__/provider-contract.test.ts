import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SEO_PIPELINE_VERSION,
  createGeminiSeoProviderFactory,
  protectSeoProviderRuntime,
  SeoProviderCircuitBreaker,
  SeoProviderRegistry,
  prepareSeoProviderInput,
} from "../internal/providers";
import type { SeoProviderCircuitRecord } from "../internal/persistence/repositories";
import type { SeoProviderCircuitStore, SeoProviderRuntime } from "../internal/providers";
import { computeProductInputHash, computeSeoResultCacheKey, InMemorySeoCheckpointStore } from "../internal/checkpoint";
import { runSeoContent } from "../service";
import type { SeoContentInput } from "../types";

const baseInput: SeoContentInput = {
  storeId: "store-a",
  siteDomain: "store-a.example",
  productId: "product-1",
  url: "https://store-a.example/products/rug",
  handle: "rug",
  title: "Pattern Rug",
  description: "A patterned area rug.",
  niche: "home decor",
  images: [{ id: "hero", url: "https://cdn.example/rug.jpg", alt: "Pattern rug" }],
  existingPrimaryKeyword: "pattern rug",
  existingKeywords: ["area rug", "pattern rug"],
  sourceVersion: "revision-1",
  shopifyUpdatedAt: "2026-09-30T00:00:00.000Z",
  providerId: "gemini",
  pipelineVersion: DEFAULT_SEO_PIPELINE_VERSION,
  variants: [{ title: "Blue", sku: "BLUE", privateSupplierPayload: "must-not-cross-provider-boundary" }],
};

class AtomicMemoryCircuitStore implements SeoProviderCircuitStore {
  public record: SeoProviderCircuitRecord | undefined;

  public async get(): Promise<SeoProviderCircuitRecord | undefined> {
    return this.record ? { ...this.record } : undefined;
  }

  public async tryAcquireProbe(providerId: string, model: string, now: number, probeLeaseMs = 30_000): Promise<boolean> {
    const current = this.record;
    if (!current || !["open", "half_open"].includes(current.state) || (current.retryAfter ?? 0) > now) {
      return false;
    }
    this.record = { ...current, providerId, model, state: "half_open", retryAfter: now + probeLeaseMs };
    return true;
  }

  public async recordFailure(
    providerId: string,
    model: string,
    now: number,
    error: Readonly<Record<string, unknown>>,
    threshold: number,
    retryAfterMs: number,
  ): Promise<SeoProviderCircuitRecord> {
    const failureCount = (this.record?.failureCount ?? 0) + 1;
    const state = failureCount >= threshold ? "open" : "closed";
    this.record = {
      providerId,
      model,
      state,
      failureCount,
      openedAt: state === "open" ? now : undefined,
      retryAfter: state === "open" ? now + retryAfterMs : undefined,
      lastError: error,
    };
    return this.record;
  }

  public async recordSuccess(providerId: string, model: string): Promise<void> {
    this.record = { providerId, model, state: "closed", failureCount: 0 };
  }
}

test("provider input replaces raw variants with a bounded summary", () => {
  const prepared = prepareSeoProviderInput(baseInput);

  assert.equal("variants" in prepared, false);
  assert.equal(prepared.variantSummary?.variantCount, 1);
  assert.equal(prepared.variantSummary?.sampleVariants[0]?.title, "Blue");
  assert.equal(JSON.stringify(prepared).includes("privateSupplierPayload"), false);
  assert.equal(prepared.providerId, "gemini");
  assert.equal(prepared.pipelineVersion, DEFAULT_SEO_PIPELINE_VERSION);
});

test("checkpoint hash covers stale-result dimensions but never hashes raw variant payload", () => {
  const baselineHash = computeProductInputHash(baseInput);
  const prepared = prepareSeoProviderInput(baseInput);

  assert.equal(baselineHash, computeProductInputHash(prepared));
  assert.equal(
    baselineHash,
    computeProductInputHash({
      ...baseInput,
      variants: [{ title: "Blue", sku: "BLUE", unrelatedRawPayload: { secret: true } }],
    }),
    "raw transport-only variant fields must not affect the cache identity",
  );

  const changedInputs: readonly SeoContentInput[] = [
    { ...baseInput, siteDomain: "other.example" },
    { ...baseInput, productId: "product-2" },
    { ...baseInput, sourceVersion: "revision-2" },
    { ...baseInput, shopifyUpdatedAt: "2026-10-01T00:00:00.000Z" },
    { ...baseInput, providerId: "future-provider" },
    { ...baseInput, pipelineVersion: "seo-b1-b6-v2" },
    { ...baseInput, existingKeywords: ["different keyword"] },
    { ...baseInput, images: [{ ...baseInput.images[0], alt: "Different visual fingerprint" }] },
    {
      ...baseInput,
      variants: undefined,
      variantSummary: {
        variantCount: 2,
        optionNames: ["Color"],
        sampleVariants: [{ title: "Blue" }, { title: "Red" }],
      },
    },
  ];

  for (const changedInput of changedInputs) {
    assert.notEqual(computeProductInputHash(changedInput), baselineHash);
  }
});

test("result cache identity changes with model, prompt, corpus, and pipeline versions", () => {
  const baseline = { inputHash: "input", corpusRevision: 1, promptVersion: "prompts-v1", model: "model-v1", pipelineVersion: "pipeline-v1" };
  const key = computeSeoResultCacheKey(baseline);
  assert.notEqual(key, computeSeoResultCacheKey({ ...baseline, corpusRevision: 2 }));
  assert.notEqual(key, computeSeoResultCacheKey({ ...baseline, promptVersion: "prompts-v2" }));
  assert.notEqual(key, computeSeoResultCacheKey({ ...baseline, model: "model-v2" }));
  assert.notEqual(key, computeSeoResultCacheKey({ ...baseline, pipelineVersion: "pipeline-v2" }));
});

test("provider registry is explicit, extensible, and rejects duplicate or unknown providers", () => {
  const registry = new SeoProviderRegistry();
  registry.register({
    providerId: "future-provider",
    create: () => ({
      providerId: "future-provider",
      model: "future-model-v1",
      imageAnalyzer: {
        analyze: async () => ({
          typography: { visibleTexts: [], styleSummary: "none" },
          visualEntities: "pattern",
          sceneContext: "room",
          physicalProductIdentity: "rug",
        }),
      },
      shoppingContextAnalyzer: {
        analyze: async () => ({
          targetAudience: [],
          suitableOccasions: [],
          useCases: [],
          buyerIntentKeywords: [],
        }),
      },
      keywordConflictAnalyzer: {
        analyze: async () => ({ approvedKeywords: [], discardedKeywords: [], conflictReasons: {} }),
      },
      contentGenerator: {
        generate: async () => ({
          productTitle: "Pattern Rug",
          intro: "Pattern rug for the home.",
          bullets: [],
          guidance: [],
          closing: "Complete the room.",
          productSeoTitle: "Pattern Rug",
          productSeoDescription: "Pattern rug for home decor.",
        }),
      },
    }),
  });

  const runtime = registry.create(" FUTURE-PROVIDER ", {
    imageMode: "full",
    requestOptions: {},
    onFallback: () => undefined,
  });
  assert.equal(runtime.providerId, "future-provider");
  assert.equal(runtime.model, "future-model-v1");
  assert.deepEqual(registry.list(), ["future-provider"]);
  assert.throws(() => registry.register({
    providerId: "future-provider",
    create: () => runtime,
  }), /already registered/);
  assert.throws(() => registry.create("missing", {
    imageMode: "full",
    requestOptions: {},
    onFallback: () => undefined,
  }), /Unsupported SEO provider/);
});

test("provider circuit opens after repeated terminal failures and resets after a probe succeeds", async () => {
  const store = new AtomicMemoryCircuitStore();
  const breaker = new SeoProviderCircuitBreaker(store, { failureThreshold: 2, resetTimeoutMs: 1_000 });

  await assert.rejects(() => breaker.execute("gemini", "model", async () => { throw new Error("one"); }));
  await assert.rejects(() => breaker.execute("gemini", "model", async () => { throw new Error("two"); }));
  assert.equal(store.record?.state, "open");
  await assert.rejects(
    () => breaker.execute("gemini", "model", async () => "blocked"),
    /circuit is open/,
  );

  if (!store.record) throw new Error("Expected an open circuit record");
  store.record = { ...store.record, retryAfter: Date.now() - 1 };
  assert.equal(await breaker.execute("gemini", "model", async () => "ok"), "ok");
  assert.equal(store.record?.state, "closed");
  assert.equal(store.record?.failureCount, 0);
});

test("provider circuit admits exactly one half-open probe and atomically counts concurrent failures", async () => {
  const store = new AtomicMemoryCircuitStore();
  const breaker = new SeoProviderCircuitBreaker(store, { failureThreshold: 100, resetTimeoutMs: 1_000 });

  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    breaker.execute("gemini", "model", async () => { throw new Error(`failure-${index}`); }).catch(() => undefined),
  ));
  assert.equal(store.record?.failureCount, 20);

  store.record = {
    providerId: "gemini",
    model: "model",
    state: "open",
    failureCount: 100,
    retryAfter: Date.now() - 1,
  };
  let releaseProbe: (() => void) | undefined;
  const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
  const firstProbe = breaker.execute("gemini", "model", async () => {
    await probeGate;
    return "probe-ok";
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    () => breaker.execute("gemini", "model", async () => "must-not-run"),
    /probe is already running/,
  );
  releaseProbe?.();
  assert.equal(await firstProbe, "probe-ok");
});

test("provider circuit records a primary Gemini failure while preserving successful heuristic fallback", async () => {
  const store = new AtomicMemoryCircuitStore();
  const breaker = new SeoProviderCircuitBreaker(store, { failureThreshold: 1, resetTimeoutMs: 1_000 });
  let primaryFailure: unknown = new Error("Gemini unavailable");
  const runtime: SeoProviderRuntime = {
    providerId: "gemini",
    model: "model",
    imageAnalyzer: {
      analyze: async () => ({
        typography: { visibleTexts: [], styleSummary: "fallback" },
        visualEntities: "rug",
        sceneContext: "room",
        physicalProductIdentity: "rug",
      }),
    },
    shoppingContextAnalyzer: { analyze: async () => ({ targetAudience: [], suitableOccasions: [], useCases: [], buyerIntentKeywords: [] }) },
    keywordConflictAnalyzer: { analyze: async () => ({ approvedKeywords: [], discardedKeywords: [], conflictReasons: {}, corpusRevision: 0 }) },
    contentGenerator: { generate: async () => { throw new Error("unused"); } },
    consumePrimaryFailure: () => {
      const error = primaryFailure;
      primaryFailure = undefined;
      return error;
    },
  };

  const protectedRuntime = protectSeoProviderRuntime(runtime, breaker);
  const analysis = await protectedRuntime.imageAnalyzer.analyze({
    images: [], title: "Rug", description: "Rug", niche: "decor",
  });
  assert.equal(analysis.physicalProductIdentity, "rug");
  assert.equal(store.record?.state, "open");
  assert.equal(store.record?.failureCount, 1);
  assert.match(String(store.record?.lastError?.message), /Gemini unavailable/);
});

test("unreadable B1 images fall back without opening the Gemini provider circuit", async () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  process.env.GOOGLE_CLOUD_PROJECT = "fixture-project";
  try {
    const store = new AtomicMemoryCircuitStore();
    const runtime = createGeminiSeoProviderFactory().create({
      imageMode: "full",
      requestOptions: {},
      onFallback: () => undefined,
    });
    const protectedRuntime = protectSeoProviderRuntime(runtime, new SeoProviderCircuitBreaker(store));
    const analysis = await protectedRuntime.imageAnalyzer.analyze({
      images: [], title: "Pattern rug", description: "", niche: "home decor",
    });
    assert.equal(analysis.physicalProductIdentity, "area rug");
    assert.equal(store.record, undefined);
  } finally {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
  }
});

test("simple runner uses the same checkpointed session path as the detailed runner", async () => {
  const checkpointStore = new InMemorySeoCheckpointStore();
  const input: SeoContentInput = {
    ...baseInput,
    storeId: undefined,
    images: [],
    title: "Checkpoint Path Rug",
    description: "A simple rug used to verify checkpoint persistence.",
    handle: "checkpoint-path-rug",
  };

  await runSeoContent(input, { dependencies: { checkpointStore } });

  const providerInput = prepareSeoProviderInput(input);
  const checkpoint = await checkpointStore.get(computeProductInputHash(providerInput));
  assert.ok(checkpoint);
  assert.deepEqual(
    Object.keys(checkpoint.stages).sort(),
    ["b1", "b2", "b3", "b4", "b5", "b6"],
  );
  assert.ok(Object.values(checkpoint.stages).every((stage) => stage?.status === "completed"));
});
