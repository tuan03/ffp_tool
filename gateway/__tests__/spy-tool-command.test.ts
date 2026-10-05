import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runSpyToolCommand } from "../ads-intelligence/spy-tool";

test("Spy replaces stale responses with actionable validation errors and accepts a corrected file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spy-command-"));
  try {
    await writeFile(join(directory, "request.json"), JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", storeId: "one", shopDomain: "one.myshopify.com", runner: "codex", model: "test-model", startedAt: "2026-01-01T00:00:00Z" }));
    await writeFile(join(directory, "mcp-result.json"), '{"stale":true}');
    const invalid = await runSpyToolCommand({ directory, operation: "call", name: "ads_publish_competitor_research", serialized: '{"research":{"storeId":"one"}}' });
    assert.equal(invalid.isError, true);
    const failure = JSON.parse(await readFile(invalid.resultFile, "utf8"));
    assert.equal(failure.error.code, "SPY_INPUT_INVALID");
    assert.ok(failure.error.issues.some((issue: { path: string }) => issue.path === "shopDomain"));
    assert.equal(failure.stale, undefined);
    await assert.rejects(readFile(join(directory, "candidate.json")));
    const report = { storeId: "one", shopDomain: "one.myshopify.com", storeDomain: "one.example", observedAt: "2026-01-01T00:00:00Z", scope: { products: ["blanket"], market: "US", currency: "USD", excluded: [] }, selected: [], limitations: ["Fixture only"], websiteDerivedHypotheses: [] };
    await writeFile(join(directory, "draft.json"), JSON.stringify({ research: report }));
    const corrected = await runSpyToolCommand({ directory, operation: "call-file", name: "ads_publish_competitor_research", serialized: "draft.json" });
    assert.equal(corrected.isError, false);
    assert.equal(JSON.parse(await readFile(corrected.resultFile, "utf8")).staged, true);
    assert.equal(JSON.parse(await readFile(join(directory, "candidate.json"), "utf8")).storeId, "one");
    const traversal = await runSpyToolCommand({ directory, operation: "call-file", name: "ads_publish_competitor_research", serialized: "../outside.json" });
    assert.equal(JSON.parse(await readFile(traversal.resultFile, "utf8")).error.code, "SPY_INPUT_FILE_INVALID");
    const malformed = await runSpyToolCommand({ directory, operation: "call", name: "ads_publish_competitor_research", serialized: "{" });
    assert.equal(JSON.parse(await readFile(malformed.resultFile, "utf8")).error.code, "SPY_JSON_INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
