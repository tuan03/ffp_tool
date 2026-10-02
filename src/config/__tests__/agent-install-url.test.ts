import assert from "node:assert/strict";
import test from "node:test";

import { resolveAgentInstallServerUrl } from "../agent-install-url";

test("configured agent install URL overrides a loopback browser origin", () => {
  assert.equal(resolveAgentInstallServerUrl({
    configuredUrl: "http://192.168.1.209:3010/",
    browserOrigin: "http://localhost:3010",
  }), "http://192.168.1.209:3010");
});

test("a shareable browser origin is used when no URL is configured", () => {
  assert.equal(resolveAgentInstallServerUrl({
    browserOrigin: "http://192.168.1.20:3010",
  }), "http://192.168.1.20:3010");
});

test("a loopback browser origin falls back to the public installer", () => {
  assert.equal(resolveAgentInstallServerUrl({
    browserOrigin: "http://localhost:3010",
  }), "https://ffp.b6-team.site");
});

test("configured agent install URL rejects paths and credentials", () => {
  assert.throws(() => resolveAgentInstallServerUrl({
    configuredUrl: "https://user:secret@example.test",
    browserOrigin: "http://localhost:3010",
  }), /credentials/);
  assert.throws(() => resolveAgentInstallServerUrl({
    configuredUrl: "https://example.test/subpath",
    browserOrigin: "http://localhost:3010",
  }), /origin/);
});
