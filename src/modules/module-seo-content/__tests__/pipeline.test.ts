import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import type { SeoContentInput } from "../types";
import type {
  SeoPipelineContext,
  SeoPipelineStage,
  SeoStageName,
} from "../internal/domain-types";
import {
  createInitialContext,
  evolveContext,
  finalizePipelineOutput,
} from "../internal/pipeline-context";
import { SeoStageError, wrapStageError } from "../internal/pipeline-errors";
import {
  createSeoPipeline,
  DEFAULT_SEO_PIPELINE_STAGES,
} from "../internal/pipeline";
import { executeB2ShoppingContext } from "../internal/stages/b2-shopping-context";
import { executeB3SearchSuggestions } from "../internal/stages/b3-search-suggestions";
import { executeB4ConflictControl } from "../internal/stages/b4-conflict-control";
import { executeB6ImageProcessing } from "../internal/stages/b6-image-processing";
import { seoContentMockInput } from "../mocks/data";

test("SEO Pipeline executes default 6 stages sequentially in exact order (b1 -> b2 -> b3 -> b4 -> b5 -> b6)", async () => {
  const executedOrder: SeoStageName[] = [];

  const stagesWithSpies: SeoPipelineStage[] = DEFAULT_SEO_PIPELINE_STAGES.map((stage) => ({
    name: stage.name,
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      executedOrder.push(stage.name);
      return stage.execute(context);
    },
  }));

  const pipeline = createSeoPipeline(stagesWithSpies);
  const result = await pipeline.execute(seoContentMockInput);

  assert.deepEqual(executedOrder, ["b1", "b2", "b3", "b4", "b5", "b6"]);
  assert.equal(result.productTitle, seoContentMockInput.title);
  assert.equal(result.productHandle, seoContentMockInput.handle);
  assert.equal(result.images.length, seoContentMockInput.images.length);
});

test("SEO Pipeline strictly preserves source data across all stages without loss or mutation", async () => {
  const stagesSeenSources: SeoContentInput[] = [];

  const spyStages: SeoPipelineStage[] = DEFAULT_SEO_PIPELINE_STAGES.map((stage) => ({
    name: stage.name,
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      stagesSeenSources.push(context.source);
      return stage.execute(context);
    },
  }));

  const pipeline = createSeoPipeline(spyStages);
  await pipeline.execute(seoContentMockInput);

  assert.equal(stagesSeenSources.length, 6);
  for (const seenSource of stagesSeenSources) {
    // Exact same reference preserved
    assert.equal(seenSource, stagesSeenSources[0]);
    assert.equal(seenSource.title, seoContentMockInput.title);
    assert.equal(seenSource.description, seoContentMockInput.description);
    assert.equal(seenSource.handle, seoContentMockInput.handle);
    assert.equal(seenSource.niche, seoContentMockInput.niche);
    assert.deepEqual(seenSource.images, seoContentMockInput.images);
  }
});

test("SEO Pipeline context enforces immutability and new object references at each transition", async () => {
  const initial = createInitialContext(seoContentMockInput);
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(initial.source));
  assert.ok(Object.isFrozen(initial.source.images));

  assert.throws(
    () => {
      // @ts-expect-error verifying runtime immutability
      initial.source = { ...seoContentMockInput };
    },
    { name: "TypeError" },
  );

  const evolved = evolveContext(initial, {
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: ["rug"],
      dominantColors: ["black"],
      visualStyle: "vintage",
      productCategory: "rugs",
    },
  });

  assert.notEqual(initial, evolved);
  assert.equal(initial.source, evolved.source);
  assert.ok(Object.isFrozen(evolved));
  assert.deepEqual(evolved.productUnderstanding?.detectedEntities, ["rug"]);

  // Transitions across default stages produce distinct context references
  let currentContext = createInitialContext(seoContentMockInput);
  const contexts: SeoPipelineContext[] = [currentContext];

  for (const stage of DEFAULT_SEO_PIPELINE_STAGES) {
    const nextContext = await stage.execute(currentContext);
    assert.notEqual(currentContext, nextContext);
    assert.equal(currentContext.source, nextContext.source);
    currentContext = nextContext;
    contexts.push(currentContext);
  }

  assert.equal(contexts.length, 7);
  // Verify all 7 context references are distinct
  const uniqueContexts = new Set(contexts);
  assert.equal(uniqueContexts.size, 7);
});

