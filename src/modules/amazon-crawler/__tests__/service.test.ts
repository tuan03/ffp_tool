import assert from "node:assert/strict";
import test from "node:test";

import {
  amazonCrawlerRoutes,
  createAmazonCrawlerCacheClearer,
  createAmazonCrawlerClientsLoader,
  createAmazonCrawlerJobController,
  createAmazonCrawlerJobLoader,
  createAmazonCrawlerReviewClient,
  createAmazonCrawlerRunner,
  createAmazonCrawlerSyncRetrier,
  createImageProcessingProfileManager,
  DEFAULT_AMAZON_CRAWLER_SETTINGS,
  getAmazonCrawlerRunner,
  serializeAmazonCrawlerInput,
} from "..";
import { amazonCrawlerMockOutput } from "../mocks/data";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const input = { ...DEFAULT_AMAZON_CRAWLER_SETTINGS, urls: ["B0MOCK0001"] };

test("default settings match the four-proxy concurrency profile", () => {
  assert.deepEqual(
    {
      productThreads: DEFAULT_AMAZON_CRAWLER_SETTINGS.productThreads,
      variantThreads: DEFAULT_AMAZON_CRAWLER_SETTINGS.variantThreads,
      urllibThreads: DEFAULT_AMAZON_CRAWLER_SETTINGS.urllibThreads,
      browserProfiles: DEFAULT_AMAZON_CRAWLER_SETTINGS.browserProfiles,
      browserTabs: DEFAULT_AMAZON_CRAWLER_SETTINGS.browserTabs,
    },
    {
      productThreads: 3,
      variantThreads: 8,
      urllibThreads: 12,
      browserProfiles: 4,
      browserTabs: 2,
    },
  );
});

test("image profile manager lists, saves, uploads logo, previews and deletes profiles", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const profile = {
    slug: "default", name: "Default", enabled: false, revision: "revision-1", hasLogo: true,
    randomPixels: 100, pixelDelta: 3, jpegQuality: 92,
    output: { width: 1500, height: 1500, fit: "contain" as const, upscale: true, background: "#ffffff" },
    logo: { enabled: false, width: 120, height: 60, maxPercent: 15, percentBasis: "width" as const, padding: 0, position: "bottom-right" as const, opacity: 1 },
  };
  const manager = createImageProcessingProfileManager({
    engineUrl: "http://127.0.0.1:8766",
    fetchImplementation: async (request, init) => {
      const url = String(request);
      requests.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/preview")) return jsonResponse({ dataUrl: "data:image/jpeg;base64,cHJldmlldw==" });
      if ((init?.method ?? "GET") === "DELETE") return jsonResponse({ status: "deleted" });
      if (url.endsWith("/image-profiles")) return jsonResponse({ profiles: [profile] });
      return jsonResponse(profile);
    },
  });

  const profiles = await manager.list();
  assert.equal(profiles.length, 1);
  assert.equal(
    profiles[0]?.logoUrl,
    "http://127.0.0.1:8766/api/v1/image-profiles/default/logo?revision=revision-1",
  );
  await manager.save("default", profile);
  await manager.uploadLogo("default", "data:image/png;base64,bG9nbw==");
  assert.match(await manager.preview("default", profile, "data:image/png;base64,aW1hZ2U="), /^data:image\/jpeg/);
  await manager.delete("brand");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "POST", "POST", "DELETE"]);
});

