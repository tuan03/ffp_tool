import assert from "node:assert/strict";
import test from "node:test";

import {
  amazonCrawlerRoutes,
  createAmazonCrawlerAgentReleaseLoader,
  createAmazonCrawlerCacheClearer,
  createAmazonCrawlerClientsLoader,
  createAmazonCrawlerCommandController,
  createAmazonCrawlerAdmissionGateController,
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
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs/job-1/summary", method: "GET" },
    { url: "http://127.0.0.1:8766/api/v1/crawl-jobs/job-1/summary", method: "GET" },
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
      { id: "client-a", displayName: "Máy Lợi", agentVersion: "5.0.0", status: "busy", isConnected: true, maxConcurrentInputs: 4, activeTasks: 2, lastSeenAt: "2026-09-22T10:00:00Z" },
      { id: "client-b", displayName: "Máy cũ", status: "offline", isConnected: false, maxConcurrentInputs: 4, activeTasks: 0, lastSeenAt: "2026-09-21T10:00:00Z" },
    ]),
  });
  const clients = await loadClients();
  assert.equal(clients.length, 2);
  assert.equal(clients[0]?.agentVersion, "5.0.0");
  assert.equal(clients[0]?.displayName, "Máy Lợi");
  assert.equal(clients[0]?.activeTasks, 2);
});

test("operator command controller submits idempotency ID and reads ordered timeline", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const controller = createAmazonCrawlerCommandController({
    engineUrl: "https://coordinator.test",
    fetchImplementation: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (init?.method === "POST") return jsonResponse({ commandId: "cmd-1" }, 202);
      return jsonResponse({ commands: [{ commandId: "cmd-1", sequence: 1, type: "PAUSE", status: "SUCCESS",
        events: [{ status: "ACKED", at: "2026-10-05T00:00:00Z", detail: {} }] }] });
    },
  });
  await controller.submit("agent/one", "PAUSE");
  const history = await controller.history("agent/one");
  assert.equal(requests[0]?.url, "https://coordinator.test/api/v1/clients/agent%2Fone/commands");
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.body ?? "", /"requestId":"[0-9a-f-]{36}"/);
  assert.equal(history[0]?.events[0]?.status, "ACKED");
});

test("global admission controller loads and changes only the crawler gate", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const controller = createAmazonCrawlerAdmissionGateController({
    engineUrl: "https://coordinator.test",
    fetchImplementation: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return jsonResponse({ state: init?.method === "POST" ? "STOPPED" : "OPEN", scope: "crawler", revision: 3,
        actor: "operator", reason: "planned maintenance", updatedAt: "2026-10-05T00:00:00Z" });
    },
  });
  assert.equal((await controller.load()).state, "OPEN");
  const stopped = await controller.setState("STOPPED", "planned maintenance");
  assert.equal(stopped.scope, "crawler");
  assert.equal(stopped.state, "STOPPED");
  assert.equal(requests[0]?.url, "https://coordinator.test/api/v1/admission-gate");
  assert.equal(requests[1]?.method, "POST");
  assert.match(requests[1]?.body ?? "", /"state":"STOPPED"/);
  assert.match(requests[1]?.body ?? "", /"reason":"planned maintenance"/);
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
  assert.equal(first.completedAsins?.length, 6);
  first.completedAsins?.push("B0NEW00001");
  assert.equal(second.completedAsins?.includes("B0NEW00001"), false);
});

test("module exports route and stable input serialization", () => {
  assert.equal(amazonCrawlerRoutes(
    async () => amazonCrawlerMockOutput,
    async () => ({ removedFiles: 0, removedBytes: 0 }),
    async () => [],
    async () => ({
      version: "5.1.0",
      downloadUrl: "https://github.com/tuan03/ffp_tool/releases/download/agent-v5.1.0/FFP-Amazon-Crawler-Setup.exe",
      checksumUrl: "https://github.com/tuan03/ffp_tool/releases/download/agent-v5.1.0/FFP-Amazon-Crawler-Setup.exe.sha256",
      releasePageUrl: "https://github.com/tuan03/ffp_tool/releases/tag/agent-v5.1.0",
      fileName: "FFP-Amazon-Crawler-Setup.exe",
      sizeBytes: 1,
      publishedAt: "2026-09-29T00:00:00Z",
    }),
  )[0]?.path, "amazon-crawler");
  assert.deepEqual(JSON.parse(serializeAmazonCrawlerInput(input)), input);
});

