import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createTracingStages,
  parseSmokeInput,
  serializeSeoOutput,
} from "./e2e-smoke-helpers";
import { createInitialContext } from "../../src/modules/seo-content/internal/pipeline-context";
import type { SeoPipelineStage } from "../../src/modules/seo-content/internal/pipeline";

const REPOSITORY_ROOT = path.resolve("D:/workspace/ffp-tool");

test("parses a multi-image smoke fixture and resolves local image paths from the repository root", () => {
  const input = parseSmokeInput(
    {
      title: "Personalized Music Player Area Rug",
      description: "A custom area rug for music lovers.",
      niche: "personalized rug",
      handle: "personalized-music-player-area-rug",
      images: [
        { localFilePath: "src/modules/seo-content/__tests__/media/first.webp" },
        { url: "https://cdn.example.test/second.webp", alt: "Second view" },
      ],
    },
    REPOSITORY_ROOT,
  );

  assert.equal(input.images.length, 2);
  assert.equal(
    input.images[0]?.localFilePath,
    path.join(REPOSITORY_ROOT, "src/modules/seo-content/__tests__/media/first.webp"),
  );
  assert.equal(
    input.images[0]?.url,
    pathToFileURL(path.join(REPOSITORY_ROOT, "src/modules/seo-content/__tests__/media/first.webp")).toString(),
  );
  assert.equal(input.images[1]?.url, "https://cdn.example.test/second.webp");
  assert.equal(input.images[1]?.alt, "Second view");
});

test("rejects a smoke fixture without a required product field or image", () => {
  assert.throws(
    () =>
      parseSmokeInput(
        {
          title: "Incomplete product",
          description: "Description",
          niche: "rug",
          handle: "incomplete-product",
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
          title: "",
          description: "Description",
          niche: "rug",
          handle: "incomplete-product",
          images: [{ url: "https://cdn.example.test/image.webp" }],
        },
        REPOSITORY_ROOT,
      ),
    /title is required/i,
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
    title: "Music Rug",
    description: "Description",
    niche: "rug",
    handle: "music-rug",
    images: [{ url: "https://cdn.example.test/rug.webp" }],
  });

  for (const stage of tracedStages) {
    context = await stage.execute(context);
  }

  assert.equal(context.source.handle, "music-rug");
  assert.deepEqual(tracedNames, ["b1", "b2", "b3", "b4", "b5", "b6"]);
});