test("real runner serializes input, polls progress, and returns partial output", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const progressUpdates: Array<{ message: string; itemMessage?: string; variantCompleted?: number }> = [];
  let pollCount = 0;
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://127.0.0.1:8766/",
    pollIntervalMs: 0,
    fetchImplementation: async (request, init) => {
      const url = String(request);
      requests.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/clients")) {
        return jsonResponse([{ id: "client-a", displayName: "Client A", status: "online", isConnected: true, maxConcurrentInputs: 4, activeTasks: 0 }]);
      }
      if (init?.method === "POST") return jsonResponse({ id: "job-1", status: "queued" }, 202);
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({
          id: "job-1",
          status: "running",
          progress: {
            phase: "variant_matrix", completed: 1, total: 2, message: "Đang xử lý variant",
            items: [{
              source: "B0MOCK0001", asin: "B0MOCK0001", phase: "variant_matrix", status: "running",
              message: "Đang cào variant 3/14", variantCompleted: 3, variantTotal: 14,
              currentAsin: "B0CHILD003", currentOptions: { Size: "Large" }, activeVariants: [],
            }],
          },
          taskCounts: { running: 1, completed: 1 },
        });
      }
      if (url.endsWith("/results")) return jsonResponse({ ...amazonCrawlerMockOutput, jobId: "job-1", status: "partial" });
      return jsonResponse({ id: "job-1", status: "partial", progress: { completed: 2, total: 2 }, taskCounts: { completed: 1, failed: 1 } });
    },
  });

  const output = await run({
    input,
    onProgress: (progress) => progressUpdates.push({
      message: progress.message,
      itemMessage: progress.items?.[0]?.message,
      variantCompleted: progress.items?.[0]?.variantCompleted,
    }),
  });

  assert.equal(output.status, "partial");
  assert.deepEqual(progressUpdates, [
    { message: "Đang xử lý variant", itemMessage: "Đang cào variant 3/14", variantCompleted: 3 },
    { message: "Đã xử lý 2/2 link.", itemMessage: undefined, variantCompleted: undefined },
  ]);
  assert.deepEqual(requests, [
    { url: "http://127.0.0.1:8766/api/v1/clients", method: "GET" },
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs", method: "POST" },
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs/job-1", method: "GET" },
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs/job-1", method: "GET" },
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs/job-1/results", method: "GET" },
  ]);
});

test("runner posts coordinator cancellation when polling is aborted", async () => {
  const controller = new AbortController();
  let cancelCalled = false;
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    pollIntervalMs: 10_000,
    fetchImplementation: async (_request, init) => {
      const url = String(_request);
      if (url.endsWith("/clients")) return jsonResponse([{ id: "client-a", displayName: "A", status: "online", isConnected: true, maxConcurrentInputs: 1, activeTasks: 0 }]);
      if (url.endsWith("/cancel")) {
        cancelCalled = true;
        return jsonResponse({ jobId: "job-cancel", status: "cancelled" });
      }
      if (init?.method === "POST") return jsonResponse({ id: "job-cancel" }, 202);
      controller.abort();
      return jsonResponse({
        id: "job-cancel",
        status: "running",
        progress: { completed: 0, total: 1 },
        taskCounts: { running: 1 },
      });
    },
  });

  await assert.rejects(run({ input, signal: controller.signal }), { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelCalled, true);
});

test("runner waits for coordinator cancellation confirmation before reporting an abort", async () => {
  const controller = new AbortController();
  let releaseCancellation = (): void => undefined;
  let runSettled = false;
  const cancellationGate = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    pollIntervalMs: 10_000,
    fetchImplementation: async (_request, init) => {
      const url = String(_request);
      if (url.endsWith("/clients")) return jsonResponse([{ id: "client-a", displayName: "A", status: "online", isConnected: true, maxConcurrentInputs: 1, activeTasks: 0 }]);
      if (url.endsWith("/cancel")) {
        await cancellationGate;
        return jsonResponse({ jobId: "job-cancel", status: "cancelled" });
      }
      if (init?.method === "POST") return jsonResponse({ id: "job-cancel" }, 202);
      controller.abort();
      return jsonResponse({
        id: "job-cancel",
        status: "running",
        progress: { completed: 0, total: 1 },
        taskCounts: { running: 1 },
      });
    },
  });

  const runPromise = run({ input, signal: controller.signal }).finally(() => {
    runSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runSettled, false);
  releaseCancellation();
  await assert.rejects(runPromise, { name: "AbortError" });
});

