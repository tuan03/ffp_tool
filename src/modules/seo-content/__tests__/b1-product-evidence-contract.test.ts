import assert from "node:assert/strict";
import test from "node:test";

import {
  GeminiSchemaValidationError,
  parseGeminiProductImageAnalysis,
} from "../internal/product-understanding/gemini-analysis-schema";

test("B1 accepts only product-anchored evidence groups and rejects legacy visual fields", () => {
  const parsed = parseGeminiProductImageAnalysis(JSON.stringify({
    typography: {
      visibleTexts: ["Song Title", "Artist", "2:27", "-0.34"],
      styleSummary: "clean white media-player labels and controls on a black interface",
    },
    visualEntities:
      "Media player interface with play, pause, shuffle, repeat, volume and progress controls; a surreal black-and-white cloud-head portrait.",
    sceneContext: "Home studio with audio-producer desk, guitars, vinyl shelf and monitor speakers.",
    physicalProductIdentity: "area rug",
  }));

  assert.deepEqual(parsed, {
    typography: {
      visibleTexts: ["Song Title", "Artist", "2:27", "-0.34"],
      styleSummary: "clean white media-player labels and controls on a black interface",
    },
    visualEntities:
      "Media player interface with play, pause, shuffle, repeat, volume and progress controls; a surreal black-and-white cloud-head portrait.",
    sceneContext: "Home studio with audio-producer desk, guitars, vinyl shelf and monitor speakers.",
    physicalProductIdentity: "area rug",
  });

  assert.throws(
    () => parseGeminiProductImageAnalysis(JSON.stringify({
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: [],
      visualStyle: "minimalist",
      productCategory: "area rug",
    })),
    GeminiSchemaValidationError,
  );
});
