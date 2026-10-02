import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { runCustomGptTick } from "../custom-gpt-seo/runtime";

test("Custom GPT tick recovers Auto SEO handoffs before processing queued jobs", async () => {
  const calls: string[] = [];
  await runCustomGptTick({
    recoverAutoSeoHandoffs: async () => { calls.push("recover"); },
    processCustomGptJob: async () => { calls.push("process"); },
    logAutoSeoRecoveryFailure: () => { assert.fail("recovery succeeded"); },
  });
  assert.deepEqual(calls, ["recover", "process"]);
});

test("Auto SEO recovery failure is logged and does not block Custom GPT queue processing", async () => {
  const calls: string[] = [];
  const failure = new Error("PostgreSQL unavailable");
  await runCustomGptTick({
    recoverAutoSeoHandoffs: async () => { calls.push("recover"); throw failure; },
    processCustomGptJob: async () => { calls.push("process"); },
    logAutoSeoRecoveryFailure: error => { assert.equal(error, failure); calls.push("log"); },
  });
  assert.deepEqual(calls, ["recover", "log", "process"]);
});

test("Custom GPT job processing errors still reject the tick", async () => {
  const failure = new Error("queue storage failed");
  await assert.rejects(runCustomGptTick({
    recoverAutoSeoHandoffs: async () => {},
    processCustomGptJob: async () => { throw failure; },
    logAutoSeoRecoveryFailure: () => { assert.fail("recovery succeeded"); },
  }), error => error === failure);
});

test("runtime catch does not acknowledge or mutate Auto SEO handoffs", async () => {
  const queueDb = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(queueDb);
  let acknowledgments = 0;
  let queuedJobsProcessed = 0;
  try {
    await runCustomGptTick({
      recoverAutoSeoHandoffs: () => recoverAutoSeoHandoffs({
        async findPendingBackups() { throw new Error("PostgreSQL read failed"); },
        async acknowledgePendingHandoff() { acknowledgments++; },
        async failPendingHandoff() { acknowledgments++; },
      }, queue),
      processCustomGptJob: async () => { queuedJobsProcessed++; },
      logAutoSeoRecoveryFailure: () => {},
    });
    assert.equal(acknowledgments, 0);
    assert.equal(queue.list("capozen").length, 0);
    assert.equal(queuedJobsProcessed, 1);
  } finally { queueDb.close(); }
});

test("recovery can resume on the next tick after a temporary failure", async () => {
  let attempts = 0;
  let processed = 0;
  const dependencies = {
    recoverAutoSeoHandoffs: async () => { attempts++; if (attempts === 1) throw new Error("temporary outage"); },
    processCustomGptJob: async () => { processed++; },
    logAutoSeoRecoveryFailure: () => {},
  };
  await runCustomGptTick(dependencies);
  await runCustomGptTick(dependencies);
  assert.equal(attempts, 2);
  assert.equal(processed, 2);
});