test("runner reports when coordinator cannot confirm cancellation", async () => {
  const controller = new AbortController();
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    pollIntervalMs: 10_000,
    fetchImplementation: async (_request, init) => {
      const url = String(_request);
      if (url.endsWith("/clients")) return jsonResponse([{ id: "client-a", displayName: "A", status: "online", isConnected: true, maxConcurrentInputs: 1, activeTasks: 0 }]);
      if (url.endsWith("/cancel")) return jsonResponse({ detail: "Coordinator unavailable" }, 503);
      if (init?.method === "POST") return jsonResponse({ id: "job-cancel" }, 202);
      controller.abort();
      return jsonResponse({
        id: "job-cancel",
        status: "running",
        progress: { completed: 0, total: 1 },
        taskCounts: { running: 1 },
      });
    },
  });

  await assert.rejects(run({ input, signal: controller.signal }), {
    code: "CANCEL_CONFIRMATION_FAILED",
  });
});

test("runner cancels the server job when stop is pressed while job creation is in flight", async () => {
  const controller = new AbortController();
  let releaseCreation = (): void => undefined;
  let cancelCalled = false;
  const creationGate = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    fetchImplementation: async (_request, init) => {
      const url = String(_request);
      if (url.endsWith("/clients")) return jsonResponse([{ id: "client-a", displayName: "A", status: "online", isConnected: true, maxConcurrentInputs: 1, activeTasks: 0 }]);
      if (url.endsWith("/cancel")) {
        cancelCalled = true;
        return jsonResponse({ jobId: "job-create-race", status: "cancelled" });
      }
      if (init?.method === "POST") {
        await creationGate;
        return jsonResponse({ id: "job-create-race" }, 202);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const runPromise = run({ input, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  releaseCreation();

  await assert.rejects(runPromise, { name: "AbortError" });
  assert.equal(cancelCalled, true);
});

test("runner refuses to create a job when no crawler client is available", async () => {
  let createCalled = false;
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://coordinator.test",
    fetchImplementation: async (_request, init) => {
      if (init?.method === "POST") createCalled = true;
      return jsonResponse([{ id: "client-a", displayName: "A", status: "offline", isConnected: false, maxConcurrentInputs: 4, activeTasks: 0 }]);
    },
  });
  await assert.rejects(run({ input }), { code: "NO_CLIENT_AVAILABLE" });
  assert.equal(createCalled, false);
});

test("client loader returns coordinator client capacity and status", async () => {
  const loadClients = createAmazonCrawlerClientsLoader({
    engineUrl: "http://coordinator.test/",
    fetchImplementation: async () => jsonResponse([
      { id: "client-a", displayName: "Máy Lợi", status: "busy", isConnected: true, maxConcurrentInputs: 4, activeTasks: 2, lastSeenAt: "2026-09-22T10:00:00Z" },
      { id: "client-b", displayName: "Máy cũ", status: "offline", isConnected: false, maxConcurrentInputs: 4, activeTasks: 0, lastSeenAt: "2026-09-21T10:00:00Z" },
    ]),
  });
  const clients = await loadClients();
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.displayName, "Máy Lợi");
  assert.equal(clients[0]?.activeTasks, 2);
});

test("runner reports an offline coordinator with a stable error code", async () => {
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    fetchImplementation: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(run({ input }), { code: "COORDINATOR_OFFLINE" });
});

test("mock runtime returns fresh contract data", async () => {
  const run = getAmazonCrawlerRunner("mock", "http://unused.test");
  const first = await run({ input });
  const second = await run({ input });
  const firstProduct = first.products[0];
  const firstVariant = firstProduct?.variants[0];
  const originalVariantCount = second.products[0]?.variants.length;
  assert.ok(firstProduct);
  assert.ok(firstVariant);
  firstProduct.variants.push(firstVariant);
  assert.equal(second.products[0]?.variants.length, originalVariantCount);
  assert.notEqual(firstProduct.variants.length, second.products[0]?.variants.length);
});

test("module exports route and stable input serialization", () => {
  assert.equal(amazonCrawlerRoutes(async () => amazonCrawlerMockOutput, async () => ({ removedFiles: 0, removedBytes: 0 }), async () => [])[0]?.path, "amazon-crawler");
  assert.deepEqual(JSON.parse(serializeAmazonCrawlerInput(input)), input);
});

test("cache clearer sends DELETE and validates the engine response", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const clearCache = createAmazonCrawlerCacheClearer({
    engineUrl: "http://engine.test/",
    fetchImplementation: async (request, init) => {
      requests.push({ url: String(request), method: init?.method ?? "GET" });
      return jsonResponse({ removedFiles: 3, removedBytes: 2048 });
    },
  });
  assert.deepEqual(await clearCache(), { removedFiles: 3, removedBytes: 2048 });
  assert.deepEqual(requests, [{ url: "http://engine.test/api/v1/clients/cache", method: "DELETE" }]);
});

