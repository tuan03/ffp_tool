import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createSpyJobs } from "../ads-intelligence/spy-jobs";

test("Spy locks each store, snapshots the selected model and cancels without publishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  let published = 0;
  const jobs = createSpyJobs({ root, resolveStore: async storeId => ({ storeId, shopDomain: `${storeId}.myshopify.com` }),
    capabilities: async () => ({ runners: [{ id: "codex", name: "Codex", available: true, models: ["test-model"], defaultModel: "test-model" }] }),
    execute: async ({ signal }) => { await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); },
    publish: async () => { published++; }, readResearch: async () => null });
  try {
    const first = await jobs.start({ storeId: "one", runner: "codex", model: "test-model" });
    await assert.rejects(jobs.start({ storeId: "one", runner: "codex", model: "test-model" }), /SPY_ALREADY_RUNNING/);
    assert.equal(first.model, "test-model");
    assert.equal(await jobs.get("two"), null);
    await assert.rejects(jobs.cancel("two", first.id), /SPY_JOB_NOT_FOUND/);
    assert.equal((await jobs.cancel("one", first.id)).status, "cancelled");
    assert.equal(published, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Spy rejects model errors and never treats an agent exit without research as success", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  let finish: (() => void) | undefined;
  const jobs = createSpyJobs({ root, resolveStore: async storeId => ({ storeId, shopDomain: "one.myshopify.com" }),
    capabilities: async () => ({ runners: [{ id: "codex", name: "Codex", available: true, models: ["test-model"], defaultModel: "test-model" }] }),
    execute: async () => new Promise<void>(resolve => { finish = resolve; }), publish: async () => { assert.fail("Must not publish"); }, readResearch: async () => null });
  try {
    await assert.rejects(jobs.start({ storeId: "one", runner: "codex", model: "invalid" }), /SPY_MODEL_UNAVAILABLE/);
    await jobs.start({ storeId: "one", runner: "codex", model: "test-model" });
    finish?.();
    await jobs.settled("one");
    assert.equal((await jobs.get("one"))?.status, "failed");
    assert.equal((await jobs.get("one"))?.errorCode, "SPY_RESEARCH_MISSING");
    assert.ok((await jobs.get("one"))?.events?.some(event => event.level === "error" && event.message.includes("SPY_RESEARCH_MISSING")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Spy validates store identity, publishes partial coverage honestly, and retains useful old ads on an empty refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  const { competitorResearchSchema } = await import("../ads-intelligence/competitor-research");
  let wrongStore = true;
  let hasPrevious = false;
  let publications = 0;
  let release: (() => void) | undefined;
  const sample = competitorResearchSchema.parse({ storeId: "one", shopDomain: "one.myshopify.com", storeDomain: "one.example", observedAt: "2026-01-01T00:00:00Z", scope: { products: ["blanket"], excluded: ["rug"], market: "US", currency: "USD" }, selected: [{ name: "Other", domain: "other.example", productGroup: "blanket", score: 70, scoreBreakdown: { product: 40, customizationModel: 20, audience: 10, price: 0, themes: 0 }, confidence: "high", evidence: [{ url: "https://other.example/blanket", note: "Blanket" }], adStatus: "Unavailable" }], verifiedAds: [], adCollection: [{ brandDomain: "other.example", pageIds: [], identityEvidence: [], status: "identity_unresolved", retrievedCount: 0, matchedCount: 0, note: "Page not verified" }], limitations: ["No verified Page"], websiteDerivedHypotheses: [] });
  const { normalizeSnapshotAd } = await import("../ads-intelligence/competitor-client");
  const ad = normalizeSnapshotAd({ ad_archive_id: "234", page_id: "123", snapshot: { link_url: "https://other.example/blanket" } }, "123");
  const previous = competitorResearchSchema.parse({ ...sample, adCollection: [{ ...sample.adCollection?.[0], pageIds: ["123"], status: "verified_ads", retrievedCount: 1, matchedCount: 1 }], verifiedAds: [{ brandDomain: "other.example", qualificationReason: "Old verified sample", productEvidenceUrl: "https://other.example/blanket", ad }] });
  const jobs = createSpyJobs({ root, resolveStore: async storeId => ({ storeId, shopDomain: "one.myshopify.com" }), capabilities: async () => ({ runners: [{ id: "codex", name: "Codex", available: true, models: ["test-model"], defaultModel: "test-model" }] }),
    execute: async ({ job, directory }) => { await new Promise<void>(resolve => { release = resolve; }); await writeFile(join(directory, "candidate.json"), JSON.stringify({ ...sample, storeId: wrongStore ? "two" : "one", observedAt: job.startedAt })); },
    publish: async () => { publications++; }, readResearch: async () => hasPrevious ? previous : null });
  try {
    await jobs.start({ storeId: "one", runner: "codex", model: "test-model" }); release?.(); await jobs.settled("one");
    assert.equal((await jobs.get("one"))?.errorCode, "SPY_RESEARCH_INVALID"); assert.equal(publications, 0);
    wrongStore = false;
    await jobs.start({ storeId: "one", runner: "codex", model: "test-model" }); release?.(); await jobs.settled("one");
    assert.equal((await jobs.get("one"))?.status, "partial"); assert.equal(publications, 1);
    hasPrevious = true;
    await jobs.start({ storeId: "one", runner: "codex", model: "test-model" }); release?.(); await jobs.settled("one");
    assert.equal((await jobs.get("one"))?.published, false); assert.equal(publications, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Spy restart marks an unfinished job interrupted instead of reporting success", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  try {
    await writeFile(join(root, "one.json"), JSON.stringify({ id: "old", storeId: "one", status: "running" }));
    const jobs = createSpyJobs({ root, resolveStore: async storeId => ({ storeId, shopDomain: "one.myshopify.com" }), capabilities: async () => ({ runners: [] }), execute: async () => {}, publish: async () => {}, readResearch: async () => null });
    assert.equal((await jobs.get("one"))?.status, "interrupted");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scoped Spy MCP blocks another store and campaign mutation before connecting", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  const { runSpyTool } = await import("../ads-intelligence/spy-tool");
  try {
    await writeFile(join(root, "request.json"), JSON.stringify({ id: "5ad3234e-3490-4a92-b65b-0230bf622067", storeId: "one", shopDomain: "one.myshopify.com", runner: "codex", model: "test-model", startedAt: "2026-01-01T00:00:00Z" }));
    await assert.rejects(runSpyTool(root, "call", "ads_get_store_overview", { storeId: "two" }), /SPY_STORE_MISMATCH/);
    await assert.rejects(runSpyTool(root, "call", "ads_create_experiment", { storeId: "one" }), /SPY_TOOL_NOT_ALLOWED/);
    await assert.rejects(runSpyTool(root, "call", "ads_spy_progress", { phase: "fake-success" }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Spy publishes staged, media-reviewed ads and records final verified counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "spy-test-"));
  const { runSpyTool } = await import("../ads-intelligence/spy-tool");
  const { normalizeSnapshotAd } = await import("../ads-intelligence/competitor-client");
  let release: (() => void) | undefined;
  let publishedStore = "";
  const jobs = createSpyJobs({ root, resolveStore: async storeId => ({ storeId, shopDomain: "one.myshopify.com" }), capabilities: async () => ({ runners: [{ id: "codex", name: "Codex", available: true, models: ["test-model"], defaultModel: "test-model" }] }),
    execute: async ({ job, directory }) => {
      await new Promise<void>(resolve => { release = resolve; });
      const ad = { ...normalizeSnapshotAd({ ad_archive_id: "234", page_id: "123", snapshot: { link_url: "https://other.example/blanket", images: [{ original_image_url: "https://other.example/blanket.jpg" }] } }, "123"), inspectionLevel: "IMAGE_REVIEWED" };
      await runSpyTool(directory, "call", "ads_publish_competitor_research", { research: { storeId: "one", shopDomain: "one.myshopify.com", storeDomain: "one.example", observedAt: job.startedAt, scope: { products: ["blanket"], excluded: [], market: "US", currency: "USD" }, selected: [{ name: "Other", domain: "other.example", productGroup: "blanket", score: 70, scoreBreakdown: { product: 40, customizationModel: 20, audience: 10, price: 0, themes: 0 }, confidence: "high", evidence: [{ url: "https://other.example/blanket", note: "Blanket" }], adStatus: "One verified ad" }], verifiedAds: [{ brandDomain: "other.example", productEvidenceUrl: "https://other.example/blanket", qualificationReason: "Verified blanket image fixture", ad }], adCollection: [{ brandDomain: "other.example", pageIds: ["123"], identityEvidence: ["https://other.example"], status: "verified_ads", retrievedCount: 1, matchedCount: 1, note: "Page checked" }], limitations: ["Only one brand"], websiteDerivedHypotheses: [] } });
    }, publish: async research => { publishedStore = research.storeId; }, readResearch: async () => null });
  try {
    await jobs.start({ storeId: "one", runner: "codex", model: "test-model" }); release?.(); await jobs.settled("one");
    const job = await jobs.get("one");
    assert.equal(job?.status, "partial"); assert.equal(job.adCount, 1); assert.equal(job.brandsWithAds, 1); assert.equal(job.published, true); assert.equal(publishedStore, "one");
  } finally { await rm(root, { recursive: true, force: true }); }
});
