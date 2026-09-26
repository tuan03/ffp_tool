import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPipeline } from "../internal/pipeline";
import { evolveContext } from "../internal/pipeline-context";
import { SeoStageError } from "../internal/pipeline-errors";

test("resume keeps research fallback and checks content facts beyond approved keywords", async () => {
  let productType = "rug";
  let contentRuns = 0;
  const pipeline = createSeoPipeline({ stages: (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map(name => ({
    name, async execute(context) {
      if (name === "b2") throw new SeoStageError("b2", "temporary context fallback", true);
      if (name === "b4") return evolveContext(context, {
        productUnderstanding: { physicalProductIdentity: productType, typography: { visibleTexts: [], styleSummary: "unknown" }, visualEntities: "unknown", sceneContext: "unknown" },
        conflictResult: { approvedKeywords: ["music decor"], discardedKeywords: [], conflictReasons: {}, corpusRevision: contentRuns },
      });
      if (name === "b5") contentRuns++;
      return context;
    },
  })) });
  const input = { title: "Music decor", description: "Personalized music decor", handle: "music", niche: "decor", images: [] };
  const initial = await pipeline.executeDetailed(input);
  const same = await pipeline.executeDetailed(input, { resume: initial.resume });
  assert.equal(contentRuns, 1);
  assert.deepEqual(same.fallbackStages, ["b2"]);
  productType = "wall art";
  const changed = await pipeline.executeDetailed(input, { resume: same.resume });
  assert.equal(contentRuns, 2);
  assert.deepEqual(changed.fallbackStages, ["b2"]);
  assert.equal(changed.warnings.length, 1);
  await assert.rejects(pipeline.executeDetailed({ ...input, title: "Different product" }, { resume: changed.resume }), /different product/);
});

test("resume rechecks B4 without repeating research or unchanged content", async () => {
  const calls: string[] = [];
  let keyword = "music rug";
  let revision = 0;
  const pipeline = createSeoPipeline({ stages: (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map(name => ({
    name, async execute(context) {
      calls.push(name);
      if (name === "b4") return evolveContext(context, { conflictResult: {
        approvedKeywords: [keyword], discardedKeywords: [], conflictReasons: {}, corpusRevision: revision++,
      } });
      return context;
    },
  })) });
  const input = { title: "Music rug", description: "Rug", handle: "rug", niche: "rugs", images: [] };
  const first = await pipeline.executeDetailed(input);
  const second = await pipeline.executeDetailed(input, { resume: first.resume });
  assert.deepEqual(calls, ["b1", "b2", "b3", "b4", "b5", "b6", "b4"]);
  keyword = "musical floor rug";
  await pipeline.executeDetailed(input, { resume: second.resume });
  assert.deepEqual(calls.slice(-3), ["b4", "b5", "b6"]);
});

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

test("pipeline rejects promptly when Stop arrives during a long-running stage", async () => {
  const controller = new AbortController();
  const pipeline = createSeoPipeline([{
    name: "b1",
    async execute() {
      return new Promise<never>(() => undefined);
    },
  }]);
  const execution = pipeline.execute({
    title: "Long product",
    description: "Long-running stage",
    niche: "rugs",
    handle: "long-product",
    images: [],
  }, { signal: controller.signal });

  controller.abort();

  await assert.rejects(execution, (error: unknown) => error instanceof Error && error.name === "AbortError");
});
