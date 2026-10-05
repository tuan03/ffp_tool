import {
  SEO_FIELD_SET_VERSION,
  SEO_SNAPSHOT_SCHEMA_VERSION,
} from "./domain";

export {
  SEO_FIELD_SET_VERSION,
  SEO_SNAPSHOT_SCHEMA_VERSION,
} from "./domain";

export const PUBLISHED_AEO_METAFIELDS = [
  { namespace: "custom", key: "aeo_quick_summary" },
  { namespace: "custom", key: "aeo_faq" },
  { namespace: "custom", key: "aeo_json_ld" },
] as const;

export type SeoSnapshotSource = "BASELINE" | "PRE_PUBLISH" | "POST_PUBLISH" | "EXTERNAL_OBSERVATION";

export interface SeoSnapshotImage {
  readonly mediaGid: string;
  readonly imageUrl: string | null;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SeoSnapshotMetafield {
  readonly namespace: string;
  readonly key: string;
  readonly type: string | null;
  readonly value: string | null;
}

export interface SeoSnapshotInput {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly capturedAtUtc: string;
  readonly source: SeoSnapshotSource;
  readonly title: string;
  readonly descriptionHtml: string | null;
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly images: readonly SeoSnapshotImage[];
  readonly aeoMetafields: readonly SeoSnapshotMetafield[];
  readonly handle: string;
  readonly onlineStoreUrl: string | null;
  readonly shopifyStatus: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor: string | null;
  readonly productType: string | null;
  readonly tags: readonly string[];
  readonly shopifyUpdatedAt: string;
}

export interface CanonicalSeoContent {
  readonly snapshotSchemaVersion: typeof SEO_SNAPSHOT_SCHEMA_VERSION;
  readonly fieldSetVersion: typeof SEO_FIELD_SET_VERSION;
  readonly title: string;
  readonly descriptionHtml: string | null;
  readonly seo: {
    readonly title: string | null;
    readonly description: string | null;
  };
  readonly images: readonly {
    readonly mediaGid: string;
    readonly alt: string | null;
  }[];
  readonly aeoMetafields: readonly SeoSnapshotMetafield[];
}

export interface SeoContentSnapshot extends SeoSnapshotInput {
  readonly snapshotSchemaVersion: typeof SEO_SNAPSHOT_SCHEMA_VERSION;
  readonly fieldSetVersion: typeof SEO_FIELD_SET_VERSION;
  readonly canonicalContentJson: string;
  readonly contentHash: string;
}

export type SeoSnapshotReadErrorCode =
  | "SHOPIFY_READ_FAILED"
  | "PRODUCT_NOT_FOUND"
  | "MALFORMED_SHOPIFY_RECORD"
  | "INCOMPLETE_MEDIA"
  | "GRAPHQL_ERROR";

export class SeoSnapshotReadError extends Error {
  public readonly code: SeoSnapshotReadErrorCode;

  public constructor(code: SeoSnapshotReadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeoSnapshotReadError";
    this.code = code;
  }
}