test("job controller lists, cancels, replaces and deletes coordinator jobs", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const snapshot = (jobId: string, status = "running") => ({
    id: jobId,
    status,
    inputs: ["B0MOCK0001"],
    settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
    progress: { phase: "product", completed: 0, total: 1, message: "Running" },
    createdAt: "2026-09-24T00:00:00Z",
    startedAt: "2026-09-24T00:00:01Z",
    completedAt: null,
    replacementOfJobId: null,
    cancellation: {
      id: status === "cancelling" ? "cancel-1" : null,
      requestedAt: status === "cancelling" ? "2026-09-24T00:00:02Z" : null,
      pendingAgents: [],
      pendingPipeline: [],
      pendingPipelineItems: 0,
      isExecutionConfirmed: status !== "cancelling",
    },
  });
  const jobs = createAmazonCrawlerJobController({
    engineUrl: "http://coordinator.test",
    fetchImplementation: async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/replace")) {
        return jsonResponse({ replacementJob: snapshot("job-2") }, 202);
      }
      if (url.endsWith("/cancel")) return jsonResponse(snapshot("job-1", "cancelling"), 202);
      if (url.includes("?limit=")) return jsonResponse([snapshot("job-1")]);
      return jsonResponse(snapshot("job-1"));
    },
  });

  assert.equal((await jobs.list())[0]?.jobId, "job-1");
  assert.equal((await jobs.cancel("job-1")).status, "cancelling");
  assert.equal((await jobs.replace("job-1", input)).jobId, "job-2");
  await jobs.delete("job-1");
  assert.equal(requests.at(-1)?.method, "DELETE");
});

test("Shopify sync retry resumes polling and returns the refreshed job output", async () => {
  const productsSeen: string[][] = [];
  let snapshotCount = 0;
  const retrySyncs = createAmazonCrawlerSyncRetrier({
    engineUrl: "http://coordinator.test",
    pollIntervalMs: 0,
    fetchImplementation: async (request, init) => {
      const url = String(request);
      if (init?.method === "POST") return jsonResponse({ retried: 1 });
      if (url.endsWith("/products")) {
        return jsonResponse({ products: [{ ...amazonCrawlerMockOutput.products[0], pipeline: {
          status: snapshotCount > 1 ? "completed" : "syncing",
          normalization: { status: "completed", assetsNormalized: 0 },
          seo: { status: "completed", engine: "heuristic" },
          shopify: { attempts: 2 },
        } }] });
      }
      if (url.endsWith("/results")) {
        return jsonResponse({ ...amazonCrawlerMockOutput, jobId: "job-retry", status: "completed" });
      }
      snapshotCount += 1;
      return jsonResponse({
        id: "job-retry",
        status: snapshotCount > 1 ? "completed" : "running",
        progress: { phase: "shopify", completed: snapshotCount > 1 ? 1 : 0, total: 1 },
      });
    },
  });

  const retried = await retrySyncs("job-retry", {
    onProducts: (products) => productsSeen.push(products.map((product) => product.id)),
  });

  assert.equal(retried.retried, 1);
  assert.equal(retried.output?.status, "completed");
  assert.equal(productsSeen.length, 2);
});

