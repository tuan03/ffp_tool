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
  const original = { crawlerCustomizerAuditVersion: 2, customization: current, customizationAuditSource: source };
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
  assert.equal(context.rendererSchema.schemaVersion, 1);
  assert.equal(context.rendererSchema.controlTypes.text, "TextInputComponent");
});

test("customizer audit restores only the exact source snapshot and verifies custom", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(target, { version: 2, sourceHash: context.sourceHash,
    outcome: "mismatched", action: "restore_source", confidence: 0.96, reason: "Source control matches the editable name evidence",
    imageEvidence: [{ imageId: "first", observation: "The primary design shows a dedicated editable-name area" }],
    sourceEvidence: ["source.textInputs[name]"] });
  assert.deepEqual(validated?.normalizedCustomization, source);
  assert.equal(validated?.auditStatus, "verified_custom");
  assert.deepEqual(applyCustomizerAudit({ customization: current }, validated), {
    customization: source,
    customizerAuditStatus: "verified_custom",
  });
});

test("customizer audit removes false-positive JSON and verifies a static design", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(target, { version: 2, sourceHash: context.sourceHash,
    outcome: "static", action: "remove_customizer", confidence: 0.97,
    reason: "The complete gallery shows fixed artwork without editable slots",
    imageEvidence: [{ imageId: "first", observation: "The design is a complete static composition" }],
    sourceEvidence: ["current control is unrelated generic input"] });
  assert.equal(validated?.auditStatus, "verified_static");
  assert.equal(validated?.normalizedCustomization, null);
});

test("customizer audit verifies static artwork when crawler correctly returned no JSON", () => {
  const target = job();
  const noCustomizerJob = {
    ...target,
    execution: {
      ...target.execution,
      originalSnapshot: {
        crawlerCustomizerAuditVersion: 2,
        customization: null,
        customizationAuditSource: null,
      },
    },
  };
  const context = getCustomizerAuditContext(noCustomizerJob);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(noCustomizerJob, {
    version: 2,
    sourceHash: context.sourceHash,
    outcome: "static",
    action: "remove_customizer",
    confidence: 0.98,
    reason: "All product images show a complete fixed design without editable targets",
    imageEvidence: [{ imageId: "first", observation: "No name, text, number, upload, or selectable item slot is present" }],
    sourceEvidence: ["current and source customizer JSON are both absent"],
  });
  assert.equal(validated?.auditStatus, "verified_static");
  assert.equal(validated?.normalizedCustomization, null);
});

test("customizer audit accepts a complete Codex-built name and number customizer", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(target, { version: 2, sourceHash: context.sourceHash,
    outcome: "mismatched", action: "rebuild_customizer", confidence: 0.96,
    reason: "The design contains separate editable name and player-number slots",
    imageEvidence: [{ imageId: "first", observation: "A sample name and number occupy two distinct variable slots" }],
    sourceEvidence: ["current contains only an unrelated generic notes field"],
    targetCustomization: {
      schemaVersion: 1,
      hasCustomization: true,
      surfaces: [],
      optionGroups: [],
      textInputs: [
        { id: "name", type: "TextInputComponent", label: "Name", required: true,
          minLength: 1, maxLength: 50, maxLines: 1, placeholder: "", instructions: "" },
        { id: "player-number", type: "TextInputComponent", label: "Player Number", required: true,
          minLength: 1, maxLength: 3, maxLines: 1, placeholder: "", instructions: "", inputMode: "numeric" },
      ],
      imageInputs: [],
      fontGroups: [],
      colorGroups: [],
      placements: [],
      conditionalRules: [],
      regexChoices: {},
      controlOrder: [
        { type: "text", id: "name" },
        { type: "text", id: "player-number" },
      ],
      componentParent: {},
      componentTypes: { name: "TextInputComponent", "player-number": "TextInputComponent" },
      assets: [],
    } });
  assert.equal(validated?.auditStatus, "verified_custom");
  assert.deepEqual(validated?.normalizedCustomization?.controlOrder, [
    { type: "text", id: "name" },
    { type: "text", id: "player-number" },
  ]);
  assert.deepEqual(validated?.normalizedCustomization?.textInputs?.map(input => ({
    id: input.id, label: input.label, inputMode: input.inputMode,
  })), [
    { id: "name", label: "Name", inputMode: undefined },
    { id: "player-number", label: "Player Number", inputMode: "numeric" },
  ]);
});

