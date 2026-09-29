import assert from "node:assert/strict";
import test from "node:test";

import { getAgentVersionStatus } from "../agent-version";

test("agent version status compares stable semantic versions", () => {
  assert.equal(getAgentVersionStatus("5.0.0", "5.1.0"), "outdated");
  assert.equal(getAgentVersionStatus("5.10.0", "5.9.9"), "ahead");
  assert.equal(getAgentVersionStatus("6.0.0", "5.9.9"), "ahead");
  assert.equal(getAgentVersionStatus("5.1.0", "5.1.0"), "current");
});

test("agent version status does not guess for malformed versions", () => {
  assert.equal(getAgentVersionStatus("unknown", "5.1.0"), "unknown");
  assert.equal(getAgentVersionStatus("5.1", "5.1.0"), "unknown");
  assert.equal(getAgentVersionStatus("5.1.0-beta.1", "5.1.0"), "unknown");
});
