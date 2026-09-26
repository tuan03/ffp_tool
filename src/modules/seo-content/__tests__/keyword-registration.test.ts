import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  registerSeoContentKeywords,
  unregisterSeoContentKeywords,
} from "../service";
import type { SeoContentDetailedResult, SeoContentInput } from "../types";

test("unregisterSeoContentKeywords releases a reservation when Shopify sync fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ffp-seo-release-"));
  const corpusPath = path.join(directory, "corpus.json");
  const previousPath = process.env.SEO_CONFLICT_CORPUS_PATH;
  process.env.SEO_CONFLICT_CORPUS_PATH = corpusPath;

  const input: SeoContentInput = {
    productId: "amazon:parent:color:black",
    title: "Black tote",
    description: "A black tote",
    handle: "black-tote-a1b2c3d4",
    images: [],
    niche: "tote bags",
  };
  const detailed: SeoContentDetailedResult = {
    output: {
      productTitle: "Black Tote Bag",
      productDescription: "Black tote description",
      productSeoTitle: "Black Tote Bag",
      productSeoDescription: "Black tote description",
      productHandle: input.handle,
      images: [],
    },
    metadata: {
      engine: "heuristic",
      fieldsApplied: [],
      fallbackStages: [],
      warnings: [],
      approvedKeywords: ["black tote bag"],
      corpusRevision: 0,
    },
  };

  try {
    await registerSeoContentKeywords(input, detailed);
    await unregisterSeoContentKeywords(input, detailed);

    const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as {
      readonly products: readonly unknown[];
    };
    assert.deepEqual(corpus.products, []);
  } finally {
    if (previousPath === undefined) delete process.env.SEO_CONFLICT_CORPUS_PATH;
    else process.env.SEO_CONFLICT_CORPUS_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
