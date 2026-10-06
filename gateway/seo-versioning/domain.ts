export const SEO_SNAPSHOT_SCHEMA_VERSION = "seo-snapshot-v1";
export const SEO_FIELD_SET_VERSION = "seo-fields-v1";
export const SEO_VERSION_AUTHORITY = "postgresql";

export const SEO_VERSIONED_FIELDS = [
  "title",
  "descriptionHtml",
  "seo.title",
  "seo.description",
  "images[].alt",
  "aeo.metafields",
] as const;

export type SeoSnapshotSource = "BASELINE" | "BEFORE_PUBLISH" | "AFTER_PUBLISH" | "EXTERNAL_OBSERVATION";
export type SeoVersionSource = "BASELINE" | "AUTO_SEO" | "ROLLBACK" | "IMPORTED";
export type SeoProductState = "ACTIVE" | "DIRTY" | "ARCHIVED" | "DELETED";

export interface SeoImageSnapshot {
  readonly mediaGid: string;
  readonly imageUrl: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SeoContentSnapshotInput {
  readonly contentHash: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly images: readonly SeoImageSnapshot[];
  readonly aeoMetafields: Readonly<Record<string, string | null>>;
  readonly handle: string;
  readonly onlineStoreUrl: string | null;
  readonly observedCanonicalUrl: string | null;
  readonly shopifyStatus: string;
  readonly vendor: string | null;
  readonly productType: string | null;
  readonly tags: readonly string[];
  readonly extensionFields?: Readonly<Record<string, unknown>>;
}

export interface EnsureBaselineInput {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly snapshot: SeoContentSnapshotInput;
  readonly observedAt: number;
}

export interface CommitVersionInput {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly operationId: string;
  readonly expectedVersionId: string;
  readonly expectedContentHash: string;
  readonly snapshot: SeoContentSnapshotInput;
  readonly source: Exclude<SeoVersionSource, "BASELINE">;
  readonly approvedBy: string;
  readonly appliedBy: string;
  readonly appliedAt: number;
  readonly publicEffectiveAt?: number | null;
  readonly restoredFromVersionId?: string | null;
  readonly modelId?: string | null;
  readonly promptVersions?: Readonly<Record<string, string>>;
  readonly pipelineVersion?: string | null;
  readonly storeProfileVersion?: string | null;
  readonly batchId?: string | null;
  readonly jobId?: string | null;
}

export interface SeoVersionRecord {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly versionNumber: number;
  readonly snapshotId: string;
  readonly beforeSnapshotId: string | null;
  readonly predecessorVersionId: string | null;
  readonly source: SeoVersionSource;
  readonly publishOperationId: string | null;
  readonly restoredFromVersionId: string | null;
  readonly appliedAt: number;
  readonly publicEffectiveAt: number | null;
}

export interface SeoBaselineResult {
  readonly created: boolean;
  readonly version: SeoVersionRecord;
}

export type SeoCommitResult =
  | { readonly outcome: "COMMITTED"; readonly version: SeoVersionRecord }
  | { readonly outcome: "NO_CHANGE"; readonly version: SeoVersionRecord };

export interface SeoStoreVersioningFlags {
  readonly storeId: string;
  readonly readEnabled: boolean;
  readonly writeEnabled: boolean;
}

export interface RecordDraftBaseInput {
  readonly jobId: string;
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly inputContractVersion: string;
  readonly storeProfileVersion: string;
  readonly createdAt: number;
}

export interface SeoDraftPublishContext {
  readonly versionId: string;
  readonly snapshotId: string;
  readonly contentHash: string;
  readonly versionNumber: number;
}

export interface ObserveExternalChangeInput {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly snapshot: SeoContentSnapshotInput;
  readonly observedAt: number;
  readonly changedFields: readonly string[];
}

export interface SeoExternalChangeResult {
  readonly changed: boolean;
  readonly externalChangeId: string | null;
}

export interface SeoProductLifecycle {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly currentVersion: SeoVersionRecord;
  readonly currentSnapshotId: string;
  readonly currentContentHash: string;
  readonly state: SeoProductState;
  readonly shopifyStatus: string;
  readonly currentUrl: string | null;
  readonly lastSeenAt: number;
  readonly hasExternalChanges: boolean;
}

export interface SeoVersionPage {
  readonly entries: readonly SeoVersionRecord[];
  readonly total: number;
  readonly nextOffset: number | null;
}

export interface SeoVersionSnapshot {
  readonly version: SeoVersionRecord;
  readonly snapshot: SeoContentSnapshotInput;
}

export interface SeoRollbackDraftRequest {
  readonly id: string;
  readonly requestId: string;
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly basedOnVersionId: string;
  readonly basedOnSnapshotId: string;
  readonly basedOnContentHash: string;
  readonly restoredFromVersionId: string;
  readonly restoredFromSnapshotId: string;
  readonly status: "REQUESTED";
  readonly requestedBy: string;
  readonly createdAt: number;
}
