import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileSeoConflictCorpus, checkExternalSeoKeywords, finalizeExternalSeo } from "../../src/modules/seo-content";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createCustomGptHandler } from "../custom-gpt-seo/handler";
import { processCustomGptJob } from "../custom-gpt-seo/finalizer";

test("mock Actions end-to-end persists evidence, replays research, validates and reaches Review", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "gpt-actions-"));
  const corpus = new FileSeoConflictCorpus({ filePath: path.join(folder, "corpus.json") });
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  let researchCalls = 0;
  const handler = createCustomGptHandler({ queue, actionKey: "action", adminKey: "admin", storeId: "capozen", research: async (_seeds, language) => { researchCalls++; assert.equal(language, "en-US"); return { rug: ["cotton rug"] }; }, checkKeywords: (input, keywords) => checkExternalSeoKeywords(input, keywords, corpus) });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/`;
  async function post(route: string, body: unknown, token = "action") {
    const response = await fetch(base + route, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload: unknown = await response.json();
    assert.ok(response.ok, JSON.stringify(payload));
    return payload as Record<string, unknown>;
  }
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const largeSnapshot = { variants: Array.from({ length: 1000 }, (_, index) => ({ id: String(index), title: `Variant ${index}`, description: "Original variant details. ".repeat(5) })) };
    const job = await post("admin/enqueue", { storeId: "capozen", source: "auto_seo", sourceIdentity: "123", input: { productId: "123", title: "Cotton rug", description: "Cotton rug with a geometric pattern", handle: "cotton-rug", niche: "rugs", images: [{ id: "front", url: "https://example.com/front.jpg" }] }, original: { id: "123", title: "Cotton rug", ...largeSnapshot } }, "admin");
    const snapshotResponse = await fetch(base + `admin/job?jobId=${job.id}`, { headers: { Authorization: "Bearer admin" } });
    assert.equal(snapshotResponse.status, 200);
    assert.ok((await snapshotResponse.text()).length > 90_000, "Admin snapshots can exceed the bounded Actions payload");
    const actionResponse = await fetch(base + `job?jobId=${job.id}`, { headers: { Authorization: "Bearer action" } });
    assert.equal(actionResponse.status, 200);
    assert.ok((await actionResponse.text()).length < 80_000);
    const batch = await post("claim", { requestId: "claim-1" });
    const lease = { jobId: job.id, batchId: batch.id, leaseToken: batch.leaseToken };
    await post("analysis", { ...lease, requestId: "analysis-1", payload: { physicalProductIdentity: "rug", visualEntities: "geometric pattern", sceneContext: "plain background", typography: { visibleTexts: [], styleSummary: "no text" }, shoppingContext: { targetAudience: ["homeowners"], suitableOccasions: [], useCases: ["floor decor"], buyerIntentKeywords: ["cotton rug"] }, evidence: [{ imageId: "front", observation: "Geometric pattern on the rug" }] } });
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5, language: "vi-VN" });
    const researchRequest = { ...lease, requestId: "research-1", seeds: ["rug"] };
    await post("research", researchRequest);
    await post("research", researchRequest);
    assert.equal(researchCalls, 1);
    await post("keywords", { ...lease, requestId: "keywords-1", payload: { keywords: ["geometric cotton rug"], reason: "Matches source material and visible pattern" } });
    await post("submit", { ...lease, requestId: "submit-1", payload: { draft: { productTitle: "Geometric cotton rug", intro: "A cotton rug with a geometric pattern.", bullets: [{ label: "Material", text: "Cotton" }, { label: "Design", text: "Geometric pattern" }], closing: "Explore this rug for your home.", productSeoTitle: "Geometric cotton rug", productSeoDescription: "A cotton rug with a geometric pattern for your home." }, alts: { front: "Cotton rug with geometric pattern" } } });
    assert.equal(queue.get("capozen", String(job.id)).status, "VALIDATING");
    await processCustomGptJob(queue, (input, analysis, keywords, submission) => finalizeExternalSeo(input, analysis, keywords, submission, corpus));
    assert.equal(queue.get("capozen", String(job.id)).status, "REVIEW_READY");
    await post("release", { batchId: batch.id, leaseToken: batch.leaseToken });
    assert.equal(queue.get("capozen", String(job.id)).status, "REVIEW_READY");
    assert.deepEqual(queue.reviewState("capozen", String(job.id)), {});
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(folder, { recursive: true, force: true }); }
});
