import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireCustomGptSync } from "../../scripts/custom-gpt-sync-guard";

test("confirmed Shopify checkpoint resumes completed sync bookkeeping without acquiring another write", async () => {
  const token = await acquireCustomGptSync({ isApproved: true, isCheckpointUnchanged: true, readState: async () => ({ status: "SYNCED" }), saveApproval: async () => assert.fail("must not alter completed approval"), beginSync: async () => assert.fail("must not acquire a duplicate write") });
  assert.equal(token, undefined);
});

test("changed or uncertain Shopify checkpoints still require a fenced write permit", async () => {
  for (const [isCheckpointUnchanged, status] of [[false, "SYNCED"], [true, "UNKNOWN"], [true, "SYNCING"]] as const) {
    await assert.rejects(acquireCustomGptSync({ isApproved: true, isCheckpointUnchanged, readState: async () => ({ status }), saveApproval: async () => undefined, beginSync: async () => { throw new Error("Sync requires reconciliation"); } }), /reconciliation/);
  }
});

test("unapproved coordinator reviews never request a write permit", async () => {
  await assert.rejects(acquireCustomGptSync({ isApproved: false, isCheckpointUnchanged: true, readState: async () => assert.fail("approval first"), saveApproval: async () => assert.fail("approval first"), beginSync: async () => assert.fail("approval first") }), /approved/);
});
