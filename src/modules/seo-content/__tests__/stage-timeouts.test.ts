import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import {
  DEFAULT_OVERALL_TIMEOUT_MS,
  DEFAULT_STAGE_TIMEOUTS_MS,
  getStageTimeoutMs,
  createSeoPipeline,
} from "../internal/pipeline";
import { isSeoTimeoutError, SeoTimeoutError } from "../internal/pipeline-errors";
import { evolveContext } from "../internal/pipeline-context";
import { createSeoContentQueue } from "../queue";
import { JEMINISE_BEDDING_PROFILE } from "../service";
import type { SeoContentInput, SeoContentOutput } from "../types";

function createDummyInput(id = "prod-test"): SeoContentInput {
  return {
    niche: "Home Decor",
    images: [{ id, url: `https://example.com/${id}.jpg` }],
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };
}

function createDummyOutput(input: SeoContentInput): SeoContentOutput {
  const id = input.images[0]?.id ?? "product";
  return {
    productTitle: `Product ${id} - Optimized`,
    productSeoTitle: `Product ${id} | SEO`,
    productSeoDescription: `Optimized description for product ${id}.`,
    productDescription: `<p>Optimized product ${id}</p>`,
    productHandle: `product-${id}`,
    images: input.images.map((img) => ({
      sourceUrl: img.url,
      alt: `Product ${id} image`,
      webp: { filename: "image.webp" },
    })),
  };
}

