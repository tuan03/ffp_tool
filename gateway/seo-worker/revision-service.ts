import { z } from "zod";

import type { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import type { GatewayDispatcher } from "../dispatcher";
import { SeoWorkerError } from "./protocol";
import type { RevisionRequest } from "./revision-repository";

/** No Shopify I/O while holding the queue's database transaction. */
export async function createSeoRevision(queue: Pick<PostgresCustomGptQueue, "get" | "revisions">,
  dispatcher: Pick<GatewayDispatcher, "dispatch">, request: RevisionRequest): Promise<{ jobId: string; previousJobId: string }> {
  const parent = await queue.get(request.storeId, request.jobId);
  const receipt = await queue.revisions.receipt(request);
  if (receipt) return receipt;
  const productId = parent.input.productId?.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!productId || !/^\d+$/.test(productId)) throw new SeoWorkerError("REVISION_PRODUCT_REQUIRED");
  const response = await dispatcher.dispatch({ storeId: request.storeId, operation: "products.get", payload: { id: `gid://shopify/Product/${productId}` } });
  if (!response.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
  const parsed = z.object({ product: z.object({ id: z.string(), title: z.string().min(1), handle: z.string(), descriptionHtml: z.string(),
    updatedAt: z.string().min(1), images: z.array(z.object({ id: z.string(), url: z.string(), altText: z.string().optional() })) }).passthrough().nullable() }).safeParse(response.data);
  if (!parsed.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
  const product = parsed.data.product;
  if (!product) throw new SeoWorkerError("PRODUCT_DELETED");
  if (product.id.replace(/^gid:\/\/shopify\/Product\//, "") !== productId) throw new SeoWorkerError("SOURCE_MISMATCH");
  return queue.revisions.create(request, parent, { original: product, input: { ...parent.input, productId,
    title: product.title, description: product.descriptionHtml, handle: product.handle,
    images: product.images.map(image => ({ id: image.id, url: image.url, alt: image.altText })) } });
}
