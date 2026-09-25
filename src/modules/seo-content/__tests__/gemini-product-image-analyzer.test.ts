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

