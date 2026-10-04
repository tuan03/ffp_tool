import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("SEO Agent Pack safe setup, vault restrictions and heartbeat", () => {
  const result = spawnSync("python", ["-m", "unittest", "discover", "-s", "tools/seo-agent-pack", "-p", "test_helper.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
