import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function prepare(t, incoming, previous = "") {
  const directory = await mkdtemp(join(tmpdir(), "ffp-gsc-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = join(directory, ".env");
  const old = join(directory, "previous.env");
  await writeFile(env, incoming); await writeFile(old, previous);
  const command = spawnSync("python", ["scripts/prepare-production-search-console.py", "--env-file", env, "--previous-env-file", old, "--redirect-uri", "https://ffp.example/api/seo-performance/oauth/callback"], { encoding: "utf8" });
  return { command, contents: await readFile(env, "utf8") };
}
test("Search Console deployment generates a stable private key and defaults off", async t => {
  const first = await prepare(t, "STORE_TEST_TOKEN=untouched\n");
  assert.equal(first.command.status, 0, first.command.stderr);
  assert.match(first.contents, /SEO_PERFORMANCE_ENABLED='false'/);
  assert.match(first.contents, /GSC_TOKEN_ENCRYPTION_KEY='[a-f0-9]{64}'/);
  assert.match(first.contents, /STORE_TEST_TOKEN=untouched/);
  const second = await prepare(t, "STORE_TEST_TOKEN=untouched\n", first.contents);
  assert.equal(second.contents, first.contents);
  assert.equal(first.command.stdout, "");
});
test("VPS OAuth values and disabled flag survive stale GitHub ENV_FILE", async t => {
  const previous = `SEO_PERFORMANCE_ENABLED=false\nGSC_CLIENT_ID=original-id\nGSC_CLIENT_SECRET=private-secret\nGSC_TOKEN_ENCRYPTION_KEY=${"a".repeat(64)}\n`;
  const result = await prepare(t, `SEO_PERFORMANCE_ENABLED=true\nGSC_CLIENT_SECRET=stale-secret\nGSC_TOKEN_ENCRYPTION_KEY=${"b".repeat(64)}\n`, previous);
  assert.equal(result.command.status, 0, result.command.stderr);
  assert.match(result.contents, /GSC_CLIENT_SECRET='private-secret'/);
  assert.match(result.contents, /SEO_PERFORMANCE_ENABLED='false'/);
  assert.doesNotMatch(result.contents, /stale-secret|bbbbbbbb/);
  assert.doesNotMatch(result.command.stdout + result.command.stderr, /private-secret/);
});
test("Invalid encryption keys fail without altering environment or exposing secrets", async t => {
  const original = "GSC_TOKEN_ENCRYPTION_KEY=bad-private-key\n";
  const result = await prepare(t, original);
  assert.notEqual(result.command.status, 0);
  assert.equal(result.contents, original);
  assert.doesNotMatch(result.command.stderr, /bad-private-key/);
});
test("Deploy preserves OAuth configuration before replacing the environment", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /prepare-production-search-console\.py/);
  assert.match(workflow, /EXISTING_SEARCH_CONSOLE_ENV_FILE/);
  assert.ok(workflow.indexOf('> "$EXISTING_SEARCH_CONSOLE_ENV_FILE"') < workflow.indexOf('base64 -d > .env'));
});
