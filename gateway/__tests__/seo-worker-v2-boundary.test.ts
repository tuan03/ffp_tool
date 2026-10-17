import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoEnqueue, GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { resolveStoreProfile } from "../../src/modules/seo-content";
import { assertV2WorkerJob, normalizeSeoEnqueue, parseSeoGenerationInput } from "../custom-gpt-seo/input-contract";
import type { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";
import { SeoWorkerError } from "../seo-worker/protocol";

const storeProfile = {
  profileId: "jeminise-bedding",
  profileVersion: "2.0.0",
  storeId: "jeminise",
  storeName: "Jeminise",
  locale: "en-US",
  language: "English",
  niche: "Bedding",
  brandVoice: ["clear"],
  contentRules: ["Ground product facts in pixels"],
  prohibitedClaims: ["Unsupported material claims"],
  seoConstraints: { maxTitleCharacters: 70, maxDescriptionCharacters: 160, maxAltCharacters: 125 },
} as const;

const enqueue: GptSeoEnqueue = {
  input: { images: [{ id: "image-1", url: "https://cdn.shopify.com/image.webp" }], niche: "Bedding", storeProfile },
  execution: { storeId: "jeminise", productId: "gid://shopify/Product/123", source: "auto_seo",
    sourceIdentity: "gid://shopify/Product/123", providerId: "codex_mcp", pipelineVersion: "seo-worker-v2", originalSnapshot: { updatedAt: "v1" } },
};

test("V2 boundary accepts exactly images, niche and storeProfile and normalizes only the execution envelope", () => {
  const normalized = normalizeSeoEnqueue(enqueue);
  assert.deepEqual(Object.keys(normalized.input).sort(), ["images", "niche", "storeProfile"]);
  assert.equal(normalized.execution.productId, "123");
  assert.equal(normalized.execution.sourceIdentity, "123");
});

test("V2 boundary preserves the server-owned automatic publish policy", () => {
  const normalized = normalizeSeoEnqueue({
    ...enqueue,
    execution: { ...enqueue.execution, autoPublishAfterSeo: true },
  });
  assert.equal(normalized.execution.autoPublishAfterSeo, true);
});

test("V2 boundary accepts a runtime store alias resolved from its registered Shopify domain", () => {
  const runtimeStoreId = "preaureum_dev";
  const runtimeProfile = resolveStoreProfile({
    storeId: runtimeStoreId,
    siteDomain: "leatherbag-3anqqbf8.myshopify.com",
  });
  assert.ok(runtimeProfile);

  const normalized = normalizeSeoEnqueue({
    ...enqueue,
    input: {
      ...enqueue.input,
      niche: runtimeProfile.niche,
      storeProfile: runtimeProfile,
    },
    execution: { ...enqueue.execution, storeId: runtimeStoreId },
  });

  assert.equal(normalized.input.storeProfile.profileId, "preaureum-handbags");
  assert.equal(normalized.input.storeProfile.storeId, runtimeStoreId);
  assert.equal(normalized.execution.storeId, runtimeStoreId);
});

test("V2 boundary rejects legacy semantic fields and image alt text", () => {
  assert.throws(() => parseSeoGenerationInput({ ...enqueue.input, title: "legacy title" }), /unrecognized/i);
  assert.throws(() => parseSeoGenerationInput({ ...enqueue.input,
    images: [{ ...enqueue.input.images[0], alt: "legacy alt" }] }), /unrecognized/i);
});

test("worker rejects persisted V1 jobs instead of resuming their checkpoints as V2", () => {
  const original = enqueue.execution.originalSnapshot;
  const valid = { ...enqueue, id: "job", storeId: "jeminise", source: "auto_seo", sourceIdentity: "123", original,
    inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "English", instructions: "legacy hidden" },
    status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob;
  assert.doesNotThrow(() => assertV2WorkerJob(normalizePersisted(valid)));
  assert.throws(() => assertV2WorkerJob({ ...valid, execution: undefined } as unknown as GptSeoJob), /INPUT_CONTRACT_UNSUPPORTED|invalid_type/i);
  assert.throws(() => assertV2WorkerJob({ ...valid, input: { ...valid.input, title: "legacy" } } as GptSeoJob), /INPUT_CONTRACT_UNSUPPORTED/);
});

test("worker rejects low-confidence product identity even when reviewRequired is false", async () => {
  const original = enqueue.execution.originalSnapshot;
  const job = normalizePersisted({ ...enqueue, id: "job", storeId: "jeminise", source: "auto_seo", sourceIdentity: "123", original,
    inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "English", instructions: "" },
    status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob);
  const repository = {
    checkpointReceipt: async () => null,
    readJob: async () => job,
    saveCheckpoint: async () => ({ jobId: job.id, status: "IN_PROGRESS" }),
  } as unknown as SeoWorkerRepository;
  const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined });
  const lease = { jobId: job.id, runId: "run", sessionId: "session", leaseId: "lease", leaseVersion: 1, expiresAt: 10 };
  const analysis = { physicalProductIdentity: "bedding", visualEntities: "pattern", sceneContext: "bedroom",
    identityCandidates: ["bedding"], excludedSceneEntities: ["pillow"], confidence: 0.59, reviewRequired: false,
    typography: { visibleTexts: [], styleSummary: "none" },
    shoppingContext: { targetAudience: [], suitableOccasions: [], useCases: [], buyerIntentKeywords: [] },
    evidence: [{ imageId: "image-1", observation: "A patterned bed covering" }] };
  await assert.rejects(workflow.analysis("token", lease, "request", analysis), (error: unknown) => {
    assert.ok(error instanceof SeoWorkerError);
    assert.equal(error.code, "PRODUCT_IDENTITY_AMBIGUOUS");
    assert.deepEqual(error.reasons, ["LOW_IDENTITY_CONFIDENCE"]);
    return true;
  });
  await assert.rejects(workflow.analysis("token", lease, "review", { ...analysis, confidence: 0.95, reviewRequired: true }), (error: unknown) => {
    assert.ok(error instanceof SeoWorkerError);
    assert.deepEqual(error.reasons, ["IDENTITY_REVIEW_REQUIRED"]);
    return true;
  });
  for (const [requestId, patch, reasons] of [
    ["unknown", { physicalProductIdentity: "unknown" }, ["UNKNOWN_PRODUCT_IDENTITY"]],
    ["missing-candidates", { identityCandidates: undefined }, ["MISSING_IDENTITY_CANDIDATES"]],
    ["invalid-confidence", { confidence: NaN }, ["INVALID_IDENTITY_CONFIDENCE"]],
  ] as const) {
    await assert.rejects(workflow.analysis("token", lease, requestId, { ...analysis, confidence: 0.95, ...patch }), (error: unknown) => {
      assert.ok(error instanceof SeoWorkerError);
      assert.deepEqual(error.reasons, reasons);
      return true;
    });
  }
  await assert.doesNotReject(workflow.analysis("token", lease, "grounded", { ...analysis, confidence: 0.6 }));
});

