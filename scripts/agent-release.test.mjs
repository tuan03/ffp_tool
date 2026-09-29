import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const versionModuleUrl = new URL("../src/modules/amazon-crawler/engine/distributed/__init__.py", import.meta.url);
const installerUrl = new URL("../packaging/windows/ffp-amazon-crawler.iss", import.meta.url);
const buildScriptUrl = new URL("./build-amazon-crawler-client.ps1", import.meta.url);
const workflowUrl = new URL("../.github/workflows/release-agent.yml", import.meta.url);

test("agent release pipeline uses one version and stable asset names", async () => {
  const [versionModule, installer, buildScript, workflow] = await Promise.all([
    readFile(versionModuleUrl, "utf8"),
    readFile(installerUrl, "utf8"),
    readFile(buildScriptUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
  ]);

  const versionMatch = /^AGENT_VERSION = "(\d+\.\d+\.\d+)"$/m.exec(versionModule);
  assert.ok(versionMatch, "AGENT_VERSION must be a stable semantic version");
  assert.match(installer, /#define AppVersion GetEnv\("FFP_AGENT_VERSION"\)/);
  assert.match(installer, /AppVersion=\{#AppVersion\}/);
  assert.match(buildScript, /\$env:FFP_AGENT_VERSION = \$agentVersion/);
  assert.match(workflow, /tags:\s*\n\s*- "agent-v\*\.\*\.\*"/);
  assert.match(workflow, /FFP-Amazon-Crawler-Setup\.exe\.sha256/);
});
