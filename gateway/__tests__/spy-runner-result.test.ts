import assert from "node:assert/strict";
import { test } from "node:test";

import { classifySpyRunnerResult } from "../ads-intelligence/spy-runner-result";

test("AGY permission denial is a failure even with SUCCESS and exit zero", () => {
  assert.equal(classifySpyRunnerResult({ runner: "agy", exitCode: 0, stdout: JSON.stringify({ status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "RunCommand" }] }), stderr: "" }), "SPY_PERMISSION_REQUIRED");
});

test("AGY validates its response envelope and explicit errors", () => {
  for (const stdout of ["", "null", "truncated{"]) assert.equal(classifySpyRunnerResult({ runner: "agy", exitCode: 0, stdout, stderr: "" }), "SPY_RUNNER_RESPONSE_INVALID");
  assert.equal(classifySpyRunnerResult({ runner: "agy", exitCode: 0, stdout: '{"status":"ERROR"}', stderr: "" }), "SPY_RUNNER_FAILED");
  assert.equal(classifySpyRunnerResult({ runner: "agy", exitCode: 0, stdout: '{"status":"SUCCESS","response":"done"}', stderr: "" }), undefined);
});

test("Codex keeps process failure and login classification", () => {
  assert.equal(classifySpyRunnerResult({ runner: "codex", exitCode: 1, stdout: "", stderr: "authentication required" }), "SPY_LOGIN_REQUIRED");
  assert.equal(classifySpyRunnerResult({ runner: "codex", exitCode: 0, stdout: "", stderr: "" }), undefined);
});