function normalizePersisted(job: GptSeoJob): GptSeoJob {
  const normalized = normalizeSeoEnqueue(job);
  return { ...job, ...normalized, storeId: normalized.execution.storeId, source: normalized.execution.source,
    sourceIdentity: normalized.execution.sourceIdentity, sourceRevision: normalized.execution.sourceRevision,
    original: normalized.execution.originalSnapshot };
}

test("automatic crawler classification is store scoped, durable and never enables classification for Auto SEO", async () => {
  for (const source of ["amazon", "auto_seo"] as const) {
    const original = { crawlerClassificationMode: "automatic", updatedAt: "v1", title: "UNTRUSTED_OLD_TITLE" };
    const job = normalizePersisted({ ...enqueue, execution: { ...enqueue.execution, source, originalSnapshot: original },
      id: "classification-job", storeId: "jeminise", source, sourceIdentity: "123", original,
      inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "English", instructions: "" },
      status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob);
    let saved: unknown;
    const repository = { checkpointReceipt: async () => null, readJob: async () => job,
      saveCheckpoint: async (_token: string, _lease: unknown, input: { payload: unknown }) => {
        saved = input.payload; return { jobId: job.id, status: "VALIDATING" };
      } } as unknown as SeoWorkerRepository;
    let catalogReads = 0;
    const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined, classificationCatalog: async storeId => {
      assert.equal(storeId, "jeminise"); catalogReads += 1;
      return { collections: [{ id: "gid://shopify/Collection/1", title: "Dragons", description: "" }], productTypes: ["Bedding"] };
    } });
    const lease = { jobId: job.id, runId: "run", sessionId: "session", leaseId: "lease", leaseVersion: 1, expiresAt: 10 };
    const context = await workflow.context("token", lease);
    assert.doesNotMatch(JSON.stringify(context), /UNTRUSTED_OLD_TITLE/);
    assert.equal(Boolean(context.classification), source === "amazon");
    const submission = { draft: { productTitle: "Dragon bedding" }, alts: {}, classification: {
      status: "ready", collectionId: "gid://shopify/Collection/1", productType: "bedding", reason: "Viewed bed covering with dragons",
      evidence: { imageIds: job.input.images.map(image => image.id), visualTheme: "Dragon", collectionTheme: "Dragons", alternatives: [] } } };
    await workflow.submit("token", lease, "submit", submission);
    assert.deepEqual(saved, source === "amazon" ? { ...submission, classification: { ...submission.classification, productType: "Bedding" } } : submission);
    if (source === "auto_seo") assert.equal(catalogReads, 0);
  }
});

