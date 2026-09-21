import assert from "node:assert/strict";
import test from "node:test";

import {
  amazonCrawlerRoutes,
  createAmazonCrawlerCacheClearer,
  createAmazonCrawlerRunner,
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

test("real runner serializes input, polls progress, and returns partial output", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const progressMessages: string[] = [];
  let pollCount = 0;
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://127.0.0.1:8765/",
    pollIntervalMs: 0,
    fetchImplementation: async (request, init) => {
      const url = String(request);
      requests.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") return jsonResponse({ jobId: "job-1" }, 202);
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({
          jobId: "job-1",
          status: "running",
          progress: { phase: "variant_matrix", completed: 1, total: 2, message: "matrix" },
          result: null,
          error: null,
        });
      }
      return jsonResponse({
        jobId: "job-1",
        status: "partial",
        progress: { phase: "export", completed: 1, total: 1, message: "done" },
        result: { ...amazonCrawlerMockOutput, status: "partial" },
        error: null,
      });
    },
  });

  const output = await run({ input, onProgress: (progress) => progressMessages.push(progress.message) });

  assert.equal(output.status, "partial");
  assert.deepEqual(progressMessages, ["matrix", "done"]);
  assert.deepEqual(requests, [
    { url: "http://127.0.0.1:8765/api/amazon-crawler/jobs", method: "POST" },
    { url: "http://127.0.0.1:8765/api/amazon-crawler/jobs/job-1", method: "GET" },
    { url: "http://127.0.0.1:8765/api/amazon-crawler/jobs/job-1", method: "GET" },
  ]);
});

test("runner sends DELETE when polling is cancelled", async () => {
  const controller = new AbortController();
  let deleteCalled = false;
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    pollIntervalMs: 10_000,
    fetchImplementation: async (_request, init) => {
      if (init?.method === "POST") return jsonResponse({ jobId: "job-cancel" }, 202);
      if (init?.method === "DELETE") {
        deleteCalled = true;
        return jsonResponse({ jobId: "job-cancel", status: "cancelled" });
      }
      controller.abort();
      return jsonResponse({
        jobId: "job-cancel",
        status: "running",
        progress: { phase: "product", completed: 0, total: 1, message: "running" },
        result: null,
        error: null,
      });
    },
  });

  await assert.rejects(run({ input, signal: controller.signal }), { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deleteCalled, true);
});

test("runner reports an offline engine with a stable error code", async () => {
  const run = createAmazonCrawlerRunner({
    engineUrl: "http://engine.test",
    fetchImplementation: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(run({ input }), { code: "ENGINE_OFFLINE" });
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
  assert.equal(amazonCrawlerRoutes(async () => amazonCrawlerMockOutput, async () => ({ removedFiles: 0, removedBytes: 0 }))[0]?.path, "amazon-crawler");
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
  assert.deepEqual(requests, [{ url: "http://engine.test/api/amazon-crawler/cache", method: "DELETE" }]);
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
