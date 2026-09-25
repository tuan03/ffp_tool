import assert from "node:assert/strict";
import test from "node:test";

import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { HeuristicContentGenerator } from "../internal/content-generation/heuristic-content-generator";
import { createInitialContext } from "../internal/pipeline-context";

test("B5 fact sheet excludes scene context and only supplies product-safe B1 evidence", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({ title: "Music Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] }),
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: ["Song Title"], styleSummary: "white media-player labels" },
      visualEntities: "Media player interface with a cloud-head portrait.",
      sceneContext: "Home studio with guitars and plants.",
    },
  });
  assert.equal("sceneContext" in facts, false);
  const draft = await new HeuristicContentGenerator().generate({
    facts,
    keywords: { primary: "personalized music rug", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });
  assert.doesNotMatch(`${draft.intro} ${draft.closing}`, /guitar|plant|studio/i);
});

test("B5 HeuristicContentGenerator preserves variantLabel in fact sheet and title builder", async () => {
  const facts = buildContentFactSheet({
    ...createInitialContext({
      title: "Personalized Christian Handbag Set",
      description: "",
      niche: "handbag set",
      handle: "christian-handbag-set",
      images: [],
      variantLabel: "Pink Faith",
    }),
    productUnderstanding: {
      physicalProductIdentity: "handbag set",
      typography: { visibleTexts: [], styleSummary: "" },
      visualEntities: "Handbag set with wallet",
      sceneContext: "",
    },
  });


  assert.equal(facts.variantLabel, "Pink Faith");

  const draft = await new HeuristicContentGenerator().generate({
    facts,
    keywords: { primary: "christian faux leather handbag set", secondary: [], supportingKeywords: [], framingConcepts: [], targetedKeywords: [] },
    constraints: { maxSeoTitleLength: 70, maxSeoDescriptionLength: 160, maxHandleLength: 80, maxBullets: 5, preserveExistingHandle: true },
  });

  assert.match(draft.productTitle, /Pink Faith/);
});

