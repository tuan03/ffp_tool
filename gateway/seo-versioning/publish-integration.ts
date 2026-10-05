import type { WorkerSql } from "../seo-worker/database";
import type { PublishFields, PublishOperation } from "../seo-worker/publish-repository";

import { createCanonicalSeoSnapshot } from "./canonical-snapshot";
import type { SeoContentSnapshotInput, SeoDraftPublishContext, SeoVersionSource } from "./domain";
import { SeoVersionRepository } from "./repository";
import type { SeoContentSnapshot } from "./snapshot-types";

export interface SeoPublishPreparation {
  readonly targetSnapshot: SeoContentSnapshot;
  readonly targetVersion: number;
  readonly isNoChange: boolean;
}

function applyFields(snapshot: SeoContentSnapshot, fields: PublishFields): SeoContentSnapshot {
  const imageAlts = new Map(fields.images?.map(image => [image.id, image.altText]) ?? []);
  const metafields = new Map(snapshot.aeoMetafields.map(field => [`${field.namespace}.${field.key}`, field]));
  for (const field of fields.metafields ?? []) {
    if (field.namespace === "custom" && field.key === "seo_version") continue;
    metafields.set(`${field.namespace}.${field.key}`, {
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      value: field.value,
    });
  }
  return createCanonicalSeoSnapshot({
    ...snapshot,
    source: "POST_PUBLISH",
    title: fields.title,
    descriptionHtml: fields.descriptionHtml,
    seoTitle: fields.seo.title,
    seoDescription: fields.seo.description,
    images: snapshot.images.map(image => ({ ...image, alt: imageAlts.get(image.mediaGid) ?? image.alt })),
    aeoMetafields: [...metafields.values()],
  });
}

function toPersistenceSnapshot(snapshot: SeoContentSnapshot): SeoContentSnapshotInput {
  return {
    contentHash: snapshot.contentHash,
    title: snapshot.title,
    descriptionHtml: snapshot.descriptionHtml ?? "",
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
    images: snapshot.images.map(image => ({
      mediaGid: image.mediaGid,
      imageUrl: image.imageUrl ?? "",
      alt: image.alt,
      width: image.width,
      height: image.height,
    })),
    aeoMetafields: Object.fromEntries(snapshot.aeoMetafields.map(field => [`${field.namespace}.${field.key}`, field.value])),
    handle: snapshot.handle,
    onlineStoreUrl: snapshot.onlineStoreUrl,
    observedCanonicalUrl: snapshot.onlineStoreUrl,
    shopifyStatus: snapshot.shopifyStatus,
    vendor: snapshot.vendor,
    productType: snapshot.productType,
    tags: snapshot.tags,
    extensionFields: { shopifyUpdatedAt: snapshot.shopifyUpdatedAt },
  };
}

/** Bridges the durable publisher to the authoritative ledger without giving either layer a second allocator. */
export class SeoPublishVersioningIntegration {
  constructor(private readonly repository: SeoVersionRepository) {}

  resolveDraftBase(sql: WorkerSql, storeId: string, jobId: string,
    shopifyProductGid: string): Promise<SeoDraftPublishContext | null> {
    return this.repository.resolveDraftPublishContext(sql, storeId, jobId, shopifyProductGid);
  }

  prepare(operation: PublishOperation, snapshot: SeoContentSnapshot, remoteVersion: number | undefined): SeoPublishPreparation {
    if (!operation.basedOnVersionId || !operation.basedOnContentHash || operation.basedOnVersionNumber == null) {
      throw new Error("SEO_DRAFT_BASE_REQUIRED");
    }
    if (snapshot.contentHash !== operation.basedOnContentHash) throw new Error("CONTENT_CONFLICT");
    if (remoteVersion !== undefined && remoteVersion !== operation.basedOnVersionNumber) throw new Error("CONTENT_CONFLICT");
    const targetSnapshot = applyFields(snapshot, operation.fields);
    return {
      targetSnapshot,
      targetVersion: operation.basedOnVersionNumber + 1,
      isNoChange: targetSnapshot.contentHash === snapshot.contentHash,
    };
  }

  async commit(sql: WorkerSql, operation: PublishOperation, snapshot: SeoContentSnapshot, confirmedAt: number): Promise<{
    readonly outcome: "COMMITTED" | "NO_CHANGE";
    readonly versionId: string;
    readonly versionNumber: number;
  }> {
    if (!operation.basedOnVersionId || !operation.basedOnContentHash || !operation.operator || !operation.versionSource) {
      throw new Error("SEO_DRAFT_BASE_REQUIRED");
    }
    const result = await this.repository.commitVersionInTransaction(sql, {
      storeId: operation.storeId,
      shopifyProductGid: `gid://shopify/Product/${operation.productId}`,
      operationId: operation.id,
      expectedVersionId: operation.basedOnVersionId,
      expectedContentHash: operation.basedOnContentHash,
      snapshot: toPersistenceSnapshot(snapshot),
      source: operation.versionSource as Exclude<SeoVersionSource, "BASELINE">,
      restoredFromVersionId: operation.restoredFromVersionId,
      approvedBy: operation.operator,
      appliedBy: operation.operator,
      appliedAt: confirmedAt,
      jobId: operation.jobId,
    });
    return { outcome: result.outcome, versionId: result.version.id, versionNumber: result.version.versionNumber };
  }
}
