import assert from "node:assert/strict";
import test from "node:test";

import { amazonCrawlerMockOutput } from "../mocks/data";
import type { AmazonCrawlerProgress, AmazonCrawlerRunner } from "../types";
import {
  abortCrawlerJob,
  clearCrawlerSession,
  getCrawlerSessionState,
  hydrateCrawlerSessionFromJob,
  resetCrawlerOutput,
  resetCrawlerSettings,
  selectCrawlerProduct,
  setCrawlerActiveTab,
  setCrawlerSelectedMediaUrl,
  setCrawlerUrlText,
  startCrawlerJob,
  subscribeCrawlerSession,
  toggleCrawlerAdvancedOpen,
  toggleCrawlerBatchJsonOpen,
  updateCrawlerSetting,
} from "../ui/crawler-session";

test("crawler session tracks urlText and setting updates", () => {
  clearCrawlerSession();
  assert.equal(getCrawlerSessionState().urlText, "");

  setCrawlerUrlText("B001234567\nhttps://amazon.com/dp/B009876543");
  assert.equal(getCrawlerSessionState().urlText, "B001234567\nhttps://amazon.com/dp/B009876543");

  updateCrawlerSetting("productThreads", 8);
  assert.equal(getCrawlerSessionState().settings.productThreads, 8);

  toggleCrawlerAdvancedOpen();
  assert.equal(getCrawlerSessionState().isAdvancedOpen, true);
  toggleCrawlerAdvancedOpen();
  assert.equal(getCrawlerSessionState().isAdvancedOpen, false);
});

test("new crawl migrates the old default ZIP to 90001", async () => {
  clearCrawlerSession();
  updateCrawlerSetting("amazonZip", "10001");
  const fakeRunner: AmazonCrawlerRunner = async ({ input }) => {
    assert.equal(input.amazonZip, "90001");
    return amazonCrawlerMockOutput;
  };
  await startCrawlerJob({ runAmazonCrawler: fakeRunner, urls: ["B012345678"] });
  assert.equal(getCrawlerSessionState().settings.amazonZip, "90001");
});
test("crawler session subscription notifies listeners on state changes", () => {
  clearCrawlerSession();
  let notificationCount = 0;
  const unsubscribe = subscribeCrawlerSession(() => {
    notificationCount++;
  });

  setCrawlerUrlText("B0TEST0001");
  assert.equal(notificationCount, 1);

  setCrawlerActiveTab("customize");
  assert.equal(getCrawlerSessionState().activeTab, "customize");
  assert.equal(notificationCount, 2);

  unsubscribe();
  setCrawlerUrlText("B0TEST0002");
  assert.equal(notificationCount, 2);
});

test("crawler session startCrawlerJob manages full job lifecycle and preserves output", async () => {
  clearCrawlerSession();

  let progressReported = false;
  const fakeRunner: AmazonCrawlerRunner = async ({ onProgress, signal }) => {
    if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
    const progress: AmazonCrawlerProgress = {
      phase: "product",
      completed: 1,
      total: 1,
      message: "Scraping test product",
    };
    onProgress?.(progress);
    progressReported = true;
    return { ...amazonCrawlerMockOutput };
  };

  const output = await startCrawlerJob({
    runAmazonCrawler: fakeRunner,
    urls: ["https://www.amazon.com/dp/B00MOCK001"],
  });

  assert.ok(output);
  assert.equal(progressReported, true);
  const state = getCrawlerSessionState();
  assert.equal(state.isRunning, false);
  assert.equal(state.error, null);
  assert.ok(state.output);
  assert.equal(state.output.products.length, amazonCrawlerMockOutput.products.length);
  assert.equal(state.selectedProductId, amazonCrawlerMockOutput.products[0]?.id);
  assert.equal(state.activeTab, "overview");

  // Select a different product
  const targetProduct = amazonCrawlerMockOutput.products[1] ?? amazonCrawlerMockOutput.products[0];
  if (targetProduct) {
    selectCrawlerProduct(targetProduct.id);
    assert.equal(getCrawlerSessionState().selectedProductId, targetProduct.id);
    assert.equal(getCrawlerSessionState().selectedMediaUrl, targetProduct.media[0]?.url ?? null);
  }

  // Toggle batch json
  toggleCrawlerBatchJsonOpen();
  assert.equal(getCrawlerSessionState().isBatchJsonOpen, true);

  // Reset output only
  resetCrawlerOutput();
  const resetState = getCrawlerSessionState();
  assert.equal(resetState.output, null);
  assert.equal(resetState.progress, null);
  assert.equal(resetState.selectedProductId, null);
  assert.equal(resetState.isBatchJsonOpen, false);
});

