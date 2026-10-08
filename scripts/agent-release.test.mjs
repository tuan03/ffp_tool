import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";

const versionModuleUrl = new URL("../src/modules/amazon-crawler/engine/distributed/__init__.py", import.meta.url);
const installerUrl = new URL("../packaging/windows/ffp-amazon-crawler.iss", import.meta.url);
const buildScriptUrl = new URL("./build-amazon-crawler-client.ps1", import.meta.url);
const workflowUrl = new URL("../.github/workflows/release-agent.yml", import.meta.url);

test("release bootstrap rejects HTTP and missing trust pins before download", { skip: process.platform !== "win32" }, () => {
  for (const [serverUrl, expected] of [
    ["http://crawler.invalid", /HTTPS URL/],
    ["https://crawler.invalid", /FFP_AGENT_TRUSTED_SIGNERS/],
  ]) {
    const processResult = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-agent.ps1", "-ServerUrl", serverUrl,
    ], { encoding: "utf8", env: { ...process.env, FFP_AGENT_TRUSTED_SIGNERS: "" } });
    assert.notEqual(processResult.status, 0);
    assert.match(processResult.stderr + processResult.stdout, expected);
  }
});

test("publication rejects invalid signer configuration", { skip: process.platform !== "win32" }, () => {
  const processResult = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/create-agent-release.ps1",
    "-Version", "5.2.2", "-TrustedSignerThumbprints", "unconfigured",
  ], { encoding: "utf8" });
  assert.notEqual(processResult.status, 0);
  assert.match(processResult.stderr + processResult.stdout, /trusted code-signing/);
});

test("Agent updater fails closed when the persistent installation config is missing", { skip: process.platform !== "win32" }, () => {
  const processResult = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/update-agent.ps1",
    "-InstallDirectory", "C:/FFP/Agent", "-ConfigPath", "C:/missing/agent.json",
    "-CommandId", "fixture-update", "-TargetVersion", "5.3.0", "-AgentProcessId", "12345",
    "-BackupDirectory", "C:/FFP/data/agent-update-backups/fixture-update", "-ManifestSha256", "a".repeat(64),
    "-DatabaseBackupSha256", "b".repeat(64),
  ], { encoding: "utf8" });
  assert.notEqual(processResult.status, 0);
  assert.match(processResult.stderr + processResult.stdout, /Persistent Agent configuration is missing/);
});

test("Agent updater restores the database and verifies the prior file set before rollback", async () => {
  const [updater, rollback] = await Promise.all([
    readFile(new URL("./update-agent.ps1", import.meta.url), "utf8"),
    readFile(new URL("./rollback-agent.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(updater, /--restore-update-database/);
  assert.match(updater, /--database-backup-sha256/);
  assert.match(updater, /startup stabilization window/);
  assert.match(rollback, /ManifestSha256/);
  assert.match(rollback, /actualFiles\.Count -ne \$expectedFiles\.Count/);
  assert.match(rollback, /Get-FileHash -LiteralPath \$filePath -Algorithm SHA256/);
});

test("Windows package never copies developer agent or proxy configuration", async () => {
  const buildScript = await readFile(buildScriptUrl, "utf8");
  assert.doesNotMatch(buildScript, /config\/amazon-crawler-agent\.json/);
  assert.doesNotMatch(buildScript, /config\/amazon-crawler-profiles\.json/);
  assert.match(buildScript, /Copy-Item -LiteralPath \$exampleConfig/);
});

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
  assert.match(installer, /OutputBaseFilename=FFP-Amazon-Crawler-Setup-\{#AppVersion\}/);
  assert.match(workflow, /FFP-Amazon-Crawler-\$agentVersion-windows-x64\.zip\.sha256/);
  assert.match(workflow, /publish-agent-zip\.py/);
  assert.match(workflow, /installer-output\/latest-zip\.json/);
  assert.match(workflow, /--draft=false --latest/);
  const [bootstrap, policy, legacyUpdater] = await Promise.all([
    readFile(new URL("./install-agent.ps1", import.meta.url), "utf8"),
    readFile(new URL("./agent-release-policy.ps1", import.meta.url), "utf8"),
    readFile(new URL("./update-agent.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(bootstrap, /Get-AgentReleasePolicy/);
  assert.match(bootstrap, /Receive-AgentReleaseArtifact/);
  assert.match(policy, /Get-AuthenticodeSignature/);
  assert.match(policy, /githubusercontent\.com/);
  assert.match(legacyUpdater, /trustedSignerThumbprints/);
  assert.match(legacyUpdater, /Receive-AgentReleaseArtifact/);
  assert.match(legacyUpdater, /Wait-Process -Id \$AgentProcessId/);
  assert.match(legacyUpdater, /Start-Process -FilePath \$exePath/);
  assert.match(installer, /update-agent\.ps1/);
  assert.match(installer, /agent-release-policy\.ps1/);
  assert.match(installer, /trustedSignerThumbprints/);
  const [clientDockerfile, clientNginx, sourcePackager] = await Promise.all([
    readFile(new URL("../deploy/client/Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../deploy/client/nginx.conf", import.meta.url), "utf8"),
    readFile(new URL("./package-agent-source.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(bootstrap, /\$ServerUrl\/agent-release-policy\.ps1/);
  assert.match(clientDockerfile, /COPY scripts\/agent-release-policy\.ps1/);
  assert.match(clientNginx, /location = \/agent-release-policy\.ps1/);
  assert.match(sourcePackager, /"scripts\/agent-release-policy\.ps1"/);
});
