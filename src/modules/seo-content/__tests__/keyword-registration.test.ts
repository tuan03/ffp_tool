import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  registerSeoContentKeywords,
  unregisterSeoContentKeywords,
} from "../service";
import { FileSeoConflictCorpus } from "../internal/conflict-control/file-seo-conflict-corpus";
import type { SeoContentDetailedResult, SeoContentInput } from "../types";
import { TEST_STORE_PROFILE } from "./test-profile";

test("unregisterSeoContentKeywords releases a reservation when Shopify sync fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ffp-seo-release-"));
  const corpusPath = path.join(directory, "corpus.json");
  const conflictCorpus = new FileSeoConflictCorpus({ filePath: corpusPath });

  const input: SeoContentInput = {
    images: [],
    niche: "tote bags",
    storeProfile: TEST_STORE_PROFILE,
  };
  const detailed: SeoContentDetailedResult = {
    output: {
      productTitle: "Black Tote Bag",
      productDescription: "Black tote description",
      productSeoTitle: "Black Tote Bag",
      productSeoDescription: "Black tote description",
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
    const execution = { storeId: "test-store", productId: "amazon:parent:color:black", source: "amazon" as const, sourceIdentity: "parent:color:black", providerId: "gemini", pipelineVersion: "seo-b1-b6-v2", originalSnapshot: {} };
    await registerSeoContentKeywords(input, detailed, { execution, conflictCorpus });
    await unregisterSeoContentKeywords(input, detailed, { execution, conflictCorpus });

    const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as {
      readonly products: readonly unknown[];
    };
    assert.deepEqual(corpus.products, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
