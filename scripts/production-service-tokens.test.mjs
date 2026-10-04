import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function prepareTokens(t, incoming, previous = "") {
  const directory = await mkdtemp(join(tmpdir(), "ffp-service-tokens-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = join(directory, ".env");
  const previousPath = join(directory, "previous.env");
  await writeFile(envPath, incoming);
  await writeFile(previousPath, previous);
  const command = spawnSync("python", [
    "scripts/prepare-production-service-tokens.py",
    "--env-file", envPath,
    "--previous-env-file", previousPath,
  ], { encoding: "utf8" });
  return { command, contents: await readFile(envPath, "utf8") };
}

test("production deployment creates strong service tokens without printing them", async t => {
  const { command, contents } = await prepareTokens(t, "NODE_ENV=production\n");
  assert.equal(command.status, 0, command.stderr);
  for (const key of ["REVIEW_IMAGE_BRIDGE_TOKEN", "REVIEW_IMAGE_EXTENSION_TOKEN", "SHOPIFY_PIPELINE_TOKEN"]) {
    const token = contents.match(new RegExp(`${key}='([^']+)'`))?.[1];
    assert.ok(token && token.length >= 24, `${key} must be strong`);
    assert.doesNotMatch(command.stdout + command.stderr, new RegExp(token));
  }
});

test("production deployment preserves VPS service tokens over stale CI values", async t => {
  const previous = [
    "REVIEW_IMAGE_BRIDGE_TOKEN='existing-bridge-token-123456789'",
    "REVIEW_IMAGE_EXTENSION_TOKEN='existing-extension-token-123456'",
    "SHOPIFY_PIPELINE_TOKEN='existing-pipeline-token-1234567'",
    "",
  ].join("\n");
  const incoming = [
    "REVIEW_IMAGE_BRIDGE_TOKEN=stale",
    "REVIEW_IMAGE_EXTENSION_TOKEN=stale",
    "SHOPIFY_PIPELINE_TOKEN=stale",
    "",
  ].join("\n");
  const { command, contents } = await prepareTokens(t, incoming, previous);
  assert.equal(command.status, 0, command.stderr);
  assert.match(contents, /REVIEW_IMAGE_BRIDGE_TOKEN='existing-bridge-token-123456789'/);
  assert.match(contents, /REVIEW_IMAGE_EXTENSION_TOKEN='existing-extension-token-123456'/);
  assert.match(contents, /SHOPIFY_PIPELINE_TOKEN='existing-pipeline-token-1234567'/);
  assert.doesNotMatch(contents, /stale/);
});

test("production workflow prepares service tokens and prints server diagnostics on startup failure", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /prepare-production-service-tokens\.py/);
  assert.match(workflow, /EXISTING_SERVICE_TOKEN_ENV_FILE/);
  assert.match(workflow, /docker compose logs --no-color --tail=200 server/);
});
