import { createHash } from "node:crypto";

import {
  SEO_FIELD_SET_VERSION,
  SEO_SNAPSHOT_SCHEMA_VERSION,
} from "./snapshot-types";
import type {
  CanonicalSeoContent,
  SeoContentSnapshot,
  SeoSnapshotImage,
  SeoSnapshotInput,
  SeoSnapshotMetafield,
} from "./snapshot-types";

function normalizeLf(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeNullable(value: string | null): string | null {
  return value === null ? null : normalizeLf(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeImages(images: readonly SeoSnapshotImage[]): readonly SeoSnapshotImage[] {
  const mediaGids = new Set<string>();
  const normalized = images.map((image) => {
    const mediaGid = image.mediaGid.trim();
    if (!mediaGid || mediaGids.has(mediaGid)) {
      throw new Error(`Snapshot images require unique non-empty Media GIDs: ${image.mediaGid}`);
    }
    mediaGids.add(mediaGid);
    return {
      mediaGid,
      imageUrl: normalizeNullable(image.imageUrl),
      alt: normalizeNullable(image.alt),
      width: image.width,
      height: image.height,
    };
  });
  return normalized.sort((left, right) => compareText(left.mediaGid, right.mediaGid));
}

function normalizeMetafields(metafields: readonly SeoSnapshotMetafield[]): readonly SeoSnapshotMetafield[] {
  const identities = new Set<string>();
  const normalized = metafields.map((metafield) => {
    const namespace = metafield.namespace.trim();
    const key = metafield.key.trim();
    const identity = `${namespace}.${key}`;
    if (!namespace || !key || identities.has(identity)) {
      throw new Error(`Snapshot metafields require unique namespace/key pairs: ${identity}`);
    }
    identities.add(identity);
    return {
      namespace,
      key,
      type: normalizeNullable(metafield.type),
      value: normalizeNullable(metafield.value),
    };
  });
  // The newly tracked HTML field is absent from historical snapshots. An absent
  // Shopify value must not invalidate their hashes; a present value is versioned.
  return normalized.filter(field => !(field.namespace === "custom" && field.key === "aeo_suite_html" && field.type === null && field.value === null))
    .sort((left, right) => compareText(`${left.namespace}.${left.key}`, `${right.namespace}.${right.key}`));
}

export function buildCanonicalSeoContent(input: SeoSnapshotInput): CanonicalSeoContent {
  const images = normalizeImages(input.images);
  const aeoMetafields = normalizeMetafields(input.aeoMetafields);

  return {
    snapshotSchemaVersion: SEO_SNAPSHOT_SCHEMA_VERSION,
    fieldSetVersion: SEO_FIELD_SET_VERSION,
    title: normalizeLf(input.title),
    descriptionHtml: normalizeNullable(input.descriptionHtml),
    seo: {
      title: normalizeNullable(input.seoTitle),
      description: normalizeNullable(input.seoDescription),
    },
    images: images.map((image) => ({
      mediaGid: image.mediaGid,
      alt: image.alt,
    })),
    aeoMetafields,
  };
}

export function createCanonicalSeoSnapshot(input: SeoSnapshotInput): SeoContentSnapshot {
  const images = normalizeImages(input.images);
  const aeoMetafields = normalizeMetafields(input.aeoMetafields);
  const normalizedInput: SeoSnapshotInput = {
    ...input,
    title: normalizeLf(input.title),
    descriptionHtml: normalizeNullable(input.descriptionHtml),
    seoTitle: normalizeNullable(input.seoTitle),
    seoDescription: normalizeNullable(input.seoDescription),
    images,
    aeoMetafields,
  };
  const canonicalContent = buildCanonicalSeoContent(normalizedInput);
  const canonicalContentJson = JSON.stringify(canonicalContent);

  return {
    ...normalizedInput,
    snapshotSchemaVersion: SEO_SNAPSHOT_SCHEMA_VERSION,
    fieldSetVersion: SEO_FIELD_SET_VERSION,
    canonicalContentJson,
    contentHash: createHash("sha256").update(canonicalContentJson, "utf8").digest("hex"),
  };
}