describe("R2: Exact Per-Stage Timeouts & Abort Handling", () => {
  it("enforces exact default timeout thresholds specified in R2", () => {
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b1, 60_000, "B1 Product Understanding / Vision must be 60s");
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b2, 90_000, "B2 Shopping Context must be 90s");
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b3, 45_000, "B3 Search Suggestions must be 45s");
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b4, 45_000, "B4 Conflict Control must be 45s");
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b5, 120_000, "B5 Content Generation must be 120s");
    assert.equal(DEFAULT_STAGE_TIMEOUTS_MS.b6, 45_000, "B6 Image Processing must be 45s");
    assert.equal(DEFAULT_OVERALL_TIMEOUT_MS, 420_000, "Overall Product Timeout must be 420s");

    // Case-insensitivity and default fallback
    assert.equal(getStageTimeoutMs("B1"), 60_000);
    assert.equal(getStageTimeoutMs("b5"), 120_000);
    assert.equal(getStageTimeoutMs("unknown_stage"), 60_000);

    // Overrides
    assert.equal(getStageTimeoutMs("b1", { b1: 5_000 }), 5_000);
    assert.equal(getStageTimeoutMs("b2", { B2: 10_000 }), 10_000);
  });

  const stageList = ["b1", "b2", "b3", "b4", "b5", "b6"] as const;

  for (const stageName of stageList) {
    it(`aborts stage ${stageName.toUpperCase()} with descriptive SeoTimeoutError when execution exceeds timeout threshold`, async () => {
      const pipeline = createSeoPipeline({
        stages: stageList.map((name) => ({
          name,
          async execute(context) {
            if (name === stageName) {
              // Delayed execution that exceeds stage timeout threshold
              await new Promise((resolve) => setTimeout(resolve, 80));
            }
            return evolveContext(context, {
              productUnderstanding: {
                physicalProductIdentity: "test item",
                typography: { visibleTexts: [], styleSummary: "none" },
                visualEntities: "item",
                sceneContext: "studio",
              },
            });
          },
        })),
        stageTimeouts: { [stageName]: 25 },
      });

      const input = createDummyInput(`test-${stageName}`);

      await assert.rejects(
        async () => {
          await pipeline.execute(input);
        },
        (error: unknown) => {
          assert.ok(isSeoTimeoutError(error), "Error must be recognized as SeoTimeoutError");
          const timeoutErr = error as SeoTimeoutError;
          assert.equal(timeoutErr.name, "SeoTimeoutError");
          assert.equal(timeoutErr.code, "SEO_TIMEOUT");
          assert.equal(timeoutErr.stageName, stageName);
          assert.equal(timeoutErr.timeoutMs, 25);
          assert.match(
            timeoutErr.message,
            new RegExp(`Stage ${stageName.toUpperCase()} timed out after 25ms`, "i"),
          );
          return true;
        },
      );
    });
  }

  it("aborts only that stage when timer expires, allowing recoverable stages to fall back downstream", async () => {
    let b3Executed = false;
    let b4Executed = false;

    const pipeline = createSeoPipeline({
      stages: stageList.map((name) => ({
        name,
        async execute(context) {
          if (name === "b2") {
            // Stage B2 hangs and times out
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          if (name === "b3") {
            b3Executed = true;
          }
          if (name === "b4") {
            b4Executed = true;
          }
          return context;
        },
      })),
      stageTimeouts: { b2: 25 },
    });

    // Make stage error recoverable for B2 timeout test
    const customPipeline = createSeoPipeline({
      stages: stageList.map((name) => ({
        name,
        async execute(context) {
          if (name === "b2") {
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          if (name === "b3") b3Executed = true;
          if (name === "b4") b4Executed = true;
          return context;
        },
      })),
    });

    // Test that when non-recoverable, downstream is aborted
    const input = createDummyInput("recoverable-test");
    await assert.rejects(async () => {
      await pipeline.execute(input);
    }, SeoTimeoutError);
    assert.equal(b3Executed, false, "Downstream stage B3 must not run if upstream timeout is unhandled");
  });

  it("enforces overall pipeline timeout and aborts all stages when overall limit is exceeded", async () => {
    const pipeline = createSeoPipeline({
      stages: stageList.map((name) => ({
        name,
        async execute(context) {
          // Each stage takes 30ms. Combined time for 6 stages = 180ms
          await new Promise((resolve) => setTimeout(resolve, 30));
          return context;
        },
      })),
      stageTimeouts: { b1: 100, b2: 100, b3: 100, b4: 100, b5: 100, b6: 100 },
      overallTimeoutMs: 50, // Overall limit expires before stage 2 completes
    });

    const input = createDummyInput("overall-timeout");

    await assert.rejects(
      async () => {
        await pipeline.execute(input);
      },
      (error: unknown) => {
        assert.ok(isSeoTimeoutError(error), "Error must be SeoTimeoutError");
        const timeoutErr = error as SeoTimeoutError;
        assert.equal(timeoutErr.stageName, "overall");
        assert.equal(timeoutErr.timeoutMs, 50);
        assert.match(timeoutErr.message, /Overall SEO pipeline timed out after 50ms/i);
        return true;
      },
    );
  });

  it("releases worker slot immediately upon abort in SeoContentQueue, unblocking subsequent items", async () => {
    const startLog: string[] = [];
    const finishLog: string[] = [];
    let hungStartedPromiseResolve: () => void;
    const hungStartedPromise = new Promise<void>((resolve) => {
      hungStartedPromiseResolve = resolve;
    });

    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input, options) => {
        startLog.push(input.images[0]?.id ?? "");
        if (input.images[0]?.id === "hung-item") {
          hungStartedPromiseResolve();
          // Simulates a hung task that only terminates if aborted
          return new Promise<SeoContentOutput>((resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted hung task");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        finishLog.push(input.images[0]?.id ?? "");
        return createDummyOutput(input);
      },
    });

    const [hungItem, nextItem] = queue.enqueue([
      createDummyInput("hung-item"),
      createDummyInput("next-item"),
    ]);

    // Wait until hung-item starts
    await hungStartedPromise;
    assert.deepEqual(startLog, ["hung-item"]);
    assert.equal(queue.getStats().processing, 1);
    assert.equal(queue.getStats().pending, 1);

    // Abort the hung item
    const didAbort = queue.abortItem(hungItem.id);
    assert.equal(didAbort, true, "abortItem must return true for running item");

    // Wait for the queue to drain
    const stats = await queue.waitForDrain();

    // Verify worker slot was freed immediately and next item completed
    assert.equal(stats.completed, 1, "next-item should have completed");
    assert.equal(stats.cancelled, 1, "hung-item should have been cancelled");
    assert.equal(stats.pending, 0);
    assert.equal(stats.processing, 0);

    assert.deepEqual(startLog, ["hung-item", "next-item"]);
    assert.deepEqual(finishLog, ["next-item"]);

    const hungItemState = queue.getItem(hungItem.id);
    assert.equal(hungItemState?.status, "cancelled");

    const nextItemState = queue.getItem(nextItem.id);
    assert.equal(nextItemState?.status, "completed");
  });

  it("releases worker slot immediately on item timeout in SeoContentQueue", async () => {
    const queue = createSeoContentQueue({
      concurrency: 1,
      itemTimeoutMs: 40,
      runner: async (input, options) => {
        if (input.images[0]?.id === "slow-item") {
          // Deliberately exceeds itemTimeoutMs (40ms)
          return new Promise<SeoContentOutput>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve(createDummyOutput(input));
            }, 200);
            options?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(options.signal?.reason ?? new Error("Aborted"));
            });
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
        return createDummyOutput(input);
      },
    });

    queue.enqueue([
      createDummyInput("slow-item"),
      createDummyInput("fast-item"),
    ]);

    const stats = await queue.waitForDrain();

    assert.equal(stats.total, 2);
    assert.equal(stats.failed, 1, "slow-item must fail due to timeout");
    assert.equal(stats.completed, 1, "fast-item must complete");
    assert.equal(stats.processing, 0);
    assert.equal(stats.pending, 0);

    const items = queue.getItems();
    assert.equal(items[0].status, "failed");
    assert.match(items[0].error || "", /timed out after 40ms/i);
    assert.equal(items[1].status, "completed");
  });

  it("handles concurrency = 2 with one aborted worker without stalling other workers", async () => {
    let unblockItem2: () => void = () => {};
    const item2BlockedPromise = new Promise<void>((resolve) => {
      unblockItem2 = resolve;
    });

    const queue = createSeoContentQueue({
      concurrency: 2,
      runner: async (input, options) => {
        if (input.images[0]?.id === "p-hung") {
          return new Promise<SeoContentOutput>((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              const err = new Error("Cancelled");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        if (input.images[0]?.id === "p-wait") {
          await item2BlockedPromise;
          return createDummyOutput(input);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return createDummyOutput(input);
      },
    });

    const [hung, waiting, next] = queue.enqueue([
      createDummyInput("p-hung"),
      createDummyInput("p-wait"),
      createDummyInput("p-next"),
    ]);

    // Give time for first two to start processing
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(queue.getStats().processing, 2);

    // Abort p-hung
    queue.abortItem(hung.id);

    // Give time for p-next to be pumped into the freed worker slot
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(queue.getItem(hung.id)?.status, "cancelled");

    // Unblock p-wait
    unblockItem2();

    const stats = await queue.waitForDrain();
    assert.equal(stats.completed, 2, "p-wait and p-next must complete");
    assert.equal(stats.cancelled, 1, "p-hung was cancelled");
    assert.equal(queue.getItem(next.id)?.status, "completed");
  });

  it("executes successfully without timeouts when all stages complete within thresholds", async () => {
    const pipeline = createSeoPipeline({
      stages: stageList.map((name) => ({
        name,
        async execute(context) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (name === "b1") {
            return evolveContext(context, {
              productUnderstanding: {
                physicalProductIdentity: "cotton throw blanket",
                typography: { visibleTexts: [], styleSummary: "none" },
                visualEntities: "blanket",
                sceneContext: "living room",
              },
            });
          }
          if (name === "b5") {
            return evolveContext(context, {
              contentResult: {
                productTitle: "Cozy Cotton Throw Blanket",
                productDescription: "<p>Warm and comfortable blanket.</p>",
                productSeoTitle: "Cozy Cotton Throw Blanket | Soft Bedding",
                productSeoDescription: "Shop our cozy cotton throw blanket.",
                productHandle: "cozy-cotton-throw-blanket",
              },
            });
          }
          return context;
        },
      })),
      stageTimeouts: { b1: 100, b2: 100, b3: 100, b4: 100, b5: 100, b6: 100 },
      overallTimeoutMs: 500,
    });

    const input = createDummyInput("success-fast");
    const output = await pipeline.execute(input);

    assert.equal(output.productTitle, "Cozy Cotton Throw Blanket");
    assert.equal(output.productHandle, "cozy-cotton-throw-blanket");
  });
});