test("automatic submission requires classification and preserves checkpoints until repaired", async () => {
  const original = { crawlerClassificationMode: "automatic" };
  const job = normalizePersisted({ ...enqueue, execution: { ...enqueue.execution, source: "amazon", originalSnapshot: original },
    id: "classification-offline", storeId: "jeminise", source: "amazon", sourceIdentity: "123", original,
    inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "English", instructions: "" },
    status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob);
  let saved: unknown;
  const repository = { checkpointReceipt: async () => null, readJob: async () => job,
    saveCheckpoint: async (_token: string, _lease: unknown, input: { payload: unknown }) => { saved = input.payload; return {}; },
  } as unknown as SeoWorkerRepository;
  let offline = false;
  const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined,
    classificationCatalog: async () => {
      if (offline) throw new Error("Unavailable");
      return { collections: [{ id: "collection-1", title: "Dragon", description: "" }], productTypes: ["Bedding"] };
    } });
  const lease = { jobId: job.id, runId: "run", sessionId: "session", leaseId: "lease", leaseVersion: 1, expiresAt: 10 };
  const draft = { draft: { productTitle: "Preserved SEO" }, alts: {} };
  await assert.rejects(workflow.submit("token", lease, "missing", draft), /CLASSIFICATION_REQUIRED/);
  await assert.rejects(workflow.submit("token", lease, "invalid", { ...draft, classification: { status: "ready" } }), /CLASSIFICATION_INVALID/);
  const classification = { status: "ready", collectionId: "collection-1", productType: "Bedding", reason: "Viewed dragon bedding",
    evidence: { imageIds: job.input.images.map(image => image.id), visualTheme: "Dragon", collectionTheme: "Dragon", alternatives: [] } };
  await assert.rejects(workflow.submit("token", lease, "missing-evidence", { ...draft, classification: { ...classification, evidence: undefined } }), /CLASSIFICATION_EVIDENCE_REQUIRED/);
  await assert.rejects(workflow.submit("token", lease, "no-type", { ...draft, classification: { ...classification, productType: undefined } }), /CLASSIFICATION_PRODUCT_TYPE_REQUIRED/);
  await assert.rejects(workflow.submit("token", lease, "uncertain", { ...draft, classification: { ...classification, status: "needs_review" } }), /CLASSIFICATION_UNRESOLVED/);
  await assert.rejects(workflow.submit("token", lease, "wrong-store", { ...draft, classification: { ...classification, collectionId: "other" } }), /CLASSIFICATION_COLLECTION_INVALID/);
  offline = true;
  assert.equal((await workflow.context("token", lease)).classification?.catalog, null);
  await assert.rejects(workflow.submit("token", lease, "offline", { ...draft, classification }), /CLASSIFICATION_CATALOG_UNAVAILABLE/);
  assert.equal(saved, undefined);
  offline = false;
  await workflow.submit("token", lease, "repaired", { ...draft, classification });
  assert.deepEqual(saved, { ...draft, classification });
});

