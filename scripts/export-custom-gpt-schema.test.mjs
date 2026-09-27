import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

test("Custom GPT schema uses a configurable HTTPS origin and exposes no administration", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "https://seo.example.org"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  assert.equal(schema.servers[0].url, "https://seo.example.org");
  assert.equal(Object.keys(schema.paths).length, 16);
  assert.ok(Object.keys(schema.paths).every(route => !route.includes("admin")));
  const operationIds = Object.values(schema.paths).flatMap(path => Object.values(path).map(operation => operation.operationId));
  assert.equal(new Set(operationIds).size, operationIds.length);
});
test("Custom GPT schema rejects plaintext origins", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "http://localhost:3001"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTPS/);
});
