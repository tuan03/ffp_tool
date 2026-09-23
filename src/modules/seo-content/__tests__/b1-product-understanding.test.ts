import assert from "node:assert/strict";
import test from "node:test";

import { createInitialContext } from "../internal/pipeline-context";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";
import type { ProductImageAnalyzer } from "../internal/product-understanding/product-image-analyzer";

const analysis = {
  typography: {
    visibleTexts: ["Song Title", "Artist", "2:27", "-0.34"],
    styleSummary: "clean white media-player labels and controls on a black interface",
  },
  visualEntities: "Media player interface with play, pause, shuffle, repeat, volume and progress controls; a surreal black-and-white cloud-head portrait.",
  sceneContext: "Home studio with an audio-producer desk, guitars, vinyl shelf and monitor speakers.",
  physicalProductIdentity: "area rug",
} as const;

const input = {
  title: "Personalized Music Player Area Rug",
  description: "Custom song title rug",
  niche: "personalized rug",
  handle: "music-player-rug",
  images: [{ url: "https://example.com/rug-front.webp" }, { url: "https://example.com/rug-detail.webp" }],
};

test("B1 sends the entire gallery in supplied order and keeps product evidence separate from scene context", async () => {
  const captured: unknown[] = [];
  const analyzer: ProductImageAnalyzer = {
    async analyze(request) {
      captured.push(request);
      return analysis;
    },
  };
  const result = await createB1ProductUnderstandingStage({ imageAnalyzer: analyzer }).execute(createInitialContext(input));

  assert.deepEqual((captured[0] as { images: readonly { url: string }[] }).images.map((image) => image.url), [
    "https://example.com/rug-front.webp", "https://example.com/rug-detail.webp",
  ]);
  assert.deepEqual(result.productUnderstanding, analysis);
  assert.doesNotMatch(result.productUnderstanding?.visualEntities ?? "", /guitar|brown|beige|plant/i);
  assert.match(result.productUnderstanding?.sceneContext ?? "", /guitar|vinyl|monitor/i);
});

test("B1 falls back only to physical identity when no image pixels are available", async () => {
  const analyzer: ProductImageAnalyzer = { async analyze() { throw new Error("unreadable"); } };
  const result = await createB1ProductUnderstandingStage({ imageAnalyzer: analyzer }).execute(createInitialContext(input));
  assert.deepEqual(result.productUnderstanding, {
    typography: { visibleTexts: [], styleSummary: "unknown" },
    visualEntities: "unknown", sceneContext: "unknown", physicalProductIdentity: "area rug",
  });
});
