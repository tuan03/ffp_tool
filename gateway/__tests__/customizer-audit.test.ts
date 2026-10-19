import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { resolveStoreProfile } from "../../src/modules/seo-content";
import { normalizeSeoEnqueue } from "../custom-gpt-seo/input-contract";
import { applyCustomizerAudit, getCustomizerAuditContext, validateCustomizerAuditSubmission } from "../seo-worker/customizer-audit";
import { SeoWorkerError } from "../seo-worker/protocol";
import type { SeoWorkerRepository } from "../seo-worker/repository";
import { createWorkerWorkflow } from "../seo-worker/workflow";

const source = { hasCustomization: true, textInputs: [{ id: "name", label: "Name" }] };
const current = { hasCustomization: true, textInputs: [{ id: "generic", label: "Customize Your Item" }] };

function job(): GptSeoJob {
  const profile = resolveStoreProfile({ storeId: "jeminise", siteDomain: "jeminise.com" });
  assert.ok(profile);
  const original = { crawlerCustomizerAuditVersion: 1, customization: current, customizationAuditSource: source };
  const normalized = normalizeSeoEnqueue({
    input: { images: [{ id: "first", url: "https://cdn.shopify.com/first.jpg" }], niche: "Blanket", storeProfile: profile },
    execution: { storeId: "jeminise", source: "amazon", sourceIdentity: "amazon:item", providerId: "codex_mcp",
      pipelineVersion: "seo-worker-v2", originalSnapshot: original },
  });
  return { ...normalized, id: "job", storeId: "jeminise", source: "amazon", sourceIdentity: "amazon:item",
    original, inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1,
      language: "English", instructions: "" }, status: "IN_PROGRESS", checkpoints: {}, createdAt: 1, updatedAt: 1 };
}

test("customizer audit exposes current and source JSON with a stable first-image contract", () => {
  const context = getCustomizerAuditContext(job());
  assert.ok(context);
  assert.equal(context.firstImageId, "first");
  assert.equal(context.hasCurrentJson, true);
  assert.equal(context.hasSourceJson, true);
  assert.deepEqual(context.current, current);
  assert.deepEqual(context.source, source);
});

test("customizer audit restores only the exact source snapshot", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(target, { version: 1, sourceHash: context.sourceHash,
    outcome: "mismatched", action: "restore_source", confidence: 0.96, reason: "Source control matches the editable name evidence",
    imageEvidence: { imageId: "first", observation: "The primary design shows a dedicated editable-name area" },
    sourceEvidence: ["source.textInputs[name]"] });
  assert.deepEqual(validated?.normalizedCustomization, source);
  assert.deepEqual(applyCustomizerAudit({ customization: current }, validated).customization, source);
});

test("customizer audit fails closed for unsupported destructive decisions", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  for (const proposal of [
    { outcome: "uncertain", action: "remove_customizer", confidence: 1, sourceEvidence: ["generic"] },
    { outcome: "redundant", action: "remove_customizer", confidence: 0.89, sourceEvidence: ["generic"] },
    { outcome: "missing", action: "restore_source", confidence: 1, sourceEvidence: [] },
  ]) {
    assert.throws(() => validateCustomizerAuditSubmission(target, { version: 1, sourceHash: context.sourceHash,
      reason: "Unsafe proposal", imageEvidence: { imageId: "first", observation: "Insufficient evidence" }, ...proposal }),
    (error: unknown) => error instanceof SeoWorkerError && error.code === "CUSTOMIZER_AUDIT_UNSAFE");
  }
});

test("legacy and auto SEO jobs do not receive crawler customizer audit", () => {
  const target = job();
  assert.equal(getCustomizerAuditContext({ ...target, execution: { ...target.execution, source: "auto_seo" } }), undefined);
  assert.equal(getCustomizerAuditContext({ ...target, execution: { ...target.execution, originalSnapshot: {} } }), undefined);
});

test("SEO submission requires and checkpoints the customizer audit for versioned crawler jobs", async () => {
  const target = job();
  let saved: unknown;
  const repository = {
    checkpointReceipt: async () => null,
    readJob: async () => target,
    saveCheckpoint: async (_token: string, _lease: unknown, input: { payload: unknown }) => {
      saved = input.payload;
      return { status: "VALIDATING" };
    },
  } as unknown as SeoWorkerRepository;
  const workflow = createWorkerWorkflow(repository, { checkSource: async () => undefined });
  const lease = { jobId: target.id, runId: "run", sessionId: "session", leaseId: "lease",
    leaseVersion: 1, expiresAt: 10 };
  const context = await workflow.context("token", lease);
  assert.ok(context.customizerAudit);
  const draft = { draft: { productTitle: "Preserved SEO" }, alts: {} };
  await assert.rejects(workflow.submit("token", lease, "missing", draft),
    (error: unknown) => error instanceof SeoWorkerError && error.code === "CUSTOMIZER_AUDIT_REQUIRED");
  const customizerAudit = { version: 1 as const, sourceHash: context.customizerAudit.sourceHash,
    outcome: "uncertain" as const, action: "keep_current" as const, confidence: 0.5,
    reason: "The image does not prove whether the sample text is editable",
    imageEvidence: { imageId: "first", observation: "Visible text could be fixed artwork" },
    sourceEvidence: ["current text input is generic"] };
  await workflow.submit("token", lease, "complete", { ...draft, customizerAudit });
  assert.deepEqual((saved as { customizerAudit: { normalizedCustomization: unknown } }).customizerAudit.normalizedCustomization, current);
});
