import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPipeline } from "../internal/pipeline";
import { evolveContext } from "../internal/pipeline-context";

test("pipeline preserves source and carries inferred effective niche into the B1–B6 stage chain", async () => {
  const seen: string[] = [];
  const pipeline = createSeoPipeline({
    siteNicheResolver: { async resolve() { return { niche: "music decor rugs", source: "inferred" as const }; } },
    stages: (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map((name) => ({
      name,
      async execute(context) {
        seen.push(`${name}:${context.effectiveNiche}`);
        return name === "b1"
          ? evolveContext(context, {
            productUnderstanding: {
              physicalProductIdentity: "area rug",
              typography: { visibleTexts: [], styleSummary: "unknown" },
              visualEntities: "unknown", sceneContext: "unknown",
            },
          })
          : name === "b5"
            ? evolveContext(context, {
              contentResult: {
                productTitle: context.source.title, productDescription: context.source.description,
                productSeoTitle: context.source.title, productSeoDescription: context.source.description,
                productHandle: context.source.handle,
              },
            })
            : context;
      },
    })),
  });
  const input = { title: "Music Rug", description: "Custom rug", niche: "manual rug", handle: "music-rug", images: [], siteDomain: "store.example" };
  const output = await pipeline.execute(input);
  assert.deepEqual(seen, ["b1:music decor rugs", "b2:music decor rugs", "b3:music decor rugs", "b4:music decor rugs", "b5:music decor rugs", "b6:music decor rugs"]);
  assert.equal(output.productTitle, "Music Rug");
  assert.equal(input.niche, "manual rug");
});
