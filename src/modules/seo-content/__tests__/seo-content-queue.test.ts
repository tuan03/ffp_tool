import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSeoContentQueue, SeoContentQueue } from "../queue";
import type {
  SeoQueueItem,
  SeoQueueProgressStats,
} from "../queue";
import type { SeoContentInput, SeoContentOutput } from "../types";

function createSampleSeoInput(id: string, title: string): SeoContentInput {
  return {
    productId: id,
    title,
    description: `Sample description for ${title}`,
    handle: `sample-${id}`,
    niche: "Home Decor",
    images: [{ url: `https://example.com/img-${id}.jpg`, alt: title }],
  };
}

function createSampleSeoOutput(input: SeoContentInput): SeoContentOutput {
  return {
    productTitle: `${input.title} - Optimized`,
    productSeoTitle: `${input.title} | Brand`,
    productSeoDescription: `Optimized description for ${input.title}.`,
    productDescription: `<p>Optimized description for ${input.title}.</p>`,
    productHandle: input.handle || "optimized-product",
    images: input.images.map((img) => ({
      sourceUrl: img.url,
      alt: `${input.title} - High Quality`,
      webp: { filename: `${input.handle || "product"}.webp` },
    })),
  };
}

describe("SeoContentQueue - Universal FIFO Queue Engine", () => {
  it("xử lý tuần tự FIFO với concurrency = 1 (mặc định)", async () => {
    const startOrder: string[] = [];
    const finishOrder: string[] = [];

    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        startOrder.push(input.productId || "");
        await new Promise((resolve) => setTimeout(resolve, 30));
        finishOrder.push(input.productId || "");
        return createSampleSeoOutput(input);
      },
    });

    const inputs = [
      createSampleSeoInput("prod-1", "Product 1"),
      createSampleSeoInput("prod-2", "Product 2"),
      createSampleSeoInput("prod-3", "Product 3"),
    ];

    queue.enqueue(inputs);
    const finalStats = await queue.waitForDrain();

    assert.equal(finalStats.total, 3);
    assert.equal(finalStats.completed, 3);
    assert.equal(finalStats.failed, 0);
    assert.equal(finalStats.percent, 100);

    // Thứ tự start và finish phải tuần tự tuyệt đối
    assert.deepEqual(startOrder, ["prod-1", "prod-2", "prod-3"]);
    assert.deepEqual(finishOrder, ["prod-1", "prod-2", "prod-3"]);
  });

  it("xử lý song song với concurrency = 2", async () => {
    let activeWorkers = 0;
    let maxActiveWorkers = 0;

    const queue = new SeoContentQueue({
      concurrency: 2,
      runner: async (input) => {
        activeWorkers += 1;
        if (activeWorkers > maxActiveWorkers) {
          maxActiveWorkers = activeWorkers;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
        activeWorkers -= 1;
        return createSampleSeoOutput(input);
      },
    });

    const inputs = [
      createSampleSeoInput("p-1", "P 1"),
      createSampleSeoInput("p-2", "P 2"),
      createSampleSeoInput("p-3", "P 3"),
      createSampleSeoInput("p-4", "P 4"),
    ];

    queue.enqueue(inputs);
    const finalStats = await queue.waitForDrain();

    assert.equal(finalStats.total, 4);
    assert.equal(finalStats.completed, 4);
    assert.equal(maxActiveWorkers, 2, "Tối đa có đúng 2 worker chạy đồng thời");
  });

  it("fail-safe: một item lỗi không làm sập queue, các item sau tiếp tục chạy", async () => {
    const completedIds: string[] = [];
    const failedEvents: Array<{ id: string; error: string }> = [];

    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        if (input.productId === "error-prod") {
          throw new Error("Gemini AI 429: Resource has been exhausted");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return createSampleSeoOutput(input);
      },
      onItemCompleted: (item) => {
        completedIds.push(item.seoInput.productId || "");
      },
      onItemFailed: (item, error) => {
        failedEvents.push({ id: item.seoInput.productId || "", error });
      },
    });

    queue.enqueue([
      createSampleSeoInput("prod-ok-1", "OK 1"),
      createSampleSeoInput("error-prod", "Error Prod"),
      createSampleSeoInput("prod-ok-2", "OK 2"),
    ]);

    const stats = await queue.waitForDrain();

    assert.equal(stats.total, 3);
    assert.equal(stats.completed, 2);
    assert.equal(stats.failed, 1);
    assert.equal(stats.pending, 0);
    assert.equal(stats.processing, 0);

    assert.deepEqual(completedIds, ["prod-ok-1", "prod-ok-2"]);
    assert.equal(failedEvents.length, 1);
    assert.equal(failedEvents[0].id, "error-prod");
    assert.match(failedEvents[0].error, /Gemini AI 429/);

    const items = queue.getItems();
    assert.equal(items[0].status, "completed");
    assert.equal(items[1].status, "failed");
    assert.match(items[1].error || "", /Gemini AI 429/);
    assert.equal(items[2].status, "completed");
  });

  it("bắn đầy đủ các sự kiện stream realtime (onItemEnqueued, onItemStarted, onItemCompleted, onProgress, onDrained)", async () => {
    const enqueued: string[] = [];
    const started: string[] = [];
    const completed: string[] = [];
    const progressList: number[] = [];
    let drainedCalled = false;

    const queue = createSeoContentQueue<{ customMeta: string }>({
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return createSampleSeoOutput(input);
      },
      onItemEnqueued: (item) => {
        enqueued.push(item.seoInput.productId || "");
      },
      onItemStarted: (item) => {
        started.push(item.seoInput.productId || "");
      },
      onItemCompleted: (item, output) => {
        completed.push(item.seoInput.productId || "");
        assert.ok(output.productTitle.includes("Optimized"));
        assert.equal(item.source?.customMeta, "meta-val");
      },
      onProgress: (stats) => {
        progressList.push(stats.percent);
      },
      onDrained: (stats) => {
        drainedCalled = true;
        assert.equal(stats.completed, 2);
      },
    });

    queue.enqueue(
      [
        createSampleSeoInput("stream-1", "Stream 1"),
        createSampleSeoInput("stream-2", "Stream 2"),
      ],
      [{ customMeta: "meta-val" }, { customMeta: "meta-val" }],
    );

    await queue.waitForDrain();

    assert.deepEqual(enqueued, ["stream-1", "stream-2"]);
    assert.deepEqual(started, ["stream-1", "stream-2"]);
    assert.deepEqual(completed, ["stream-1", "stream-2"]);
    assert.ok(progressList.length >= 2);
    assert.ok(drainedCalled, "onDrained phải được kích hoạt khi queue rỗng");
  });

  it("hỗ trợ tạm dừng (pause) và tiếp tục (resume)", async () => {
    let executedCount = 0;
    let onPausedFired = false;
    let onResumedFired = false;

    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        executedCount += 1;
        return createSampleSeoOutput(input);
      },
      onPaused: () => {
        onPausedFired = true;
      },
      onResumed: () => {
        onResumedFired = true;
      },
    });

    queue.enqueue([
      createSampleSeoInput("pause-1", "P 1"),
      createSampleSeoInput("pause-2", "P 2"),
      createSampleSeoInput("pause-3", "P 3"),
    ]);

    // Tạm dừng ngay
    queue.pause();
    assert.ok(onPausedFired);
    assert.equal(queue.getStats().isPaused, true);

    // Chờ 50ms: chỉ có item 1 đang chạy hoàn tất, các item 2, 3 không được chạy
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(executedCount, 1);
    assert.equal(queue.getStats().pending, 2);

    // Resume queue
    queue.resume();
    assert.ok(onResumedFired);
    assert.equal(queue.getStats().isPaused, false);

    await queue.waitForDrain();
    assert.equal(executedCount, 3);
  });

  it("hỗ trợ hủy bỏ (cancel) các item đang chờ", async () => {
    let onCancelledFired = false;

    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return createSampleSeoOutput(input);
      },
      onCancelled: () => {
        onCancelledFired = true;
      },
    });

    queue.enqueue([
      createSampleSeoInput("c-1", "C 1"),
      createSampleSeoInput("c-2", "C 2"),
      createSampleSeoInput("c-3", "C 3"),
    ]);

    // Item 1 bắt đầu chạy, ta cancel các item pending
    queue.cancel();
    assert.ok(onCancelledFired);

    const stats = await queue.waitForDrain();
    assert.equal(stats.completed, 1);
    assert.equal(stats.cancelled, 2);
    assert.equal(stats.total, 3);

    const items = queue.getItems();
    assert.equal(items[1].status, "cancelled");
    assert.equal(items[2].status, "cancelled");
  });

  it("hỗ trợ xóa sạch (clear) các item đang chờ", async () => {
    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return createSampleSeoOutput(input);
      },
    });

    queue.enqueue([
      createSampleSeoInput("cl-1", "CL 1"),
      createSampleSeoInput("cl-2", "CL 2"),
      createSampleSeoInput("cl-3", "CL 3"),
    ]);

    queue.clear();
    const stats = await queue.waitForDrain();

    // Item 1 đang processing sẽ hoàn tất, item 2 và 3 bị clear khỏi queue
    assert.equal(stats.completed, 1);
    assert.equal(stats.total, 1);
  });

  it("waitForDrain giải quyết ngay lập tức nếu queue rỗng", async () => {
    const queue = createSeoContentQueue();
    const stats = await queue.waitForDrain();
    assert.equal(stats.total, 0);
    assert.equal(stats.pending, 0);
    assert.equal(stats.processing, 0);
  });

  it("bảo toàn source khi enqueue đơn lẻ mà TSource là một mảng", () => {
    const queue = createSeoContentQueue<string[]>({ autoStart: false });
    const tagArray = ["tag1", "tag2", "tag3"];
    const [enqueuedItem] = queue.enqueue(createSampleSeoInput("single-1", "Single Item"), tagArray);

    assert.ok(enqueuedItem);
    assert.deepEqual(enqueuedItem.source, ["tag1", "tag2", "tag3"]);
    assert.equal(Array.isArray(enqueuedItem.source), true);
  });

  it("cô lập ngoại lệ từ listener (onItemStarted, onItemCompleted, onDrained) và không làm sập queue hoặc biến completed thành failed", async () => {
    let drainedFired = false;
    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return createSampleSeoOutput(input);
      },
      onItemStarted: () => {
        throw new Error("Buggy listener onItemStarted threw unexpected error");
      },
      onItemCompleted: () => {
        throw new Error("Buggy listener onItemCompleted threw unexpected error");
      },
      onDrained: () => {
        drainedFired = true;
        throw new Error("Buggy listener onDrained threw unexpected error");
      },
    });

    queue.enqueue([
      createSampleSeoInput("iso-1", "Iso 1"),
      createSampleSeoInput("iso-2", "Iso 2"),
    ]);

    const stats = await queue.waitForDrain();

    assert.equal(stats.total, 2);
    assert.equal(stats.completed, 2);
    assert.equal(stats.failed, 0);
    assert.ok(drainedFired);

    const items = queue.getItems();
    assert.equal(items[0].status, "completed");
    assert.equal(items[1].status, "completed");
  });

  it("hỗ trợ enqueue khi queue đang bị tạm dừng (isPaused = true) và chỉ chạy khi resume", async () => {
    let runCount = 0;
    const queue = createSeoContentQueue({
      concurrency: 1,
      runner: async (input) => {
        runCount += 1;
        return createSampleSeoOutput(input);
      },
    });

    queue.pause();
    queue.enqueue([
      createSampleSeoInput("pause-q-1", "PQ 1"),
      createSampleSeoInput("pause-q-2", "PQ 2"),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(runCount, 0);
    assert.equal(queue.getStats().pending, 2);

    queue.resume();
    const stats = await queue.waitForDrain();

    assert.equal(runCount, 2);
    assert.equal(stats.completed, 2);
  });

  it("kích hoạt onDrained và resolve waitForDrain khi clear toàn bộ queue đang pending", async () => {
    let drainedCalled = false;
    const queue = createSeoContentQueue({
      autoStart: false,
      onDrained: (stats) => {
        drainedCalled = true;
        assert.equal(stats.total, 0);
      },
    });

    queue.enqueue([
      createSampleSeoInput("clr-1", "C 1"),
      createSampleSeoInput("clr-2", "C 2"),
    ]);

    queue.clear();
    const stats = await queue.waitForDrain();

    assert.equal(stats.total, 0);
    assert.equal(stats.pending, 0);
    assert.equal(stats.processing, 0);
    assert.ok(drainedCalled);
  });

  it("hỗ trợ nhiều consumer gọi waitForDrain đồng thời", async () => {
    const queue = createSeoContentQueue({
      concurrency: 2,
      runner: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return createSampleSeoOutput(input);
      },
    });

    queue.enqueue([
      createSampleSeoInput("multi-d-1", "M 1"),
      createSampleSeoInput("multi-d-2", "M 2"),
    ]);

    const [drain1, drain2, drain3] = await Promise.all([
      queue.waitForDrain(),
      queue.waitForDrain(),
      queue.waitForDrain(),
    ]);

    assert.equal(drain1.completed, 2);
    assert.equal(drain2.completed, 2);
    assert.equal(drain3.completed, 2);
  });
});
