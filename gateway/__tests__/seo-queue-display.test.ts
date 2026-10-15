import assert from "node:assert/strict";
import test from "node:test";

import { buildQueueDisplay } from "../custom-gpt-seo/queue-display";

test("queue display exposes only short source labels and checkpoint names, not payloads", () => {
  const original = { title: "  A grounded product title  ", handle: "product-handle", privateField: "must-not-leak" };
  const checkpoints = { research: { privatePayload: "must-not-leak" }, analysis: { notes: "must-not-leak" } };
  assert.deepEqual(buildQueueDisplay({ original, checkpoints }), {
    sourceTitle: "A grounded product title", sourceHandle: "product-handle", checkpointStages: ["analysis", "research"],
  });
  assert.doesNotMatch(JSON.stringify(buildQueueDisplay({ original, checkpoints })), /must-not-leak/);
  assert.equal(original.title, "  A grounded product title  ");
});

test("queue display tolerates missing or malformed snapshots and bounds label size", () => {
  for (const original of [null, [], "unexpected", { title: 12, handle: null }]) {
    assert.deepEqual(buildQueueDisplay({ original, checkpoints: {} }), { sourceTitle: null, sourceHandle: null, checkpointStages: [] });
  }
  assert.equal(buildQueueDisplay({ original: { sourceTitle: "Fallback title" }, checkpoints: {} }).sourceTitle, "Fallback title");
  assert.equal(buildQueueDisplay({ original: { title: "a".repeat(2000) }, checkpoints: {} }).sourceTitle?.length, 500);
});
