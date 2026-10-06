import type { GatewayDispatcher } from "../dispatcher";

import type { SeoContentSnapshotInput } from "./domain";
import { SeoVersionRepository } from "./repository";
import {
  createDispatcherMediaPageSource,
  createShopifySeoSnapshotReader,
} from "./shopify-snapshot-reader";
import { SeoSnapshotReadError } from "./snapshot-types";
import type { SeoContentSnapshot } from "./snapshot-types";

export interface ObserveSeoProductRequest {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly observedAt: number;
}

export type ObserveSeoProductResult =
  | {
      readonly outcome: "BASELINE_CREATED";
      readonly versionId: string;
      readonly versionNumber: 0;
      readonly contentHash: string;
    }
  | {
      readonly outcome: "UNCHANGED";
      readonly versionId: string;
      readonly versionNumber: number;
      readonly contentHash: string;
    }
  | {
      readonly outcome: "EXTERNAL_CHANGE";
      readonly versionId: string;
      readonly versionNumber: number;
      readonly contentHash: string;
      readonly externalChangeId: string;
    };

export interface SeoBaselineService {
  readonly observeProduct: (request: ObserveSeoProductRequest) => Promise<ObserveSeoProductResult>;
}

function toRepositorySnapshot(snapshot: SeoContentSnapshot): SeoContentSnapshotInput {
  if (snapshot.descriptionHtml === null) {
    throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify omitted product description HTML");
  }
  const images = snapshot.images.map((image) => {
    if (image.imageUrl === null) {
      throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", `Shopify omitted the URL for ${image.mediaGid}`);
    }
    return {
      mediaGid: image.mediaGid,
      imageUrl: image.imageUrl,
      alt: image.alt,
      width: image.width,
      height: image.height,
    };
  });
  const aeoMetafields = Object.fromEntries(snapshot.aeoMetafields.map((field) => [
    `${field.namespace}.${field.key}`,
    field.value,
  ]));

  return {
    contentHash: snapshot.contentHash,
    title: snapshot.title,
    descriptionHtml: snapshot.descriptionHtml,
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
    images,
    aeoMetafields,
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

export function createSeoBaselineService(options: {
  readonly dispatcher: Pick<GatewayDispatcher, "dispatch">;
  readonly repository: SeoVersionRepository;
}): SeoBaselineService {
  const reader = createShopifySeoSnapshotReader(
    options.dispatcher,
    createDispatcherMediaPageSource(options.dispatcher),
  );

  return {
    async observeProduct(request) {
      if (!Number.isSafeInteger(request.observedAt) || request.observedAt < 0) {
        throw new Error("OBSERVED_AT_INVALID");
      }
      const snapshot = await reader.readSnapshot({
        storeId: request.storeId,
        shopifyProductGid: request.shopifyProductGid,
        capturedAtUtc: new Date(request.observedAt).toISOString(),
        source: "BASELINE",
      });
      const repositorySnapshot = toRepositorySnapshot(snapshot);
      const baseline = await options.repository.ensureBaseline({
        storeId: request.storeId,
        shopifyProductGid: request.shopifyProductGid,
        snapshot: repositorySnapshot,
        observedAt: request.observedAt,
      });
      if (baseline.created) {
        return {
          outcome: "BASELINE_CREATED",
          versionId: baseline.version.id,
          versionNumber: 0,
          contentHash: snapshot.contentHash,
        };
      }

      const observation = await options.repository.observeExternalChange({
        storeId: request.storeId,
        shopifyProductGid: request.shopifyProductGid,
        snapshot: repositorySnapshot,
        observedAt: request.observedAt,
        changedFields: ["contentHash"],
      });
      if (!observation.changed) {
        return {
          outcome: "UNCHANGED",
          versionId: baseline.version.id,
          versionNumber: baseline.version.versionNumber,
          contentHash: snapshot.contentHash,
        };
      }
      if (observation.externalChangeId === null) {
        throw new Error("EXTERNAL_CHANGE_RECEIPT_MISSING");
      }
      return {
        outcome: "EXTERNAL_CHANGE",
        versionId: baseline.version.id,
        versionNumber: baseline.version.versionNumber,
        contentHash: snapshot.contentHash,
        externalChangeId: observation.externalChangeId,
      };
    },
  };
}