test("agent release loader returns the stable Windows installer and checksum", async () => {
  const loadRelease = createAmazonCrawlerAgentReleaseLoader({
    releaseApiUrl: "https://api.github.com/repos/tuan03/ffp_tool/releases/latest",
    fetchImplementation: async () => jsonResponse({
      tag_name: "agent-v5.1.0",
      html_url: "https://github.com/tuan03/ffp_tool/releases/tag/agent-v5.1.0",
      published_at: "2026-09-29T00:00:00Z",
      assets: [
        {
          name: "FFP-Amazon-Crawler-Setup.exe",
          browser_download_url: "https://github.com/tuan03/ffp_tool/releases/download/agent-v5.1.0/FFP-Amazon-Crawler-Setup.exe",
          size: 125_000_000,
        },
        {
          name: "FFP-Amazon-Crawler-Setup.exe.sha256",
          browser_download_url: "https://github.com/tuan03/ffp_tool/releases/download/agent-v5.1.0/FFP-Amazon-Crawler-Setup.exe.sha256",
          size: 100,
        },
      ],
    }),
  });

  const release = await loadRelease();
  assert.equal(release.version, "5.1.0");
  assert.equal(release.fileName, "FFP-Amazon-Crawler-Setup.exe");
  assert.equal(release.sizeBytes, 125_000_000);
});

test("agent release loader rejects missing or unsafe installer assets", async () => {
  const releaseApiUrl = "https://api.github.com/repos/tuan03/ffp_tool/releases/latest";
  const missingInstaller = createAmazonCrawlerAgentReleaseLoader({
    releaseApiUrl,
    fetchImplementation: async () => jsonResponse({
      tag_name: "agent-v5.1.0",
      html_url: "https://github.com/tuan03/ffp_tool/releases/tag/agent-v5.1.0",
      published_at: "2026-09-29T00:00:00Z",
      assets: [],
    }),
  });
  await assert.rejects(missingInstaller(), { code: "AGENT_INSTALLER_NOT_FOUND" });

  const unsafeInstaller = createAmazonCrawlerAgentReleaseLoader({
    releaseApiUrl,
    fetchImplementation: async () => jsonResponse({
      tag_name: "agent-v5.1.0",
      html_url: "https://github.com/tuan03/ffp_tool/releases/tag/agent-v5.1.0",
      published_at: "2026-09-29T00:00:00Z",
      assets: [
        { name: "FFP-Amazon-Crawler-Setup.exe", browser_download_url: "https://example.com/agent.exe", size: 10 },
        { name: "FFP-Amazon-Crawler-Setup.exe.sha256", browser_download_url: "https://example.com/agent.sha256", size: 10 },
      ],
    }),
  });
  await assert.rejects(unsafeInstaller(), { code: "UNSAFE_AGENT_RELEASE_URL" });
});