test("SEO Pipeline stops immediately on fatal error and throws SeoStageError with stage metadata", async () => {
  let stageB3Executed = false;

  const failingStages: SeoPipelineStage[] = [
    {
      name: "b1",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        return evolveContext(context, {});
      },
    },
    {
      name: "b2",
      async execute(): Promise<SeoPipelineContext> {
        throw new Error("Fatal failure in stage B2 processing");
      },
    },
    {
      name: "b3",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        stageB3Executed = true;
        return evolveContext(context, {});
      },
    },
  ];

  const pipeline = createSeoPipeline(failingStages);

  await assert.rejects(
    async () => {
      await pipeline.execute(seoContentMockInput);
    },
    (err: unknown) => {
      assert.ok(err instanceof SeoStageError);
      assert.ok(err instanceof AppError);
      assert.equal(err.stageName, "b2");
      assert.equal(err.code, "SEO_STAGE_FAILED");
      assert.equal(err.isRecoverable, false);
      assert.match(err.message, /Stage B2 failed: Fatal failure in stage B2 processing/);
      return true;
    },
  );

  assert.equal(stageB3Executed, false, "Subsequent stages must not execute after fatal error");
});

test("SEO Pipeline handles recoverable stage errors gracefully by logging warning and falling back", async () => {
  let stageB3Executed = false;

  const recoverableStages: SeoPipelineStage[] = [
    {
      name: "b1",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        return evolveContext(context, {});
      },
    },
    {
      name: "b2",
      async execute(): Promise<SeoPipelineContext> {
        throw new SeoStageError("b2", "Temporary non-fatal rate limit", true);
      },
    },
    {
      name: "b3",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        stageB3Executed = true;
        return evolveContext(context, {
          contentResult: {
            productTitle: "Fallback Output Title",
            productDescription: "Fallback Description",
            productSeoTitle: "Fallback SEO Title",
            productSeoDescription: "Fallback SEO Description",
            productHandle: "fallback-handle",
          },
        });
      },
    },
  ];

  const pipeline = createSeoPipeline(recoverableStages);
  const result = await pipeline.execute(seoContentMockInput);

  assert.equal(stageB3Executed, true, "Stage B3 should execute after recoverable error in B2");
  assert.equal(result.productTitle, "Fallback Output Title");
  assert.equal(result.productHandle, "fallback-handle");
  assert.equal(result.images.length, seoContentMockInput.images.length);
  assert.equal(result.images[0].webp.filename, "fallback-handle-1.webp");
});

test("SEO Pipeline supports dependency injection with fully custom stages", async () => {
  const customStages: SeoPipelineStage[] = [
    {
      name: "b1",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        return evolveContext(context, {
          contentResult: {
            productTitle: `Customized: ${context.source.title}`,
            productDescription: "Custom Description",
            productSeoTitle: "Custom SEO Title",
            productSeoDescription: "Custom SEO Description",
            productHandle: "custom-handle",
          },
        });
      },
    },
  ];

  const pipeline = createSeoPipeline(customStages);
  const result = await pipeline.execute(seoContentMockInput);

  assert.equal(result.productTitle, `Customized: ${seoContentMockInput.title}`);
  assert.equal(result.productHandle, "custom-handle");
});

test("SEO Pipeline executes default pipeline end-to-end matching full contract structure", async () => {
  const pipeline = createSeoPipeline();
  const result = await pipeline.execute(seoContentMockInput);

  assert.equal(result.productTitle, seoContentMockInput.title);
  assert.equal(result.productDescription, seoContentMockInput.description);
  assert.equal(result.productSeoTitle, seoContentMockInput.title.slice(0, 70));
  assert.equal(result.productSeoDescription, seoContentMockInput.description.slice(0, 160));
  assert.equal(result.productHandle, seoContentMockInput.handle);
  assert.equal(result.images.length, seoContentMockInput.images.length);

  assert.equal(result.images[0].sourceUrl, seoContentMockInput.images[0].url);
  assert.equal(result.images[0].alt, seoContentMockInput.images[0].alt);
  assert.equal(result.images[0].webp.filename, `${seoContentMockInput.handle}-1.webp`);
});

