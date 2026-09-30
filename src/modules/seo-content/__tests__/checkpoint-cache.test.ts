import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test, { describe } from "node:test";

import {
  computeProductInputHash,
  computeStageHash,
  FileSeoCheckpointStore,
  InMemorySeoCheckpointStore,
  SEO_CHECKPOINT_TTL_MS,
  SeoCheckpointManager,
} from "../internal/checkpoint";
import { createSeoPipeline } from "../internal/pipeline";
import { evolveContext } from "../internal/pipeline-context";
import { SeoStageError } from "../internal/pipeline-errors";
import type { SeoContentInput } from "../types";

describe("R1: Stage Checkpoint & Multi-Stage Cache Engine", () => {
  const sampleInputA: SeoContentInput = {
    storeId: "capozen",
    productId: "prod-101",
    handle: "halloween-black-cat-area-rug",
    title: "Halloween Black Cat Area Rug",
    description: "Spooky gothic black cat rug for living room and bedroom decor.",
    niche: "home-decor",
    images: [
      { url: "https://example.com/cat-front.jpg" },
      { url: "https://example.com/cat-detail.jpg" },
    ],
  };

  describe("Product Identity Hashing (computeProductInputHash)", () => {
    test("normalizes text fields but preserves hero/gallery image order", () => {
      const hash1 = computeProductInputHash(sampleInputA);

      // Whitespace/casing changes are normalized, but image order is semantic.
      const sampleInputB: SeoContentInput = {
        niche: " HOME-DECOR ",
        handle: " Halloween-Black-Cat-Area-Rug ",
        title: "Halloween Black Cat Area Rug",
        description: "Spooky gothic black cat rug for living room and bedroom decor.",
        productId: "prod-101",
        storeId: "CAPOZEN",
        images: [
          { url: "https://example.com/cat-front.jpg" },
          { url: "https://example.com/cat-detail.jpg" },
        ],
      };
      const hash2 = computeProductInputHash(sampleInputB);

      assert.equal(hash1, hash2, "Normalized product identities must produce identical SHA-256 hashes");
      assert.notEqual(hash1, computeProductInputHash({
        ...sampleInputB,
        images: [...sampleInputB.images].reverse(),
      }), "Changing the hero/gallery order must invalidate the SEO cache");
    });

    test("generates distinct hashes for different products", () => {
      const hashA = computeProductInputHash(sampleInputA);

      const sampleDifferentTitle: SeoContentInput = {
        ...sampleInputA,
        title: "Viking Celtic Knot Quilt Bedding Set",
      };
      const hashDifferentTitle = computeProductInputHash(sampleDifferentTitle);
      assert.notEqual(hashA, hashDifferentTitle, "Different product titles must produce distinct hashes");

      const sampleDifferentStore: SeoContentInput = {
        ...sampleInputA,
        storeId: "other-store",
      };
      assert.notEqual(hashA, computeProductInputHash(sampleDifferentStore), "Different storeIds must produce distinct hashes");

      const sampleDifferentImages: SeoContentInput = {
        ...sampleInputA,
        images: [{ url: "https://example.com/other-image.jpg" }],
      };
      assert.notEqual(hashA, computeProductInputHash(sampleDifferentImages), "Different images must produce distinct hashes");
    });

    test("computeStageHash produces deterministic hash over stage parameters and upstream lineage", () => {
      const inputHash = computeProductInputHash(sampleInputA);
      const stageHash1 = computeStageHash("b1", inputHash, inputHash, "1.0.0", "gemini-2.5-flash");
      const stageHash2 = computeStageHash("b1", inputHash, inputHash, "1.0.0", "gemini-2.5-flash");
      assert.equal(stageHash1, stageHash2);

      // Changing prompt version changes stage hash
      const stageHashV2 = computeStageHash("b1", inputHash, inputHash, "2.0.0", "gemini-2.5-flash");
      assert.notEqual(stageHash1, stageHashV2);

      // Changing model changes stage hash
      const stageHashOtherModel = computeStageHash("b1", inputHash, inputHash, "1.0.0", "gemini-1.5-pro");
      assert.notEqual(stageHash1, stageHashOtherModel);

      // Changing upstream hash changes stage hash
      const stageHashDifferentUpstream = computeStageHash("b2", inputHash, "upstream-abc", "1.0.0", "gemini-2.5-flash");
      const stageHashDifferentUpstream2 = computeStageHash("b2", inputHash, "upstream-xyz", "1.0.0", "gemini-2.5-flash");
      assert.notEqual(stageHashDifferentUpstream, stageHashDifferentUpstream2);
    });
  });

  describe("7-Day TTL Retention & Checkpoint Pruning", () => {
    test("enforces 7-day retention TTL and prunes expired entries in memory store", async () => {
      const store = new InMemorySeoCheckpointStore();
      const manager = new SeoCheckpointManager({ store });

      assert.equal(manager.getTtlMs(), SEO_CHECKPOINT_TTL_MS);
      assert.equal(SEO_CHECKPOINT_TTL_MS, 7 * 24 * 60 * 60 * 1000);

      const now = Date.now();
      const inputHash = computeProductInputHash(sampleInputA);

      await manager.recordStageSuccess(sampleInputA, "b1", {
        stageHash: "hash-b1",
        durationMs: 120,
        contextUpdates: {
          productUnderstanding: {
            physicalProductIdentity: "area rug",
            visualEntities: "cat",
            sceneContext: "floor",
            typography: { visibleTexts: [], styleSummary: "gothic" },
          },
        },
      });

      // Valid checkpoint before expiry
      const loaded = await manager.loadCheckpoint(inputHash, now + 1000);
      assert.ok(loaded);
      assert.equal(loaded?.stages.b1?.status, "completed");
      assert.equal(loaded?.expiresAt, loaded!.createdAt + SEO_CHECKPOINT_TTL_MS);

      // Checkpoint expired after 7 days + 1 second
      const expiredNow = now + SEO_CHECKPOINT_TTL_MS + 1000;
      const expiredLoaded = await manager.loadCheckpoint(inputHash, expiredNow);
      assert.equal(expiredLoaded, null, "Expired checkpoint must return null on load");

      // Store pruneExpired cleans up expired records
      await manager.recordStageSuccess(sampleInputA, "b1", {
        stageHash: "hash-b1",
        durationMs: 100,
      });
      const prunedCount = await manager.pruneExpired(expiredNow);
      assert.ok(prunedCount >= 1, "pruneExpired must remove expired entries");
      assert.equal(store.size(), 0);
    });

    test("FileSeoCheckpointStore performs atomic persistence and directory creation", async () => {
      const tempDir = path.join(os.tmpdir(), `seo-checkpoint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const store = new FileSeoCheckpointStore({ baseDirectory: tempDir });
      const manager = new SeoCheckpointManager({ store });

      const inputHash = computeProductInputHash(sampleInputA);

      try {
        await manager.recordStageSuccess(sampleInputA, "b1", {
          stageHash: "file-hash-b1",
          durationMs: 250,
          contextUpdates: {
            effectiveNiche: "gothic-decor",
          },
        });

        const loaded = await manager.loadCheckpoint(inputHash);
        assert.ok(loaded);
        assert.equal(loaded?.stages.b1?.status, "completed");
        assert.equal(loaded?.stages.b1?.stageHash, "file-hash-b1");

        // Verify file exists on disk
        const files = await fs.readdir(tempDir);
        const jsonFiles = files.filter(f => f.endsWith(".json"));
        assert.equal(jsonFiles.length, 1);
        // Verify no temporary .tmp files left over
        const tmpFiles = files.filter(f => f.endsWith(".tmp"));
        assert.equal(tmpFiles.length, 0, "No temporary write files should linger");

        // Pruning on disk
        const futureNow = Date.now() + SEO_CHECKPOINT_TTL_MS + 5000;
        const pruned = await store.pruneExpired(futureNow);
        assert.equal(pruned, 1);
        const remainingFiles = await fs.readdir(tempDir);
        assert.equal(remainingFiles.filter(f => f.endsWith(".json")).length, 0);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe("Error & Retry Logging in Checkpoints", () => {
    test("records failed stage status, error details, and retry logs upon stage error", async () => {
      const store = new InMemorySeoCheckpointStore();
      const manager = new SeoCheckpointManager({ store });

      const inputHash = computeProductInputHash(sampleInputA);

      // Record stage B1 success
      await manager.recordStageSuccess(sampleInputA, "b1", {
        stageHash: "hash-b1",
        durationMs: 300,
        contextUpdates: {
          productUnderstanding: {
            physicalProductIdentity: "area rug",
            visualEntities: "black cat",
            sceneContext: "indoor",
            typography: { visibleTexts: [], styleSummary: "none" },
          },
        },
      });

      // Log a retry attempt on B2
      await manager.recordStageRetry(sampleInputA, "b2", {
        attempt: 1,
        timestamp: Date.now(),
        errorCode: "RATE_LIMIT_429",
        errorMessage: "Gemini quota exceeded",
        isRetryable: true,
        waitMs: 5000,
      });

      // Record stage B2 failure
      await manager.recordStageFailure(sampleInputA, "b2", {
        stageHash: "hash-b2",
        durationMs: 550,
        error: new SeoStageError("b2", "Gemini 429 quota exhausted after retries"),
      });

      const checkpoint = await manager.loadCheckpoint(inputHash);
      assert.ok(checkpoint);
      assert.equal(checkpoint?.stages.b1?.status, "completed");
      assert.equal(checkpoint?.stages.b2?.status, "failed");
      assert.equal(checkpoint?.stages.b2?.error?.message, "Stage B2 failed: Gemini 429 quota exhausted after retries");
      assert.equal(checkpoint?.stages.b2?.retryLogs.length, 1);
      assert.equal(checkpoint?.stages.b2?.retryLogs[0].errorCode, "RATE_LIMIT_429");
    });
  });

  describe("Checkpoint Resume (B1–B4 skipped when resuming from B5)", () => {
    test("resumes from failed stage B5 with B1–B4 loaded from cache and skipped", async () => {
      const stageRuns: Record<string, number> = {
        b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0,
      };

      let shouldB5Fail = true;

      const store = new InMemorySeoCheckpointStore();
      const manager = new SeoCheckpointManager({ store });

      const stages = (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map((name) => ({
        name,
        async execute(context: import("../internal/domain-types").SeoPipelineContext) {
          stageRuns[name]++;
          if (name === "b1") {
            return evolveContext(context, {
              productUnderstanding: {
                physicalProductIdentity: "area rug",
                visualEntities: "black cat halloween",
                sceneContext: "living room",
                typography: { visibleTexts: [], styleSummary: "none" },
              },
            });
          }
          if (name === "b2") {
            return evolveContext(context, {
              shoppingContext: {
                targetAudience: ["cat lovers"],
                suitableOccasions: ["halloween"],
                useCases: ["decor"],
                buyerIntentKeywords: ["halloween cat rug"],
              },
            });
          }
          if (name === "b3") {
            return evolveContext(context, {
              searchResearch: {
                seedKeywords: ["cat rug"],
                suggestedQueries: ["halloween cat area rug"],
                querySources: { "halloween cat area rug": "google" },
              },
            });
          }
          if (name === "b4") {
            return evolveContext(context, {
              conflictResult: {
                approvedKeywords: ["halloween black cat area rug"],
                discardedKeywords: [],
                conflictReasons: {},
                corpusRevision: 1,
              },
            });
          }
          if (name === "b5") {
            if (shouldB5Fail) {
              throw new SeoStageError("b5", "Gemini 503 Service Unavailable", false);
            }
            return evolveContext(context, {
              contentResult: {
                productTitle: "Halloween Black Cat Area Rug",
                productDescription: "Spooky black cat rug.",
                productSeoTitle: "Halloween Black Cat Area Rug",
                productSeoDescription: "Shop gothic black cat rug.",
                productHandle: "halloween-black-cat-area-rug",
              },
            });
          }
          if (name === "b6") {
            return evolveContext(context, {
              imageResult: { processedImages: [] },
            });
          }
          return context;
        },
      }));

      const pipeline = createSeoPipeline({
        stages,
        checkpointManager: manager,
      });

      // --- First Run: Fails at stage B5 ---
      await assert.rejects(
        pipeline.executeDetailed(sampleInputA),
        (err: unknown) => err instanceof SeoStageError && err.stageName === "b5",
      );

      // Verify B1–B4 executed once; B5 executed once; B6 never executed
      assert.deepEqual(stageRuns, {
        b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, b6: 0,
      });

      // Verify checkpoint has B1–B4 completed, and B5 failed
      const inputHash = computeProductInputHash(sampleInputA);
      const intermediateCp = await manager.loadCheckpoint(inputHash);
      assert.ok(intermediateCp);
      assert.equal(intermediateCp?.stages.b1?.status, "completed");
      assert.equal(intermediateCp?.stages.b2?.status, "completed");
      assert.equal(intermediateCp?.stages.b3?.status, "completed");
      assert.equal(intermediateCp?.stages.b4?.status, "completed");
      assert.equal(intermediateCp?.stages.b5?.status, "failed");

      // --- Second Run: B5 recovers and succeeds ---
      shouldB5Fail = false;
      const resumedResult = await pipeline.executeDetailed(sampleInputA);

      // Verify B1–B4 WERE SKIPPED (run count remains 1!)
      // B5 executed again (run count = 2)
      // B6 executed for the first time (run count = 1)
      assert.equal(stageRuns.b1, 1, "B1 must be loaded from cache and skipped on resume");
      assert.equal(stageRuns.b2, 1, "B2 must be loaded from cache and skipped on resume");
      assert.equal(stageRuns.b3, 1, "B3 must be loaded from cache and skipped on resume");
      assert.equal(stageRuns.b4, 1, "B4 must be loaded from cache and skipped on resume");
      assert.equal(stageRuns.b5, 2, "B5 must resume execution");
      assert.equal(stageRuns.b6, 1, "B6 must execute after B5 completes");

      assert.equal(resumedResult.output.productTitle, "Halloween Black Cat Area Rug");
      assert.equal(resumedResult.context.productUnderstanding?.physicalProductIdentity, "area rug");
      assert.deepEqual(resumedResult.context.conflictResult?.approvedKeywords, ["halloween black cat area rug"]);
    });
  });

  describe("Selective Cache Invalidation (B1–B4 reused when only B5 prompt/version changes)", () => {
    test("reuses B1–B4 cached results when only B5 prompt version changes, recomputing B5 and B6", async () => {
      const stageRuns: Record<string, number> = {
        b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0,
      };

      const store = new InMemorySeoCheckpointStore();
      const manager = new SeoCheckpointManager({ store });

      const stages = (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map((name) => ({
        name,
        async execute(context: import("../internal/domain-types").SeoPipelineContext) {
          stageRuns[name]++;
          if (name === "b1") {
            return evolveContext(context, {
              productUnderstanding: {
                physicalProductIdentity: "area rug",
                visualEntities: "cat",
                sceneContext: "living room",
                typography: { visibleTexts: [], styleSummary: "none" },
              },
            });
          }
          if (name === "b4") {
            return evolveContext(context, {
              conflictResult: {
                approvedKeywords: ["cat rug"],
                discardedKeywords: [],
                conflictReasons: {},
                corpusRevision: 1,
              },
            });
          }
          if (name === "b5") {
            return evolveContext(context, {
              contentResult: {
                productTitle: "Cat Rug",
                productDescription: "Cat Rug description",
                productSeoTitle: "Cat Rug SEO",
                productSeoDescription: "Cat Rug SEO Description",
                productHandle: "cat-rug",
              },
            });
          }
          if (name === "b6") {
            return evolveContext(context, {
              imageResult: { processedImages: [] },
            });
          }
          return context;
        },
      }));

      const pipeline = createSeoPipeline({
        stages,
        checkpointManager: manager,
      });

      // --- Run 1: Initial full run with default prompt versions (1.0.0) ---
      const initial = await pipeline.executeDetailed(sampleInputA);
      assert.ok(initial.output);
      assert.deepEqual(stageRuns, {
        b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, b6: 1,
      });

      // --- Run 2: Exact same input and versions -> 100% Cache HIT, zero stages re-executed ---
      const cacheRun = await pipeline.executeDetailed(sampleInputA);
      assert.ok(cacheRun.output);
      assert.deepEqual(stageRuns, {
        b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, b6: 1,
      }, "All stages should be reused from cache when hashes match");

      // --- Run 3: B5 prompt version updated from 1.0.0 -> 2.0.0 ---
      const updatedB5 = await pipeline.executeDetailed(sampleInputA, {
        promptVersions: { b5: "2.0.0" },
      });
      assert.ok(updatedB5.output);

      // B1, B2, B3, B4 must NOT be recomputed (call counts stay 1!)
      assert.equal(stageRuns.b1, 1, "B1 must be reused from cache when only B5 prompt changes");
      assert.equal(stageRuns.b2, 1, "B2 must be reused from cache when only B5 prompt changes");
      assert.equal(stageRuns.b3, 1, "B3 must be reused from cache when only B5 prompt changes");
      assert.equal(stageRuns.b4, 1, "B4 must be reused from cache when only B5 prompt changes");

      // B5 and downstream B6 MUST be recomputed (call counts increment to 2)
      assert.equal(stageRuns.b5, 2, "B5 must be recomputed when its prompt version changes");
      assert.equal(stageRuns.b6, 2, "B6 must be recomputed because its upstream stage (B5) changed");

      // Verify that after Run 3, running again with promptVersions: { b5: "2.0.0" } hits cache again
      await pipeline.executeDetailed(sampleInputA, {
        promptVersions: { b5: "2.0.0" },
      });
      assert.deepEqual(stageRuns, {
        b1: 1, b2: 1, b3: 1, b4: 1, b5: 2, b6: 2,
      }, "Running again with the updated version must hit cache");
    });

    test("changing B2 prompt version invalidates B2 through B6, while keeping B1 cached", async () => {
      const stageRuns: Record<string, number> = {
        b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0,
      };

      const store = new InMemorySeoCheckpointStore();
      const pipeline = createSeoPipeline({
        checkpointStore: store,
        stages: (["b1", "b2", "b3", "b4", "b5", "b6"] as const).map((name) => ({
          name,
          async execute(context) {
            stageRuns[name]++;
            if (name === "b5") {
              return evolveContext(context, {
                contentResult: {
                  productTitle: "Title",
                  productDescription: "Desc",
                  productSeoTitle: "Seo Title",
                  productSeoDescription: "Seo Desc",
                  productHandle: "handle",
                },
              });
            }
            return context;
          },
        })),
      });

      // Run 1: initial run
      await pipeline.executeDetailed(sampleInputA);
      assert.deepEqual(stageRuns, { b1: 1, b2: 1, b3: 1, b4: 1, b5: 1, b6: 1 });

      // Run 2: B2 prompt version changes
      await pipeline.executeDetailed(sampleInputA, {
        promptVersions: { b2: "2.0.0" },
      });

      // B1 stays cached (run count = 1)
      assert.equal(stageRuns.b1, 1, "B1 must remain cached");
      // B2..B6 are recomputed (run counts = 2)
      assert.equal(stageRuns.b2, 2, "B2 must recompute on prompt change");
      assert.equal(stageRuns.b3, 2, "B3 must recompute due to upstream B2 change");
      assert.equal(stageRuns.b4, 2, "B4 must recompute due to upstream B3 change");
      assert.equal(stageRuns.b5, 2, "B5 must recompute due to upstream B4 change");
      assert.equal(stageRuns.b6, 2, "B6 must recompute due to upstream B5 change");
    });
  });
});