test("default crawler size labels are a separate context, validated durable checkpoint and retryable repair", async () => {
  for (const profile of ["default", "preaurem", "jeminise"]) {
    const original = { crawlerProfileSlug: profile, crawlerSizeOptionsVersion: 1, title: "UNTRUSTED_TITLE",
      variants: [{ id: "stable-id", options: { Size: "1.5x1.5 ft (!!!)", Color: "PRIVATE_COLOR" } }] };
    const job = normalizePersisted({ ...enqueue, execution: { ...enqueue.execution, source: "amazon", originalSnapshot: original },
      id: "size-job", storeId: "jeminise", source: "amazon", sourceIdentity: "123", original,
      inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "English", instructions: "" },
      status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob);
    let saved: unknown;
    let replay: unknown = null;
    const repository = { checkpointReceipt: async () => replay, readJob: async () => job,
      saveCheckpoint: async (_token: string, _lease: unknown, input: { payload: unknown }) => { saved = input.payload; return { status: "VALIDATING" }; },
    } as unknown as SeoWorkerRepository;
    const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined });
    const lease = { jobId: job.id, runId: "run", sessionId: "session", leaseId: "lease", leaseVersion: 1, expiresAt: 10 };
    const context = await workflow.context("token", lease);
    assert.doesNotMatch(JSON.stringify(context), /UNTRUSTED_TITLE|PRIVATE_COLOR/);
    assert.deepEqual(Object.keys(context.input).sort(), ["images", "niche", "storeProfile"]);
    const draft = { draft: { productTitle: "Preserved SEO" }, alts: {} };
    if (profile !== "default") {
      assert.equal(context.sizeOptions, undefined);
      await workflow.submit("token", lease, "submit", { ...draft, sizeOptions: { version: 1, groups: [] } });
      assert.deepEqual(saved, draft);
      continue;
    }
    assert.ok(context.sizeOptions);
    await assert.rejects(workflow.submit("token", lease, "missing", draft), /SIZE_OPTIONS_REQUIRED/);
    assert.equal(saved, undefined);
    const group = context.sizeOptions.groups[0];
    const sizeOptions = { version: 1, groups: [{ groupId: group.groupId, label: group.label, reason: "Remove decoration",
      choices: [{ choiceId: group.choices[0].choiceId, label: "1.5x1.5 ft" }] }] };
    await workflow.submit("token", lease, "complete", { ...draft, sizeOptions });
    function readSaved(): unknown { return saved; }
    const stored = readSaved();
    assert.ok(stored && typeof stored === "object" && "sizeOptions" in stored && "draft" in stored);
    assert.deepEqual(stored.draft, draft.draft);
    assert.ok(stored.sizeOptions && typeof stored.sizeOptions === "object" && "sourceHash" in stored.sizeOptions);
    replay = { status: "VALIDATING", replay: true };
    assert.deepEqual(await workflow.submit("token", lease, "complete", { ...draft, sizeOptions }), replay);
  }
});
