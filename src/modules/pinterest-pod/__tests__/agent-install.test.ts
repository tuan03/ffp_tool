import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentInstallDetails } from "../ui/agent-install";

test("buildAgentInstallDetails creates shareable Windows installer values", () => {
  const details = buildAgentInstallDetails("http://192.168.1.209:3010/");

  assert.equal(details.serverUrl, "http://192.168.1.209:3010");
  assert.equal(details.installerUrl, "http://192.168.1.209:3010/install-agent.ps1");
  assert.equal(
    details.powershellCommand,
    '$env:FFP_SERVER_URL="http://192.168.1.209:3010"; irm "$env:FFP_SERVER_URL/install-agent.ps1" | iex',
  );
  assert.match(details.batchFileContent, /FFP_SERVER_URL=http:\/\/192\.168\.1\.209:3010/);
  assert.equal(details.isLoopback, false);
});

test("buildAgentInstallDetails marks browser-only loopback addresses", () => {
  assert.equal(buildAgentInstallDetails("http://localhost:3010").isLoopback, true);
  assert.equal(buildAgentInstallDetails("http://127.0.0.1:3010").isLoopback, true);
  assert.equal(buildAgentInstallDetails("http://[::1]:3010").isLoopback, true);
});

test("buildAgentInstallDetails accepts only a clean HTTP server origin", () => {
  assert.throws(() => buildAgentInstallDetails("ftp://example.test"), /HTTP/);
  assert.throws(() => buildAgentInstallDetails("https://user:secret@example.test"), /credentials/);
  assert.throws(() => buildAgentInstallDetails("https://example.test/subpath"), /origin/);
  assert.throws(() => buildAgentInstallDetails("https://example.test?token=secret"), /query/);
});
