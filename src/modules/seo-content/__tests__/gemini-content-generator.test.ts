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
