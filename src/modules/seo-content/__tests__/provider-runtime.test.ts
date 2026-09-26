import assert from "node:assert/strict";
import test from "node:test";
import { AsyncSemaphore } from "../internal/product-understanding/async-semaphore";
import { runProviderRequest } from "../internal/provider-runtime";
import { GoogleGenAIVertexContentGenerator } from "../internal/product-understanding/gemini-content-generator";

test("Suggest remains capped at three requests even when configuration exceeds the supported limit", async context => {
  const previous = process.env.SEO_SUGGEST_CONCURRENCY;
  process.env.SEO_SUGGEST_CONCURRENCY = "12";
  context.after(() => {
    if (previous === undefined) delete process.env.SEO_SUGGEST_CONCURRENCY;
    else process.env.SEO_SUGGEST_CONCURRENCY = previous;
  });
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const controller = new AbortController();
  let active = 0;
  let peak = 0;
  const requests = Array.from({ length: 6 }, () => assert.rejects(runProviderRequest("suggest", async signal => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } finally { active--; }
  }, { signal: controller.signal }), { name: "AbortError" }));
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 8; i++) {
    context.mock.timers.tick(250);
    await new Promise(resolve => setImmediate(resolve));
  }
  controller.abort();
  await Promise.all(requests);
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("B1 and text Gemini calls overlap but share the same four request slots", async () => {
  const releases: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const createGenerator = () => new GoogleGenAIVertexContentGenerator({ projectId: "test", client: { models: {
    async generateContent() {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return { text: "{}" };
    },
  } } });
  const requests = Array.from({ length: 8 }, (_, index) => index % 2
    ? createGenerator().generateStructuredText({ prompt: "test", systemInstruction: "test", responseJsonSchema: {} })
    : createGenerator().generateProductImageAnalysis({ prompt: "test", systemInstruction: "test", imagePayloads: [] }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  releases.splice(0).forEach(release => release());
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  releases.splice(0).forEach(release => release());
  await Promise.all(requests);
  assert.equal(peak, 4);
  assert.equal(active, 0);
});

test("Gemini backoff releases capacity and cancellation prevents a retry", async () => {
  const controller = new AbortController();
  let releaseBackoff: (() => void) | undefined;
  let calls = 0;
  const generator = new GoogleGenAIVertexContentGenerator({ projectId: "test", signal: controller.signal,
    retryOptions: { sleepFn: () => new Promise<void>(resolve => { releaseBackoff = resolve; }) },
    client: { models: { async generateContent() { calls++; throw Object.assign(new Error("429"), { status: 429 }); } } },
  });
  const pending = generator.generateProductImageAnalysis({ prompt: "test", systemInstruction: "test", imagePayloads: [] });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await new Promise<void>(resolve => setImmediate(resolve));
  // All four slots remain available while the failed request is backing off.
  let active = 0;
  const releases: Array<() => void> = [];
  const others = Array.from({ length: 4 }, () => runProviderRequest("gemini", async () => {
    active++;
    await new Promise<void>(resolve => releases.push(resolve));
  }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(active, 4);
  controller.abort();
  releaseBackoff?.();
  releases.forEach(release => release());
  await Promise.all(others);
  await rejected;
  assert.equal(calls, 1);
});

test("cancelled waiter never consumes a provider slot", async () => {
  const semaphore = new AsyncSemaphore(1);
  const release = await semaphore.acquire();
  const controller = new AbortController();
  const waiting = semaphore.acquire(controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  release();
  assert.equal(semaphore.activeCount, 0);
  assert.equal(semaphore.waitingCount, 0);
});

test("provider cancellation reaches the request and releases capacity", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const request = runProviderRequest("gemini", async (signal) => {
    requestSignal = signal;
    return new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, { signal: controller.signal });
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(requestSignal?.aborted, true);
  assert.equal(await runProviderRequest("gemini", async () => "ready"), "ready");
});