test("crawler session handles cancellation via abortCrawlerJob", async () => {
  clearCrawlerSession();

  const cancellingRunner: AmazonCrawlerRunner = async ({ signal }) => {
    return new Promise((_, reject) => {
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The crawler job was cancelled.", "AbortError"));
      });
    });
  };

  const jobPromise = startCrawlerJob({
    runAmazonCrawler: cancellingRunner,
    urls: ["B00CANCELLED"],
  });

  assert.equal(getCrawlerSessionState().isRunning, true);
  abortCrawlerJob();

  const result = await jobPromise;
  assert.equal(result, null);
  const state = getCrawlerSessionState();
  assert.equal(state.isRunning, false);
  assert.equal(state.error, null);
});

test("crawler session handles runner errors safely", async () => {
  clearCrawlerSession();

  const failingRunner: AmazonCrawlerRunner = async () => {
    throw new Error("Coordinator connection refused");
  };

  const result = await startCrawlerJob({
    runAmazonCrawler: failingRunner,
    urls: ["B00ERROR001"],
  });

  assert.equal(result, null);
  const state = getCrawlerSessionState();
  assert.equal(state.isRunning, false);
  assert.equal(state.error, "Coordinator connection refused");
});

test("resetCrawlerSettings restores settings to defaults", () => {
  clearCrawlerSession();
  updateCrawlerSetting("storeId", "chillgen");
  updateCrawlerSetting("productType", "Rug");
  updateCrawlerSetting("priceAddition", 15);
  updateCrawlerSetting("discountPercent", 20);

  assert.equal(getCrawlerSessionState().settings.storeId, "chillgen");
  assert.equal(getCrawlerSessionState().settings.productType, "Rug");
  assert.equal(getCrawlerSessionState().settings.priceAddition, 15);
  assert.equal(getCrawlerSessionState().settings.discountPercent, 20);

  resetCrawlerSettings();
  const resetState = getCrawlerSessionState();
  assert.equal(resetState.settings.storeId, "capozen");
  assert.equal(resetState.settings.productType, "");
  assert.equal(resetState.settings.priceAddition, 0);
  assert.equal(resetState.settings.discountPercent, 0);
});

test("hydrateCrawlerSessionFromJob restores products, lastJobId, and resolves selection", () => {
  clearCrawlerSession();

  hydrateCrawlerSessionFromJob({
    jobId: "job-restored-999",
    status: "completed",
    products: amazonCrawlerMockOutput.products,
    output: amazonCrawlerMockOutput,
    settings: amazonCrawlerMockOutput.settings,
  });

  const state = getCrawlerSessionState();
  assert.equal(state.lastJobId, "job-restored-999");
  assert.equal(state.isRunning, false);
  assert.equal(state.output?.jobId, amazonCrawlerMockOutput.jobId);
  assert.equal(state.liveProducts.length, amazonCrawlerMockOutput.products.length);
  assert.equal(state.selectedProductId, amazonCrawlerMockOutput.products[0]?.id);
});

test("hydrateCrawlerSessionFromJob keeps the latest SEO status when a results snapshot is stale", () => {
  clearCrawlerSession();
  const sourceProduct = amazonCrawlerMockOutput.products[0];
  assert.ok(sourceProduct);
  const pipeline = {
    status: "waiting_review" as const,
    normalization: { status: "completed" as const, assetsNormalized: 1 },
    seo: { status: "completed" as const },
    shopify: { attempts: 0 },
  };
  const currentProduct = { ...sourceProduct, pipeline };
  const staleProduct = { ...sourceProduct, pipeline: { ...pipeline, status: "seo" as const } };

  hydrateCrawlerSessionFromJob({
    jobId: "job-seo-review",
    status: "review_pending",
    products: [currentProduct],
    output: { ...amazonCrawlerMockOutput, products: [staleProduct] },
  });

  const state = getCrawlerSessionState();
  assert.equal(state.output?.products[0]?.pipeline?.status, "waiting_review");
  assert.equal(state.liveProducts[0]?.pipeline?.status, "waiting_review");
});

test("hydrateCrawlerSessionFromJob reconnects an active job so Stop can target it after refresh", () => {
  clearCrawlerSession();

  hydrateCrawlerSessionFromJob({
    jobId: "job-running-123",
    status: "running",
    products: [],
    output: null,
    progress: {
      phase: "product",
      completed: 0,
      total: 2,
      message: "Đang cào sản phẩm.",
    },
  });

  const state = getCrawlerSessionState();
  assert.equal(state.lastJobId, "job-running-123");
  assert.equal(state.activeJobId, "job-running-123");
  assert.equal(state.isRunning, true);
});
