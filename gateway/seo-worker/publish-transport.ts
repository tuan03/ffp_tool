import { z } from "zod";

import { GatewayError } from "../errors";
import type { GatewayDispatcher } from "../dispatcher";
import type { ShopifySeoSnapshotReader } from "../seo-versioning/shopify-snapshot-reader";

import { SeoWorkerError } from "./protocol";
import type { SeoPublishTransport } from "./publish-worker";

export function createSeoPublishTransport(dispatcher: Pick<GatewayDispatcher, "dispatch">,
  snapshotReader?: ShopifySeoSnapshotReader, now: () => Date = () => new Date()): SeoPublishTransport {
  return {
    async read(op, phase = "BEFORE") {
      const id = `gid://shopify/Product/${op.productId}`;
      const response = await dispatcher.dispatch({ storeId: op.storeId, operation: "products.get", payload: { id } });
      if (!response.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
      const parsed = z.object({ product: z.object({ title: z.string(), descriptionHtml: z.string().optional(), updatedAt: z.string(),
        seo: z.object({ title: z.string().optional(), description: z.string().optional() }).optional(),
        images: z.array(z.object({ id: z.string(), altText: z.string().optional() })).optional() }).nullable() }).parse(response.data);
      const product = parsed.product;
      if (!product) throw new SeoWorkerError("PRODUCT_DELETED");
      const versionResponse = await dispatcher.dispatch({ storeId: op.storeId, operation: "metafields.get", payload: { ownerId: id, namespace: "custom", key: "seo_version" } });
      if (!versionResponse.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
      const remoteVersion = z.object({ value: z.string().nullable(), type: z.string().optional() }).parse(versionResponse.data);
      const seoVersion = remoteVersion.value === null ? 0 : Number(remoteVersion.value);
      if (!Number.isSafeInteger(seoVersion) || seoVersion < 0 || (remoteVersion.value !== null && (!/^\d+$/.test(remoteVersion.value) || remoteVersion.type !== "number_integer"))) throw new SeoWorkerError("INVALID_SEO_VERSION");
      const metafields = op.fields.metafields ? await Promise.all(op.fields.metafields.map(async expected => {
        const field = await dispatcher.dispatch({ storeId: op.storeId, operation: "metafields.get", payload: { ownerId: id, namespace: expected.namespace, key: expected.key } });
        if (!field.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
        const actual = z.object({ value: z.string().nullable(), type: z.string().optional() }).parse(field.data);
        return { ...expected, type: actual.type ?? "", value: actual.value ?? "" };
      })) : undefined;
      const snapshot = op.basedOnVersionId == null ? undefined : await snapshotReader?.readSnapshot({
        storeId: op.storeId,
        shopifyProductGid: id,
        capturedAtUtc: now().toISOString(),
        source: phase === "AFTER" ? "POST_PUBLISH" : "PRE_PUBLISH",
      });
      return { version: product.updatedAt, seoVersion, ...(snapshot ? { snapshot } : {}), fields: { title: product.title, descriptionHtml: product.descriptionHtml ?? "",
        seo: { title: product.seo?.title ?? "", description: product.seo?.description ?? "" },
        ...(op.fields.images ? { images: op.fields.images.map(expected => {
          const image = product.images?.find(image => image.id === expected.id);
          if (!image) throw new SeoWorkerError("SOURCE_IMAGE_MISSING");
          return { id: expected.id, altText: image.altText ?? "" };
        }) } : {}), ...(metafields ? { metafields } : {}),
      } };
    },
    async write(op) {
      try {
        const response = await dispatcher.dispatch({ storeId: op.storeId, operation: "products.update", mode: "apply", requestId: `seo-publish-${op.id}`,
          payload: { id: `gid://shopify/Product/${op.productId}`, expectedUpdatedAt: op.sourceVersion,
            product: { title: op.fields.title, descriptionHtml: op.fields.descriptionHtml, seo: op.fields.seo,
              ...(op.fields.images ? { images: op.fields.images } : {}), ...(op.fields.metafields ? { metafields: op.fields.metafields } : {}) } } });
        if (!response.success) throw new SeoWorkerError("PUBLISH_WRITE_UNCONFIRMED");
      } catch (error) {
        // Only definite local input rejection is safe to mark as not written.
        // Network, Shopify user errors and partial writes remain uncertain.
        if (error instanceof GatewayError && error.code === "SHOPIFY_INVALID_INPUT" && !error.reconciliationRequired) {
          throw new SeoWorkerError("PUBLISH_INPUT_REJECTED");
        }
        throw error;
      }
    },
  };
}