test("SEO Pipeline rejects invalid stage output (null context)", async () => {
  const malformedStages: SeoPipelineStage[] = [
    {
      name: "b1",
      async execute(): Promise<SeoPipelineContext> {
        // @ts-expect-error simulating runtime error
        return null;
      },
    },
  ];

  const pipeline = createSeoPipeline(malformedStages);

  await assert.rejects(
    async () => {
      await pipeline.execute(seoContentMockInput);
    },
    (err: unknown) => {
      assert.ok(err instanceof SeoStageError);
      assert.equal(err.stageName, "b1");
      assert.match(err.message, /Stage returned an invalid context/);
      return true;
    },
  );
});

test("SEO Pipeline rejects stage that mutates or loses source reference", async () => {
  const corruptingStages: SeoPipelineStage[] = [
    {
      name: "b1",
      async execute(): Promise<SeoPipelineContext> {
        return {
          source: { ...seoContentMockInput, title: "Corrupted Title" },
        };
      },
    },
  ];

  const pipeline = createSeoPipeline(corruptingStages);

  await assert.rejects(
    async () => {
      await pipeline.execute(seoContentMockInput);
    },
    (err: unknown) => {
      assert.ok(err instanceof SeoStageError);
      assert.equal(err.stageName, "b1");
      assert.match(err.message, /Stage mutated or lost source input/);
      return true;
    },
  );
});

test("Default baseline stages populate intermediate domain-specific structures", async () => {
  let context = createInitialContext(seoContentMockInput);

  for (const stage of DEFAULT_SEO_PIPELINE_STAGES) {
    context = await stage.execute(context);
  }

  assert.ok(context.productUnderstanding);
  assert.ok(Array.isArray(context.productUnderstanding.detectedEntities));
  assert.ok(context.productUnderstanding.detectedEntities.length > 0);

  assert.ok(context.shoppingContext);
  assert.ok(Array.isArray(context.shoppingContext.targetAudience));
  assert.ok(context.shoppingContext.targetAudience.length > 0);

  assert.ok(context.searchResearch);
  assert.ok(Array.isArray(context.searchResearch.seedKeywords));
  assert.ok(Array.isArray(context.searchResearch.suggestedQueries));

  assert.ok(context.conflictResult);
  assert.ok(Array.isArray(context.conflictResult.approvedKeywords));

  assert.ok(context.contentResult);
  assert.equal(context.contentResult.productTitle, seoContentMockInput.title);

  assert.ok(context.imageResult);
  assert.equal(context.imageResult.processedImages.length, seoContentMockInput.images.length);

  const finalized = finalizePipelineOutput(context);
  assert.equal(finalized.productTitle, seoContentMockInput.title);
  assert.equal(finalized.images.length, seoContentMockInput.images.length);
});

test("wrapStageError wraps arbitrary non-error values safely", () => {
  const stringErr = wrapStageError("b3", "network timeout");
  assert.equal(stringErr.stageName, "b3");
  assert.match(stringErr.message, /network timeout/);
  assert.equal(stringErr.isRecoverable, false);

  const alreadySeoError = new SeoStageError("b4", "Conflict check error", true);
  const wrappedSame = wrapStageError("b1", alreadySeoError);
  assert.equal(wrappedSame, alreadySeoError);
  assert.equal(wrappedSame.stageName, "b4");
  assert.equal(wrappedSame.isRecoverable, true);
});

test("SEO Pipeline recovers from recoverable error in Stage B6 preserving all source images with fallbacks", async () => {
  const stagesWithFailingB6: SeoPipelineStage[] = DEFAULT_SEO_PIPELINE_STAGES.map((stage) => {
    if (stage.name === "b6") {
      return {
        name: "b6",
        async execute(): Promise<SeoPipelineContext> {
          throw new SeoStageError("b6", "WebP converter service temporarily unavailable", true);
        },
      };
    }
    return stage;
  });

  const pipeline = createSeoPipeline(stagesWithFailingB6);
  const result = await pipeline.execute(seoContentMockInput);

  assert.equal(result.images.length, seoContentMockInput.images.length);
  assert.equal(result.images[0].sourceUrl, seoContentMockInput.images[0].url);
  assert.equal(result.images[0].webp.filename, `${seoContentMockInput.handle}-1.webp`);
  assert.equal(result.images[0].alt, seoContentMockInput.images[0].alt);
  assert.equal(result.productTitle, seoContentMockInput.title);
});

