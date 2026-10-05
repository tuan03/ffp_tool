import { canonicalizeJson } from "../canonical-json";

import { SeoWorkerError } from "./protocol";
import type { PublishFields, PublishOperation, SeoPublishRepository } from "./publish-repository";

export interface SeoPublishTransport {
  read(operation: PublishOperation): Promise<{ readonly version: string; readonly fields: PublishFields; readonly seoVersion?: number }>;
  write(operation: PublishOperation): Promise<void>;
}

function comparableFields(fields: PublishFields): string {
  return canonicalizeJson({ ...fields, ...(fields.metafields ? { metafields: fields.metafields.map(field => {
    if (field.type !== "json") return field;
    try { return { ...field, value: JSON.parse(field.value) as unknown }; }
    catch { return field; }
  }) } : {}) });
}

export async function processSeoPublish(repository: SeoPublishRepository, transport: SeoPublishTransport): Promise<void> {
  let op = await repository.claim();
  if (!op) return;
  let hasWriteIntent = op.state === "UNCERTAIN";
  try {
    const current = await transport.read(op);
    const matches = comparableFields(current.fields) === comparableFields(op.fields);
    if (hasWriteIntent) {
      if (matches) await repository.confirm(op);
      else await repository.block(op, "RECONCILIATION_REQUIRED");
      return;
    }
    if (current.version !== op.sourceVersion) { await repository.block(op, "STALE_SOURCE"); return; }
    op = await repository.authorizeWrite(op, current.seoVersion);
    hasWriteIntent = true;
    await transport.write(op);
    // A successful HTTP response alone is not confirmation of all intended fields.
    const confirmed = await transport.read(op);
    if (comparableFields(confirmed.fields) !== comparableFields(op.fields)) { await repository.block(op, "RECONCILIATION_REQUIRED"); return; }
    await repository.confirm(op);
  } catch (error) {
    if (error instanceof SeoWorkerError && ["REVIEW_CHANGED", "PRODUCT_DELETED", "SOURCE_IMAGE_MISSING", "INVALID_SEO_VERSION"].includes(error.code)) await repository.block(op, error.code);
    else await repository.defer(op, hasWriteIntent);
  }
}
