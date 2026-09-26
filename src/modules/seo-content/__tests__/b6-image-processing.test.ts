import assert from "node:assert/strict";
import test from "node:test";

import { generateAltText } from "../internal/image-processing/alt-text-generator";

test("B6 uses physical identity and product design evidence without scene details", () => {
  const alt = generateAltText({
    sourceTitle: "Personalized Music Player Area Rug", productTitle: "Personalized Music Player Area Rug",
    physicalProductIdentity: "area rug", visualEntities: "media player interface with cloud-head portrait",
    typographyVisibleTexts: ["Song Title"], typographyStyleSummary: "white interface labels",
    imageIndex: 0,
  });
  assert.match(alt, /media player|Song Title/i);
  assert.doesNotMatch(alt, /guitar|studio|brown|beige/i);
});