test("SEO Pipeline Stage B6 respects contentResult generated by Stage B5", async () => {
  const customStages: SeoPipelineStage[] = [
    {
      name: "b5",
      async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
        return evolveContext(context, {
          contentResult: {
            productTitle: "AI Optimized Title",
            productDescription: "AI Optimized Description",
            productSeoTitle: "AI SEO Title",
            productSeoDescription: "AI SEO Description",
            productHandle: "ai-optimized-handle",
          },
        });
      },
    },
    {
      name: "b6",
      execute: executeB6ImageProcessing,
    },
  ];

  const inputWithoutAlt: SeoContentInput = {
    ...seoContentMockInput,
    images: [{ url: "https://example.com/item.jpg" }],
  };

  const pipeline = createSeoPipeline(customStages);
  const result = await pipeline.execute(inputWithoutAlt);

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].webp.filename, "ai-optimized-handle-1.webp");
  assert.equal(result.images[0].alt, "AI Optimized Title - View 1");
});

test("SEO Pipeline Stage B3 incorporates buyerIntentKeywords from shoppingContext and deduplicates seeds", async () => {
  const initial = createInitialContext(seoContentMockInput);
  const contextWithShopping = evolveContext(initial, {
    shoppingContext: {
      targetAudience: ["rug collectors"],
      suitableOccasions: ["halloween"],
      useCases: ["living room"],
      buyerIntentKeywords: ["vintage gothic decor", "gothic rugs"],
    },
  });

  const nextContext = await executeB3SearchSuggestions(contextWithShopping);
  const research = nextContext.searchResearch;

  assert.ok(research);
  assert.ok(research.seedKeywords.includes("vintage gothic decor"));
  // Ensure seeds are deduplicated
  const uniqueSeeds = new Set(research.seedKeywords);
  assert.equal(uniqueSeeds.size, research.seedKeywords.length);
  assert.equal(research.querySources["vintage gothic decor"], "buyer_intent_seed");
});

test("SEO Pipeline Stage B2 falls back to [niche] when detectedEntities is empty", async () => {
  const emptyEntitiesInput: SeoContentInput = {
    ...seoContentMockInput,
    niche: "handmade pottery",
    title: "",
  };

  const initial = createInitialContext(emptyEntitiesInput);
  const contextWithEmptyEntities = evolveContext(initial, {
    productUnderstanding: {
      ocrTexts: [],
      detectedEntities: [],
      dominantColors: [],
      visualStyle: "handmade pottery",
      productCategory: "handmade pottery",
    },
  });

  const nextContext = await executeB2ShoppingContext(contextWithEmptyEntities);
  assert.deepEqual(nextContext.shoppingContext?.buyerIntentKeywords, ["handmade pottery"]);
});

test("SEO Pipeline rejects empty custom stages array", () => {
  assert.throws(
    () => {
      createSeoPipeline([]);
    },
    (err: unknown) => {
      assert.ok(err instanceof SeoStageError);
      assert.match(err.message, /Pipeline must contain at least one stage/);
      return true;
    },
  );
});

test("SEO Pipeline Stage B4 deduplicates discarded keywords when duplicate appears repeatedly", async () => {
  const initial = createInitialContext(seoContentMockInput);
  const contextWithDuplicateResearch = evolveContext(initial, {
    searchResearch: {
      seedKeywords: ["rug", "rug", "rug"],
      suggestedQueries: ["rug ideas", "rug ideas"],
      querySources: {},
    },
  });

  const nextContext = await executeB4ConflictControl(contextWithDuplicateResearch);
  const conflict = nextContext.conflictResult;

  assert.ok(conflict);
  assert.deepEqual(conflict.approvedKeywords, ["rug", "rug ideas"]);
  assert.deepEqual(conflict.discardedKeywords, ["rug", "rug ideas"]);
  assert.equal(conflict.conflictReasons["rug"], "exact_duplicate");
});
