import assert from "node:assert/strict";
import test from "node:test";

import {
  AsyncSemaphore,
  getSharedGeminiVisionSemaphore,
  resetSharedGeminiVisionSemaphore,
} from "../internal/product-understanding/async-semaphore";

test("AsyncSemaphore validates maxConcurrency is a positive integer", () => {
  assert.throws(() => new AsyncSemaphore(0), /must be a positive integer/);
  assert.throws(() => new AsyncSemaphore(-1), /must be a positive integer/);
  assert.throws(() => new AsyncSemaphore(1.5), /must be a positive integer/);
  assert.doesNotThrow(() => new AsyncSemaphore(1));
  assert.doesNotThrow(() => new AsyncSemaphore(2));
});

test("AsyncSemaphore enforces maximum concurrency limit", async () => {
  const semaphore = new AsyncSemaphore(2);
  let activeCount = 0;
  let peakActiveCount = 0;
  const completed: number[] = [];

  const runTask = async (id: number, delayMs: number) => {
    return semaphore.runExclusive(async () => {
      activeCount++;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      assert.ok(activeCount <= 2, `activeCount ${activeCount} exceeded maxConcurrency 2`);

      await new Promise((resolve) => setTimeout(resolve, delayMs));

      activeCount--;
      completed.push(id);
      return id;
    });
  };

  const tasks = [
    runTask(1, 40),
    runTask(2, 40),
    runTask(3, 20),
    runTask(4, 20),
    runTask(5, 10),
  ];

  const results = await Promise.all(tasks);

  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(completed.length, 5);
  assert.equal(peakActiveCount, 2);
  assert.equal(semaphore.activeCount, 0);
  assert.equal(semaphore.waitingCount, 0);
});

test("AsyncSemaphore executes waiting tasks in FIFO order", async () => {
  const semaphore = new AsyncSemaphore(1);
  const executionOrder: number[] = [];

  const releaseFirst = await semaphore.acquire();

  // Queue up tasks 2, 3, 4
  const p2 = semaphore.runExclusive(async () => {
    executionOrder.push(2);
  });
  const p3 = semaphore.runExclusive(async () => {
    executionOrder.push(3);
  });
  const p4 = semaphore.runExclusive(async () => {
    executionOrder.push(4);
  });

  assert.equal(semaphore.waitingCount, 3);
  executionOrder.push(1);
  releaseFirst();

  await Promise.all([p2, p3, p4]);

  assert.deepEqual(executionOrder, [1, 2, 3, 4]);
  assert.equal(semaphore.activeCount, 0);
  assert.equal(semaphore.waitingCount, 0);
});

test("AsyncSemaphore runExclusive releases slot when task rejects", async () => {
  const semaphore = new AsyncSemaphore(1);

  await assert.rejects(
    async () => {
      await semaphore.runExclusive(async () => {
        throw new Error("Task failed");
      });
    },
    { message: "Task failed" },
  );

  assert.equal(semaphore.activeCount, 0);

  // Subsequent task must still acquire normally
  const success = await semaphore.runExclusive(async () => "recovered");
  assert.equal(success, "recovered");
  assert.equal(semaphore.activeCount, 0);
});

test("AsyncSemaphore release callback is idempotent", async () => {
  const semaphore = new AsyncSemaphore(1);
  const release = await semaphore.acquire();
  assert.equal(semaphore.activeCount, 1);

  release();
  assert.equal(semaphore.activeCount, 0);

  // Calling release a second time should not decrement into negative
  release();
  assert.equal(semaphore.activeCount, 0);
});

test("getSharedGeminiVisionSemaphore returns singleton and respects env configuration", () => {
  resetSharedGeminiVisionSemaphore();

  const prevEnv = process.env.GEMINI_VISION_CONCURRENCY;
  try {
    process.env.GEMINI_VISION_CONCURRENCY = "2";
    const sem = getSharedGeminiVisionSemaphore();
    assert.equal(sem.maxConcurrency, 2);

    // Subsequent call returns exact same instance
    const sem2 = getSharedGeminiVisionSemaphore();
    assert.equal(sem, sem2);
  } finally {
    if (prevEnv !== undefined) {
      process.env.GEMINI_VISION_CONCURRENCY = prevEnv;
    } else {
      delete process.env.GEMINI_VISION_CONCURRENCY;
    }
    resetSharedGeminiVisionSemaphore();
  }
});
