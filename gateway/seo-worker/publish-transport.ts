import { z } from "zod";

import type { GatewayDispatcher } from "../dispatcher";

import { SeoWorkerError } from "./protocol";
import type { SeoPublishTransport } from "./publish-worker";

export function createSeoPublishTransport(dispatcher: Pick<GatewayDispatcher, "dispatch">): SeoPublishTransport {
  return {
    async read(op) {
      const id = `gid://shopify/Product/${op.productId}`;
      const response = await dispatcher.dispatch({ storeId: op.storeId, operation: "products.get", payload: { id } });
      if (!response.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
      const parsed = z.object({ product: z.object({ title: z.string(), descriptionHtml: z.string().optional(), updatedAt: z.string(),
        seo: z.object({ title: z.string().optional(), description: z.string().optional() }).optional(),
        images: z.array(z.object({ id: z.string(), altText: z.string().optional() })).optional() }).nullable() }).parse(response.data);
      const product = parsed.product;
      if (!product) throw new SeoWorkerError("PRODUCT_DELETED");
      const metafields = op.fields.metafields ? await Promise.all(op.fields.metafields.map(async expected => {
        const field = await dispatcher.dispatch({ storeId: op.storeId, operation: "metafields.get", payload: { ownerId: id, namespace: expected.namespace, key: expected.key } });
        if (!field.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
        const actual = z.object({ value: z.string().nullable() }).parse(field.data);
        return { ...expected, value: actual.value ?? "" };
      })) : undefined;
      return { version: product.updatedAt, fields: { title: product.title, descriptionHtml: product.descriptionHtml ?? "",
        seo: { title: product.seo?.title ?? "", description: product.seo?.description ?? "" },
        ...(op.fields.images ? { images: op.fields.images.map(expected => {
          const image = product.images?.find(image => image.id === expected.id);
          if (!image) throw new SeoWorkerError("SOURCE_IMAGE_MISSING");
          return { id: expected.id, altText: image.altText ?? "" };
        }) } : {}), ...(metafields ? { metafields } : {}),
      } };
    },
    async write(op) {
      const response = await dispatcher.dispatch({ storeId: op.storeId, operation: "products.update", requestId: `seo-publish-${op.id}`,
        payload: { id: `gid://shopify/Product/${op.productId}`, expectedUpdatedAt: op.sourceVersion,
          product: { title: op.fields.title, descriptionHtml: op.fields.descriptionHtml, seo: op.fields.seo,
            ...(op.fields.images ? { images: op.fields.images } : {}), ...(op.fields.metafields ? { metafields: op.fields.metafields } : {}) } } });
      if (!response.success) throw new SeoWorkerError("PUBLISH_WRITE_UNCONFIRMED");
    },
  };
}
