import assert from "node:assert/strict";
import test from "node:test";

import { FakeGeminiContentGenerator } from "../internal/product-understanding/gemini-content-generator";
import { GeminiProductImageAnalyzer } from "../internal/product-understanding/gemini-product-image-analyzer";

const response = JSON.stringify({
  typography: { visibleTexts: ["Song Title", "Artist"], styleSummary: "white interface labels" },
  visualEntities: "Media player interface with a cloud-head portrait.",
  sceneContext: "Home studio with guitars and monitor speakers.",
  physicalProductIdentity: "area rug",
});

test("Gemini B1 batches readable images and preserves their supplied order", async () => {
  const generator = new FakeGeminiContentGenerator(response);
  const analyzer = new GeminiProductImageAnalyzer({ generator });
  const result = await analyzer.analyze({
    title: "Music rug", description: "", niche: "personalized rug",
    images: [
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
    ],
  });
  assert.equal(generator.calls.length, 1);
  assert.equal(generator.calls[0].imagePayloads.length, 2);
  assert.match(generator.calls[0].prompt, /batch \(2 readable images in supplied order\)/);
  assert.equal(result.physicalProductIdentity, "area rug");
});

test("Gemini B1 omits unreadable images without abandoning remaining pixel evidence", async () => {
  const generator = new FakeGeminiContentGenerator(response);
  const analyzer = new GeminiProductImageAnalyzer({ generator });
  await analyzer.analyze({
    title: "Music rug", description: "", niche: "personalized rug",
    images: [
      { url: "https://127.0.0.1/not-available.webp" },
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
    ],
  });
  assert.equal(generator.calls[0].imagePayloads.length, 1);
});

test("Gemini B1 limits analysis to maxImages when specified", async () => {
  const generator = new FakeGeminiContentGenerator(response);
  const analyzer = new GeminiProductImageAnalyzer({ generator, maxImages: 1 });
  await analyzer.analyze({
    title: "Music rug", description: "", niche: "personalized rug",
    images: [
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
    ],
  });
  assert.equal(generator.calls.length, 1);
  assert.equal(generator.calls[0].imagePayloads.length, 1);
  assert.match(generator.calls[0].prompt, /batch \(1 readable image in supplied order\)/);
});

test("Gemini B1 tries the next image when the preferred image cannot be read", async () => {
  const generator = new FakeGeminiContentGenerator(response);
  const analyzer = new GeminiProductImageAnalyzer({ generator, maxImages: 1 });
  await analyzer.analyze({
    title: "Music rug", description: "", niche: "rug",
    images: [
      { url: "invalid://preferred.jpg" },
      { url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" },
    ],
  });
  assert.equal(generator.calls.length, 1);
  assert.equal(generator.calls[0].imagePayloads.length, 1);
});

test("Gemini B1 reports image read failures without exposing image URLs", async () => {
  const analyzer = new GeminiProductImageAnalyzer({ generator: new FakeGeminiContentGenerator(), maxImages: 1 });
  await assert.rejects(
    analyzer.analyze({
      title: "Music rug", description: "", niche: "rug",
      images: [{ url: "invalid://private-first.jpg" }, { url: "invalid://private-second.jpg" }],
    }),
    (error: unknown) => error instanceof Error && /tried 2 images/.test(error.message)
      && !error.message.includes("private-first") && !error.message.includes("private-second"),
  );
});

test("GeminiProductImageAnalyzer limits concurrent analysis calls via semaphore", async () => {
  let activeCalls = 0;
  let peakCalls = 0;

  const generator = new FakeGeminiContentGenerator();
  generator.setHandler(async () => {
    activeCalls++;
    peakCalls = Math.max(peakCalls, activeCalls);
    await new Promise((resolve) => setTimeout(resolve, 30));
    activeCalls--;
    return { rawText: response };
  });

  const { AsyncSemaphore } = await import("../internal/product-understanding/async-semaphore");
  const semaphore = new AsyncSemaphore(1);
  const analyzer = new GeminiProductImageAnalyzer({ generator, semaphore });

  const input = {
    title: "Music rug", description: "", niche: "personalized rug",
    images: [{ url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" }],
  };

  await Promise.all([
    analyzer.analyze(input),
    analyzer.analyze(input),
    analyzer.analyze(input),
  ]);

  assert.equal(generator.calls.length, 3);
  assert.equal(peakCalls, 1);
});

test("GeminiProductImageAnalyzer retries on 429 using exponential backoff retry", async () => {
  let attempts = 0;
  const retryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const generator = new FakeGeminiContentGenerator();
  generator.setHandler(async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error("429 RESOURCE_EXHAUSTED");
    }
    return { rawText: response };
  });

  const analyzer = new GeminiProductImageAnalyzer({
    generator,
    retryOptions: {
      initialDelayMs: 100,
      jitterMs: 0,
      sleepFn: async () => {},
      onRetry: (_err, attempt, delayMs) => {
        retryEvents.push({ attempt, delayMs });
      },
    },
  });

  const result = await analyzer.analyze({
    title: "Music rug", description: "", niche: "personalized rug",
    images: [{ url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" }],
  });

  assert.equal(attempts, 2);
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].attempt, 1);
  assert.equal(result.physicalProductIdentity, "area rug");
});

test("GeminiProductImageAnalyzer forwards retryOptions to GoogleGenAIVertexContentGenerator without double-retry", async () => {
  let callCount = 0;
  const retryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const { GoogleGenAIVertexContentGenerator } = await import(
    "../internal/product-understanding/gemini-content-generator"
  );

  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    // Generator defaults to 3 retries if not overridden
    client: {
      models: {
        async generateContent() {
          callCount++;
          const err = new Error("429 RESOURCE_EXHAUSTED");
          Object.assign(err, { status: 429 });
          throw err;
        },
      },
    },
  });

  const analyzer = new GeminiProductImageAnalyzer({
    generator,
    retryOptions: {
      maxRetries: 1, // Must override generator default 3
      initialDelayMs: 50,
      jitterMs: 0,
      sleepFn: async () => {},
      onRetry: (_err, attempt, delayMs) => {
        retryEvents.push({ attempt, delayMs });
      },
    },
  });

  await assert.rejects(
    async () => {
      await analyzer.analyze({
        title: "Music rug",
        description: "",
        niche: "personalized rug",
        images: [{ url: "data:image/webp;base64,UklGRg4AAABXRUJQVlA4IAIAAAACAA==" }],
      });
    },
    /429 RESOURCE_EXHAUSTED/,
  );

  // 1 initial + 1 retry = 2 calls (not 1 + 3 = 4)
  assert.equal(callCount, 2);
  // Outer retry must not double-retry after generator exhausts its retries
  assert.equal(retryEvents.length, 1);
});



