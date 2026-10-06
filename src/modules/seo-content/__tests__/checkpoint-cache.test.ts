import assert from "node:assert/strict";
import test from "node:test";

import { SeoCheckpointManager, type SeoCheckpointStore } from "../internal/checkpoint";
import { computeProductInputHash, computeStageHash } from "../internal/checkpoint/checkpoint-hasher";
import type { SeoCheckpoint } from "../internal/checkpoint/types";

import { TEST_STORE_PROFILE } from "./test-profile";

const INPUT = {
  images: [{ id: "hero", url: "https://cdn.example.test/hero.webp", contentFingerprint: "sha256:one" }],
  niche: "bedding",
  storeProfile: TEST_STORE_PROFILE,
};

class MemoryCheckpointStore implements SeoCheckpointStore {
  private readonly checkpoints = new Map<string, SeoCheckpoint>();
  async get(hash: string) { return this.checkpoints.get(hash) ?? null; }
  async set(checkpoint: SeoCheckpoint) { this.checkpoints.set(checkpoint.inputHash, checkpoint); }
  async delete(hash: string) { this.checkpoints.delete(hash); }
  async pruneExpired(now = Date.now()) {
    let removed = 0;
    for (const [hash, checkpoint] of this.checkpoints) {
      if (checkpoint.expiresAt <= now) { this.checkpoints.delete(hash); removed++; }
    }
    return removed;
  }
}

test("V2 checkpoint hash changes for image, niche, or profile version", () => {
  const baseline = computeProductInputHash(INPUT);
  assert.notEqual(baseline, computeProductInputHash({ ...INPUT, niche: "rugs" }));
  assert.notEqual(baseline, computeProductInputHash({ ...INPUT, images: [{ ...INPUT.images[0], contentFingerprint: "sha256:two" }] }));
  assert.notEqual(baseline, computeProductInputHash({ ...INPUT, storeProfile: { ...TEST_STORE_PROFILE, profileVersion: "2.0.1" } }));
});

test("legacy decorations do not affect V2 checkpoint hash", () => {
  const decorated = { ...INPUT, title: "FORBIDDEN", description: "FORBIDDEN", variants: [{ title: "FORBIDDEN" }] };
  assert.equal(computeProductInputHash(INPUT), computeProductInputHash(decorated));
});

test("checkpoint manager writes schema V2 and stage lineage", async () => {
  const store = new MemoryCheckpointStore();
  const manager = new SeoCheckpointManager({ store });
  const inputHash = computeProductInputHash(INPUT);
  const stageHash = computeStageHash("b1", inputHash, inputHash, "v2", "model");
  const checkpoint = await manager.recordStageSuccess(INPUT, "b1", { stageHash, durationMs: 5 });
  assert.equal(checkpoint.schemaVersion, 2);
  assert.equal(checkpoint.pipelineVersion, `seo-content-input-v2:${TEST_STORE_PROFILE.profileVersion}`);
  assert.equal((await store.get(inputHash))?.stages.b1?.stageHash, stageHash);
});
