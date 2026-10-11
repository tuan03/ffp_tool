import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireCustomGptSync, finishFailedCustomGptSync } from "../../scripts/custom-gpt-sync-guard";

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

test("uncertain permits require explicit reconciliation before changing approval or starting another write", async () => {
  for (const status of ["UNKNOWN", "SYNCING", "SYNCED"]) {
    await assert.rejects(acquireCustomGptSync({
      isApproved: true, isCheckpointUnchanged: false, readState: async () => ({ status }),
      saveApproval: async () => assert.fail("must not change fenced approval"),
      beginSync: async () => assert.fail("must not retry a fenced write"),
    }), /SYNC_RECONCILIATION_REQUIRED/);
  }
});

test("explicit crawler reconciliation reuses the uncertain fenced write permit", async () => {
  const token = await acquireCustomGptSync({
    isApproved: true,
    isCheckpointUnchanged: false,
    isExplicitReconciliation: true,
    readState: async () => ({ token: "existing-token", status: "UNKNOWN" }),
    saveApproval: async () => assert.fail("must not replace the existing approval"),
    beginSync: async () => assert.fail("must not acquire a second write permit"),
  });
  assert.equal(token, "existing-token");
});

test("failure settlement releases only a proven fresh no-write and retains prior uncertainty", async () => {
  for (const [hasStartedWrite, hasUnresolvedPriorWrite, expected] of [
    [false, false, "NOT_STARTED"], [true, false, "UNKNOWN"], [false, true, "UNKNOWN"],
  ] as const) {
    let status = "";
    const requiresReconciliation = await finishFailedCustomGptSync({ hasStartedWrite, hasUnresolvedPriorWrite,
      finishSync: async outcome => { status = outcome; } });
    assert.equal(status, expected);
    assert.equal(requiresReconciliation, expected === "UNKNOWN");
  }
  assert.equal(await finishFailedCustomGptSync({ hasStartedWrite: false, hasUnresolvedPriorWrite: false,
    finishSync: async () => { throw new Error("unavailable"); } }), true);
});
