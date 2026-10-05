import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release policy rejects unsafe or damaged Agent installers before preserving a verified artifact", {
  skip: process.platform !== "win32",
}, () => {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    "Import-Module Microsoft.PowerShell.Utility; & './scripts/test-agent-release-policy.ps1'",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /PASS: release manifest, compatibility, signature\/hash\/size, low disk and partial download gates\./);
});