test("customizer audit rejects broken references and foreign product assets in a Codex target", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const proposal = {
    version: 2, sourceHash: context.sourceHash, outcome: "mismatched", action: "rebuild_customizer",
    confidence: 0.96, reason: "The current control does not match the editable name slot",
    imageEvidence: [{ imageId: "first", observation: "The design contains one editable name slot" }],
    sourceEvidence: ["current contains a different generic input"],
  };
  assert.throws(() => validateCustomizerAuditSubmission(target, { ...proposal, targetCustomization: {
    schemaVersion: 1, hasCustomization: true, surfaces: [], optionGroups: [], textInputs: [], imageInputs: [],
    fontGroups: [], colorGroups: [], placements: [], conditionalRules: [], regexChoices: {},
    controlOrder: [{ type: "text", id: "missing" }], componentParent: {}, componentTypes: {}, assets: [],
  } }), (error: unknown) => error instanceof SeoWorkerError && error.code === "CUSTOMIZER_AUDIT_INVALID");
  assert.throws(() => validateCustomizerAuditSubmission(target, { ...proposal, targetCustomization: {
    schemaVersion: 1, hasCustomization: true,
    product: { productImageUrl: "https://foreign.example/image.png", previewSize: 400 },
    surfaces: [], optionGroups: [], textInputs: [{ id: "name", type: "TextInputComponent", label: "Name",
      required: true, minLength: 1, maxLength: 50, maxLines: 1, placeholder: "", instructions: "" }],
    imageInputs: [], fontGroups: [], colorGroups: [], placements: [], conditionalRules: [], regexChoices: {},
    controlOrder: [{ type: "text", id: "name" }], componentParent: {},
    componentTypes: { name: "TextInputComponent" }, assets: [],
  } }), (error: unknown) => error instanceof SeoWorkerError && error.code === "CUSTOMIZER_AUDIT_UNSAFE");
});

test("customizer audit records error when required item choices cannot be reconstructed", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  const validated = validateCustomizerAuditSubmission(target, { version: 2, sourceHash: context.sourceHash,
    outcome: "error", action: "mark_error", confidence: 0.95,
    reason: "The image requires an item choice but no authoritative choice list exists",
    imageEvidence: [{ imageId: "first", observation: "The design shows a selectable character slot" }],
    sourceEvidence: ["current and source do not contain the available character choices"] });
  assert.equal(validated?.auditStatus, "error");
  assert.equal(validated?.normalizedCustomization, null);
});

test("customizer audit rejects uncertainty and unsafe destructive decisions", () => {
  const target = job();
  const context = getCustomizerAuditContext(target);
  assert.ok(context);
  for (const proposal of [
    { outcome: "uncertain", action: "keep_current", confidence: 1, sourceEvidence: ["generic"] },
    { outcome: "static", action: "remove_customizer", confidence: 0.89, sourceEvidence: ["generic"] },
    { outcome: "missing", action: "restore_source", confidence: 1, sourceEvidence: [] },
  ]) {
    assert.throws(() => validateCustomizerAuditSubmission(target, { version: 2, sourceHash: context.sourceHash,
      reason: "Unsafe proposal", imageEvidence: [{ imageId: "first", observation: "Insufficient evidence" }], ...proposal }),
    (error: unknown) => error instanceof SeoWorkerError && ["CUSTOMIZER_AUDIT_INVALID", "CUSTOMIZER_AUDIT_UNSAFE"].includes(error.code));
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
  const customizerAudit = { version: 2 as const, sourceHash: context.customizerAudit.sourceHash,
    outcome: "valid" as const, action: "keep_current" as const, confidence: 0.95,
    reason: "The current name control matches the editable design slot",
    imageEvidence: [{ imageId: "first", observation: "The design has a dedicated editable-name slot" }],
    sourceEvidence: ["current text input matches the design"] };
  await workflow.submit("token", lease, "complete", { ...draft, customizerAudit });
  assert.deepEqual((saved as { customizerAudit: { normalizedCustomization: unknown } }).customizerAudit.normalizedCustomization, current);
  assert.equal((saved as { customizerAudit: { auditStatus: unknown } }).customizerAudit.auditStatus, "verified_custom");
});
