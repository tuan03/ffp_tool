import assert from "node:assert/strict";
import test from "node:test";

import { buildTemplateSequence, getReviewImageStorePreset } from "../store-presets";

test("template sequence uses every background before repeating", () => {
  const sequence = buildTemplateSequence(["a.png", "b.png", "c.png"], 7, () => 0);
  assert.equal(new Set(sequence.slice(0, 3)).size, 3);
  assert.equal(new Set(sequence.slice(3, 6)).size, 3);
  assert.equal(sequence.length, 7);
});

test("known review stores receive product-specific presets", () => {
  assert.equal(getReviewImageStorePreset("preaureum").supportsBagSet, true);
  assert.match(getReviewImageStorePreset("capozen").prompt, /rug/i);
  assert.match(getReviewImageStorePreset("jeminise").prompt, /bedding/i);
  assert.equal(getReviewImageStorePreset("future-store").scope, "single");
});
