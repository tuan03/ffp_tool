import assert from "node:assert/strict";
import test from "node:test";

import { GoogleGenAIVertexContentGenerator } from "../internal/product-understanding/gemini-content-generator";

test("GoogleGenAIVertexContentGenerator forwards structured thinking budget", async () => {
  let capturedConfig: Record<string, unknown> | undefined;
  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    client: {
      models: {
        async generateContent(params) {
          capturedConfig = params.config;
          return { text: '{"niche":"custom rugs"}' };
        },
      },
    },
  });

  await generator.generateStructuredText({
    prompt: "Homepage evidence",
    systemInstruction: "Return JSON",
    responseJsonSchema: { type: "object" },
    thinkingBudget: 0,
  });

  assert.deepEqual(capturedConfig?.thinkingConfig, { thinkingBudget: 0 });
});

test("GoogleGenAIVertexContentGenerator retries on 429 rate limit with exponential backoff", async () => {
  let callCount = 0;
  const retryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    retryOptions: {
      initialDelayMs: 100,
      jitterMs: 0,
      sleepFn: async () => {},
      onRetry: (_err, attempt, delayMs) => {
        retryEvents.push({ attempt, delayMs });
      },
    },
    client: {
      models: {
        async generateContent() {
          callCount++;
          if (callCount === 1) {
            const err = new Error("429 RESOURCE_EXHAUSTED");
            Object.assign(err, { status: 429 });
            throw err;
          }
          return { text: '{"niche":"custom rugs"}' };
        },
      },
    },
  });

  const result = await generator.generateStructuredText({
    prompt: "Test prompt",
    systemInstruction: "Return JSON",
    responseJsonSchema: { type: "object" },
  });

  assert.equal(callCount, 2);
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].attempt, 1);
  assert.equal(result.rawText, '{"niche":"custom rugs"}');
});