test("review client keeps approval separate from explicit Shopify sync", async () => {
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  const product = amazonCrawlerMockOutput.products[0];
  assert.ok(product);
  const review = {
    id: "review-1",
    jobId: "job-1",
    sourceKey: "amazon:B0MOCK0001:none:none",
    storeId: "capozen",
    decision: "pending",
    syncStatus: "idle",
    version: 1,
    target: { collectionIds: ["gid://shopify/Collection/1"], productType: "Rug", priceAddition: 2, discountPercent: 10 },
    product,
  };
  const client = createAmazonCrawlerReviewClient({
    engineUrl: "http://coordinator.test",
    fetchImplementation: async (request, init) => {
      const url = String(request);
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
      requests.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith("/sync-approved")) return jsonResponse({ queued: 1, itemIds: ["review-1"] });
      if (url.endsWith("/decision")) {
        return jsonResponse({ ...review, decision: "approved", version: 2 });
      }
      if (url.endsWith("/sync")) {
        return jsonResponse({ ...review, decision: "approved", syncStatus: "queued", version: 2 });
      }
      return jsonResponse({ items: [review] });
    },
  });

  assert.equal((await client.list())[0]?.decision, "pending");
  const approved = await client.decide("review-1", 1, "approved");
  assert.equal(approved.syncStatus, "idle");
  assert.equal((requests.at(-1)?.body as { decision?: string }).decision, "approved");
  const queued = await client.sync("review-1");
  assert.equal(queued.syncStatus, "queued");
  assert.deepEqual(await client.syncAllApproved(), { queued: 1, itemIds: ["review-1"] });
  assert.deepEqual(requests.slice(1).map(({ url, method }) => ({
    path: new URL(url).pathname,
    method,
  })), [
    { path: "/api/v1/product-reviews/review-1/decision", method: "POST" },
    { path: "/api/v1/product-reviews/review-1/sync", method: "POST" },
    { path: "/api/v1/product-reviews/sync-approved", method: "POST" },
  ]);
});

test("mock Customize contract omits raw and duplicate fields while exposing pricing migration", () => {
  const product = amazonCrawlerMockOutput.products.find((candidate) => candidate.customization !== null);
  assert.ok(product?.customization);
  assert.equal(product.customization.optionGroups.some((group) => group.id === "gift-box"), false);
  assert.equal(Object.hasOwn(product, "customizationRaw"), false);
  assert.equal(Object.hasOwn(product.customization, "controls"), false);
  assert.equal(Object.hasOwn(product.customization, "rules"), false);
  assert.equal(product.customization.pricing.mode, "product_variants");
  assert.equal(product.customization.pricing.paidOptionGroups[0]?.options[1]?.price.amount, 5);
});

test("job loader loads job snapshot, products and results from coordinator", async () => {
  const loader = createAmazonCrawlerJobLoader({
    engineUrl: "http://engine.test",
    fetchImplementation: async (_request) => {
      const url = String(_request);
      if (url.endsWith("/api/v1/crawl-jobs?limit=5")) {
        return jsonResponse([{ id: "job-abc", status: "completed", settings: DEFAULT_AMAZON_CRAWLER_SETTINGS }]);
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc")) {
        return jsonResponse({
          id: "job-abc",
          status: "completed",
          progress: { phase: "shopify", completed: 1, total: 1 },
          settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
        });
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc/products")) {
        return jsonResponse({ jobId: "job-abc", products: amazonCrawlerMockOutput.products });
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc/results")) {
        return jsonResponse({ ...amazonCrawlerMockOutput, jobId: "job-abc" });
      }
      return jsonResponse({}, 404);
    },
  });

  const hydrated = await loader.loadJob();
  assert.ok(hydrated);
  assert.equal(hydrated.jobId, "job-abc");
  assert.equal(hydrated.status, "completed");
  assert.equal(hydrated.products.length, amazonCrawlerMockOutput.products.length);
  assert.equal(hydrated.output?.jobId, "job-abc");

  const recent = await loader.listRecentJobs(5);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.id, "job-abc");
});