test("agent release loader reports GitHub request failures without engine errors", async () => {
  const loadRelease = createAmazonCrawlerAgentReleaseLoader({
    releaseApiUrl: "https://api.github.com/repos/tuan03/ffp_tool/releases/latest",
    fetchImplementation: async () => jsonResponse({ message: "rate limited" }, 403),
  });

  await assert.rejects(loadRelease(), {
    code: "AGENT_RELEASE_REQUEST_FAILED",
    status: 403,
  });
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

test("cache maintenance targets one ASIN or temporary data through separate endpoints", async () => {
  const requests: string[] = [];
  const jobs = createAmazonCrawlerJobController({
    engineUrl: "http://coordinator.test",
    fetchImplementation: async (request, init) => {
      assert.equal(init?.method, "DELETE");
      requests.push(String(request));
      return jsonResponse({ removedFiles: 2, removedBytes: 100, requestedClients: 1, respondedClients: 1, failedClients: 0, discardedJobs: 1 });
    },
  });

  assert.deepEqual(await jobs.invalidateProductCache("B012345678", "10001"), {
    removedFiles: 2, removedBytes: 100, requestedClients: 1, respondedClients: 1, failedClients: 0, discardedJobs: 1,
  });
  assert.deepEqual(await jobs.clearTemporaryData(), {
    removedFiles: 2, removedBytes: 100, requestedClients: 1, respondedClients: 1, failedClients: 0, discardedJobs: 1,
  });
  assert.deepEqual(requests, [
    "http://coordinator.test/api/v1/clients/cache/products/B012345678?amazonZip=10001",
    "http://coordinator.test/api/v1/clients/temporary-data",
  ]);
});

test("Shopify sync retry polls summary and loads each product detail once", async () => {
  const productsSeen: string[][] = [];
  let snapshotCount = 0;
  let detailRequests = 0;
  const product = amazonCrawlerMockOutput.products[0];
  assert.ok(product);
  const retrySyncs = createAmazonCrawlerSyncRetrier({
    engineUrl: "http://coordinator.test",
    pollIntervalMs: 0,
    fetchImplementation: async (request, init) => {
      const url = String(request);
      if (init?.method === "POST") return jsonResponse({ retried: 1 });
      if (url.endsWith("/products")) {
        return jsonResponse({ products: [{ id: "item-1", productId: product.id }], nextCursor: null });
      }
      if (url.endsWith("/products/item-1")) {
        detailRequests += 1;
        return jsonResponse({ ...product, variants: undefined });
      }
      if (url.includes("/products/item-1/variants?cursor=")) {
        return jsonResponse({ variants: product.variants, nextCursor: null });
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
  assert.equal(productsSeen.length, 1);
  assert.equal(detailRequests, 1);
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
      if (init?.method === "DELETE" && url.endsWith("/review-1")) return jsonResponse({ deleted: true });
      if (init?.method === "DELETE") return jsonResponse({ deleted: 1, skipped: 0 });
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
  assert.deepEqual(await client.delete("review-1"), { deleted: true });
  assert.deepEqual(await client.deleteAll(), { deleted: 1, skipped: 0 });
  assert.deepEqual(requests.slice(1).map(({ url, method }) => ({
    path: new URL(url).pathname,
    method,
  })), [
    { path: "/api/v1/product-reviews/review-1/decision", method: "POST" },
    { path: "/api/v1/product-reviews/review-1/sync", method: "POST" },
    { path: "/api/v1/product-reviews/sync-approved", method: "POST" },
    { path: "/api/v1/product-reviews/review-1", method: "DELETE" },
    { path: "/api/v1/product-reviews", method: "DELETE" },
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

test("mock data includes Preaurem canonical sizes with preserved prices", () => {
  const product = amazonCrawlerMockOutput.products.find((candidate) => candidate.id === "mock-preaurem");

  assert.ok(product);
  assert.deepEqual(
    product.variants.map((variant) => variant.options.Size),
    [
      'Medium (11.4" W × 7.9" H × 4.7" D)',
      'Large (13.8" W × 10.6" H × 5.5" D)',
      'X-Large (16.1" W × 13.4" H × 7.5" D)',
      '4X-Large (16.1" W × 13.4" H × 7.5" D)',
    ],
  );
  assert.deepEqual(product.variants.map((variant) => variant.price?.amount), [23, 24, 25, 26]);
  assert.equal(product.variants.some((variant) => /small/i.test(variant.options.Size ?? "")), false);
});

test("job loader loads job snapshot, products and results from coordinator", async () => {
  let detailRequests = 0;
  const loader = createAmazonCrawlerJobLoader({
    engineUrl: "http://engine.test",
    fetchImplementation: async (_request) => {
      const url = String(_request);
      if (url.endsWith("/api/v1/crawl-jobs?limit=5")) {
        return jsonResponse([{ id: "job-abc", status: "completed", settings: DEFAULT_AMAZON_CRAWLER_SETTINGS }]);
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc/summary")) {
        return jsonResponse({
          id: "job-abc",
          status: "completed",
          progress: { phase: "shopify", completed: 1, total: 1 },
          settings: DEFAULT_AMAZON_CRAWLER_SETTINGS,
        });
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc/products")) {
        return jsonResponse({
          jobId: "job-abc", nextCursor: null,
          products: amazonCrawlerMockOutput.products.map((product, index) => ({ id: `item-${index}`, productId: product.id })),
        });
      }
      if (url.endsWith("/api/v1/crawl-jobs/job-abc/metadata")) {
        return jsonResponse({ settings: DEFAULT_AMAZON_CRAWLER_SETTINGS });
      }
      const variantMatch = url.match(/\/products\/item-(\d+)\/variants\?cursor=0$/);
      if (variantMatch) {
        return jsonResponse({ variants: amazonCrawlerMockOutput.products[Number(variantMatch[1])]?.variants ?? [], nextCursor: null });
      }
      const detailMatch = url.match(/\/products\/item-(\d+)$/);
      if (detailMatch) {
        detailRequests += 1;
        return jsonResponse({ ...amazonCrawlerMockOutput.products[Number(detailMatch[1])], variants: undefined });
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
  await loader.loadJob("job-abc");
  assert.equal(detailRequests, 0);

  const recent = await loader.listRecentJobs(5);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.id, "job-abc");
});

test("mock runner and request serialization preserve configurable timeout budgets", async () => {
  const timeoutInput = { ...input, dnsTimeoutSeconds: 3, connectTimeoutSeconds: 5, childTimeoutSeconds: 60, asinTimeoutSeconds: 120, jobTimeoutSeconds: 360 };
  const output = await getAmazonCrawlerRunner("mock", "http://unused.test")({ input: timeoutInput });
  assert.equal(output.settings.dnsTimeoutSeconds, 3);
  assert.equal(output.settings.connectTimeoutSeconds, 5);
  assert.equal(output.settings.childTimeoutSeconds, 60);
  assert.equal(output.settings.asinTimeoutSeconds, 120);
  assert.equal(output.settings.jobTimeoutSeconds, 360);
  assert.equal(JSON.parse(serializeAmazonCrawlerInput(timeoutInput)).jobTimeoutSeconds, 360);
});

test("running job loader pages product summaries and reuses loaded details", async () => {
  const products = amazonCrawlerMockOutput.products.slice(0, 2);
  assert.equal(products.length, 2);
  let detailRequests = 0;
  let metadataRequests = 0;
  let productStatus = "received";
  const loader = createAmazonCrawlerJobLoader({
    engineUrl: "http://engine.test",
    fetchImplementation: async (request) => {
      const url = String(request);
      if (url.endsWith("/job-paged/summary")) {
        return jsonResponse({ id: "job-paged", status: "running", progress: { completed: 0, total: 1 } });
      }
      if (url.endsWith("/job-paged/metadata")) {
        metadataRequests += 1;
        return jsonResponse({ settings: { ...DEFAULT_AMAZON_CRAWLER_SETTINGS, amazonZip: "90210", priceAddition: 7 } });
      }
      if (url.endsWith("/job-paged/products")) {
        return jsonResponse({ products: [{ id: "item-1", status: productStatus }], nextCursor: "item-1" });
      }
      if (url.endsWith("/job-paged/products?cursor=item-1")) {
        return jsonResponse({ products: [{ id: "item-2", status: productStatus }], nextCursor: null });
      }
      const variantMatch = url.match(/\/products\/item-(\d+)\/variants\?cursor=(\d+)$/);
      if (variantMatch) {
        const variants = products[Number(variantMatch[1]) - 1]?.variants ?? [];
        const cursor = Number(variantMatch[2]);
        return jsonResponse({
          variants: variants.slice(cursor, cursor + 2), nextCursor: cursor + 2 < variants.length ? cursor + 2 : null,
        });
      }
      const detailMatch = url.match(/\/products\/item-(\d+)$/);
      if (detailMatch) {
        detailRequests += 1;
        return jsonResponse({ ...products[Number(detailMatch[1]) - 1], title: productStatus, variants: undefined });
      }
      return jsonResponse({}, 404);
    },
  });
  const first = await loader.loadJob("job-paged");
  const second = await loader.loadJob("job-paged");
  assert.equal(first?.products.length, 2);
  assert.equal(second?.products.length, 2);
  assert.equal(detailRequests, 2);
  assert.equal(metadataRequests, 1);
  assert.equal(second?.settings?.amazonZip, "90210");
  assert.equal(second?.settings?.priceAddition, 7);
  assert.deepEqual(second?.products[0]?.variants, products[0]?.variants);
  productStatus = "seo";
  const updated = await loader.loadJob("job-paged");
  assert.equal(detailRequests, 4);
  assert.equal(updated?.products[0]?.title, "seo");
});
