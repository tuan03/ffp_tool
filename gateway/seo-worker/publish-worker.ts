import { canonicalizeJson } from "../canonical-json";
import type { SeoPublishVersioningIntegration } from "../seo-versioning/publish-integration";
import type { SeoContentSnapshot } from "../seo-versioning/snapshot-types";

import { SeoWorkerError } from "./protocol";
import { normalizePublishedDescriptionHtml } from "./publish-html";
import type { PublishFields, PublishOperation, SeoPublishRepository } from "./publish-repository";

export interface SeoPublishTransport {
  read(operation: PublishOperation, phase?: "BEFORE" | "AFTER"): Promise<{ readonly version: string; readonly fields: PublishFields; readonly seoVersion?: number;
    readonly snapshot?: SeoContentSnapshot }>;
  write(operation: PublishOperation): Promise<void>;
}

function comparableFields(fields: PublishFields): string {
  return canonicalizeJson({ ...fields, descriptionHtml: normalizePublishedDescriptionHtml(fields.descriptionHtml), ...(fields.metafields ? { metafields: fields.metafields.map(field => {
    if (field.type !== "json") return field;
    try { return { ...field, value: JSON.parse(field.value) as unknown }; }
    catch { return field; }
  }) } : {}) });
}

export async function processSeoPublish(repository: SeoPublishRepository, transport: SeoPublishTransport,
  versioning?: SeoPublishVersioningIntegration): Promise<void> {
  let op = await repository.claim();
  if (!op) return;
  let hasWriteIntent = op.state === "UNCERTAIN";
  try {
    const current = await transport.read(op, hasWriteIntent ? "AFTER" : "BEFORE");
    const matches = comparableFields(current.fields) === comparableFields(op.fields);
    if (hasWriteIntent) {
      const canonicalMatches = op.basedOnVersionId == null || (current.snapshot !== undefined
        && op.targetContentHash != null && current.snapshot.contentHash === op.targetContentHash);
      if (matches && canonicalMatches) await repository.confirmWithSnapshot(op, current.snapshot);
      else await repository.block(op, "RECONCILIATION_REQUIRED");
      return;
    }
    if (current.version !== op.sourceVersion) { await repository.block(op, "STALE_SOURCE"); return; }
    if (op.basedOnVersionId != null) {
      if (!versioning || !current.snapshot) throw new SeoWorkerError("SEO_VERSION_SNAPSHOT_REQUIRED");
      const prepared = versioning.prepare(op, current.snapshot, current.seoVersion);
      if (prepared.isNoChange) {
        await repository.confirmNoChange(op, prepared.targetSnapshot);
        return;
      }
      op = await repository.authorizeWrite(op, current.seoVersion, prepared.targetVersion, prepared.targetSnapshot.contentHash);
    } else {
      op = await repository.authorizeWrite(op, current.seoVersion);
    }
    hasWriteIntent = true;
    await transport.write(op);
    // A successful HTTP response alone is not confirmation of all intended fields.
    const confirmed = await transport.read(op, "AFTER");
    if (comparableFields(confirmed.fields) !== comparableFields(op.fields)
      || (op.basedOnVersionId != null && (!confirmed.snapshot || confirmed.snapshot.contentHash !== op.targetContentHash))) {
      await repository.block(op, "RECONCILIATION_REQUIRED"); return;
    }
    await repository.confirmWithSnapshot(op, confirmed.snapshot);
  } catch (error) {
    const code = error instanceof SeoWorkerError ? error.code : error instanceof Error ? error.message : "";
    if (code === "PUBLISH_INPUT_REJECTED") {
      await repository.rejectBeforeWrite(op, code);
      return;
    }
    if (["REVIEW_CHANGED", "PRODUCT_DELETED", "SOURCE_IMAGE_MISSING", "INVALID_SEO_VERSION", "CONTENT_CONFLICT",
      "SEO_DRAFT_BASE_REQUIRED", "SEO_VERSION_SNAPSHOT_REQUIRED", "SEO_VERSION_COMMIT_MISMATCH"].includes(code)) await repository.block(op, code);
    else await repository.defer(op, hasWriteIntent);
  }
}
