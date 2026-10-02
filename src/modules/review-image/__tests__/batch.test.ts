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
  const preaureumPreset = getReviewImageStorePreset("preaureum");
  const capozenPreset = getReviewImageStorePreset("capozen");
  const jeminisePreset = getReviewImageStorePreset("jeminise");

  assert.equal(preaureumPreset.supportsBagSet, true);
  assert.match(preaureumPreset.prompt, /replace every occurrence of that personalized customer name/i);
  assert.match(preaureumPreset.prompt, /same replacement name/i);
  assert.match(preaureumPreset.prompt, /preserve all other readable text/i);
  assert.match(jeminisePreset.prompt, /replace every occurrence of that personalized customer name/i);
  assert.match(jeminisePreset.prompt, /same replacement name across the comforter and pillowcases/i);
  assert.match(jeminisePreset.prompt, /preserve all other readable text, numbers/i);
  assert.match(jeminisePreset.prompt, /Image 1 is the only source of scene composition/i);
  assert.match(jeminisePreset.prompt, /do not copy or reuse any room, bed frame, furniture, background, camera angle, crop or staging from Image 2/i);
  assert.match(jeminisePreset.prompt, /If Image 1 is a close-up/i);
  assert.match(jeminisePreset.prompt, /do not zoom out or invent a wider bedroom/i);
  assert.match(capozenPreset.prompt, /rug/i);
  assert.match(capozenPreset.prompt, /replace every occurrence of that personalized customer name/i);
  assert.match(capozenPreset.prompt, /same replacement name across the entire rug/i);
  assert.match(capozenPreset.prompt, /preserve all other readable text, numbers, slogans, branding and artwork/i);
  assert.match(capozenPreset.prompt, /If the rug has no personalized customer name, do not add one/i);
  assert.match(capozenPreset.prompt, /Image 2 is the only source of the rug's physical geometry/i);
  assert.match(capozenPreset.prompt, /Do not use the removed rug's footprint, dimensions, silhouette or proportions/i);
  assert.match(capozenPreset.prompt, /do not stretch, compress, widen, shorten, crop or reshape the Image 2 rug/i);
  assert.match(capozenPreset.prompt, /reconstruct all newly exposed floor/i);
  assert.match(capozenPreset.prompt, /preserve the original length-to-width ratio/i);
  assert.match(jeminisePreset.prompt, /bedding/i);
  assert.equal(getReviewImageStorePreset("future-store").scope, "single");
});

test("rug preset replaces the template product while keeping only its scene", () => {
  const { prompt } = getReviewImageStorePreset("capozen");
  assert.match(prompt, /Image 1 is the only source of scene composition/i);
  assert.match(prompt, /Keep its exact aspect ratio, crop, camera position/i);
  assert.match(prompt, /Do not zoom out or invent a wider room/i);
  assert.match(prompt, /Ignore the surroundings in Image 2 completely/i);
  assert.match(prompt, /Do not copy or reuse any room, floor, furniture, background, camera angle, crop or staging from Image 2/i);
  assert.match(prompt, /Do not merely repaint or transfer the Image 2 artwork onto the Image 1 rug/i);
  assert.match(prompt, /The number of rugs must come only from Image 2/i);
});

test("rug preset keeps physical scale independent of the template rug footprint", () => {
  const { prompt } = getReviewImageStorePreset("capozen");
  assert.match(prompt, /Do not shrink the product to fit the cleared template footprint/i);
  assert.match(prompt, /large area rug or play mat must remain a large floor covering/i);
  assert.match(prompt, /physical scale cues only/i);
  assert.match(prompt, /pixel dimensions or percentage of image occupied/i);
  assert.match(prompt, /allow the rug to extend beyond the frame/i);
  assert.match(prompt, /Do not invent exact centimeter or inch measurements/i);
});
