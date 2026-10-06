import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import {
  createTracingStages,
  parseSingleSmokeInput,
  parseSmokeInput,
  parseSmokeInputs,
  serializeSeoOutput,
  SMOKE_TEST_STORE_PROFILE,
} from "./e2e-smoke-helpers";
import { createInitialContext } from "../../src/modules/seo-content/internal/pipeline-context";
import type { SeoPipelineStage } from "../../src/modules/seo-content/internal/pipeline";
import { loadSmokePipelineRuntime } from "./runtime-loader";

const REPOSITORY_ROOT = path.resolve("D:/workspace/ffp-tool");

test("parses a multi-image smoke fixture with stable IDs and explicit store profile", () => {
  const input = parseSmokeInput(
    {
      niche: "personalized rug",
      images: [
        { id: "hero", url: "https://cdn.example.test/first.webp" },
        { url: "https://cdn.example.test/second.webp" },
      ],
    },
    REPOSITORY_ROOT,
  );

  assert.equal(input.images.length, 2);
  assert.equal(input.images[0]?.id, "hero");
  assert.equal(input.images[0]?.url, "https://cdn.example.test/first.webp");
  assert.equal(input.images[1]?.id, "image-2");
  assert.equal(input.images[1]?.url, "https://cdn.example.test/second.webp");
  assert.equal(input.storeProfile, SMOKE_TEST_STORE_PROFILE);
});

test("rejects a smoke fixture without a required product field or image", () => {
  assert.throws(
    () =>
      parseSmokeInput(
        {
          niche: "rug",
          images: [],
        },
        REPOSITORY_ROOT,
      ),
    /at least one image/i,
  );

  assert.throws(
    () =>
      parseSmokeInput(
        {
          niche: "",
          images: [{ url: "https://cdn.example.test/image.webp" }],
        },
        REPOSITORY_ROOT,
      ),
    /niche is required/i,
  );
});

test("serializes SEO output without binary WebP data while preserving image order", () => {
  const output = serializeSeoOutput({
    productTitle: "Music Rug",
    productDescription: "Description",
    productSeoTitle: "Music Rug | Shop",
    productSeoDescription: "A music rug.",
    productHandle: "music-rug",
    images: [
      {
        sourceUrl: "file:///first.webp",
        alt: "First rug view",
        webp: { filename: "music-rug-1.webp", data: Buffer.from("binary-payload-one") },
      },
      {
        sourceUrl: "file:///second.webp",
        alt: "Second rug view",
        webp: { filename: "music-rug-2.webp", data: Buffer.from("binary-payload-two") },
      },
    ],
  });

  assert.deepEqual(output.images.map((image) => image.webp.filename), [
    "music-rug-1.webp",
    "music-rug-2.webp",
  ]);
  assert.equal(JSON.stringify(output).includes("binary-payload"), false);
  assert.equal(JSON.stringify(output).includes("data"), false);
});

test("traces each wrapped SEO stage in pipeline order", async () => {
  const stageNames: SeoPipelineStage["name"][] = ["b1", "b2", "b3", "b4", "b5", "b6"];
  const stages: readonly SeoPipelineStage[] = stageNames.map((name) => ({
    name,
    async execute(context) {
      return context;
    },
  }));
  const tracedNames: string[] = [];
  const tracedStages = createTracingStages(stages, (trace) => {
    tracedNames.push(trace.stageName);
  });
  let context = createInitialContext({
    niche: "rug",
    images: [{ id: "rug-image", url: "https://cdn.example.test/rug.webp" }],
    storeProfile: SMOKE_TEST_STORE_PROFILE,
  });

  for (const stage of tracedStages) {
    context = await stage.execute(context);
  }

  assert.deepEqual(context.source.storeProfile, SMOKE_TEST_STORE_PROFILE);
  assert.deepEqual(tracedNames, ["b1", "b2", "b3", "b4", "b5", "b6"]);
});

test("loads default stages only after server environment initialization", async () => {
  let environmentLoaded = false;
  const expectedStages: readonly SeoPipelineStage[] = [];
  const runtime = await loadSmokePipelineRuntime({
    loadEnvironment() {
      environmentLoaded = true;
    },
    async loadPipelineModule() {
      assert.equal(environmentLoaded, true);
      return {
        DEFAULT_SEO_PIPELINE_STAGES: expectedStages,
        createSeoPipeline: () => {
          throw new Error("Not used in this test");
        },
      };
    },
    async loadSiteNicheRuntime() {
      assert.equal(environmentLoaded, true);
      return {
        getDefaultSiteNicheResolver: () => ({
          resolve: async () => ({ niche: "rug", source: "fallback" as const }),
        }),
      };
    },
  });

  assert.equal(runtime.stages, expectedStages);
});

test("parses an array of multiple products via parseSmokeInputs", () => {
  const inputs = parseSmokeInputs(
    [
      {
        niche: "rug",
        images: [{ url: "https://example.com/1.webp" }],
      },
      {
        niche: "blanket",
        images: [{ id: "second", url: "https://example.com/2.webp" }],
      },
    ],
    REPOSITORY_ROOT,
  );

  assert.equal(inputs.length, 2);
  assert.equal(inputs[0]?.niche, "rug");
  assert.equal(inputs[1]?.niche, "blanket");
  assert.equal(inputs[1]?.images[0]?.id, "second");
});

test("parses an object with items array via parseSmokeInputs", () => {
  const inputs = parseSmokeInputs(
    {
      items: [
        {
          niche: "rug",
          images: [{ url: "https://example.com/wrapped.webp" }],
        },
      ],
    },
    REPOSITORY_ROOT,
  );

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.niche, "rug");
});

test("rejects empty arrays in parseSmokeInputs", () => {
  assert.throws(
    () => parseSmokeInputs([], REPOSITORY_ROOT),
    /contain at least one product/i,
  );
  assert.throws(
    () => parseSmokeInputs({ items: [] }, REPOSITORY_ROOT),
    /contain at least one product/i,
  );
});
