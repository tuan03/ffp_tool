import { z } from "zod";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import type { GatewayDispatcher } from "../dispatcher";

import { SeoWorkerError } from "./protocol";

/** No network request is made while holding a repository transaction. */
export function createWorkerSourceGuard(dispatcher: Pick<GatewayDispatcher, "dispatch">): (job: GptSeoJob) => Promise<void> {
  return async job => {
    if (!job.execution.productId && job.execution.source !== "auto_seo") return;
    const source = z.object({ updatedAt: z.string().min(1) }).safeParse(job.execution.originalSnapshot);
    if (!source.success) throw new SeoWorkerError("SOURCE_VERSION_REQUIRED");
    const id = job.execution.productId ?? job.execution.sourceIdentity;
    const response = await dispatcher.dispatch({ storeId: job.execution.storeId, operation: "products.get", payload: {
      id: id.startsWith("gid://shopify/Product/") ? id : `gid://shopify/Product/${id}`,
    } });
    if (!response.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
    const live = z.object({ product: z.object({ updatedAt: z.string() }).nullable() }).safeParse(response.data);
    if (!live.success) throw new SeoWorkerError("SOURCE_UNAVAILABLE");
    if (!live.data.product) throw new SeoWorkerError("PRODUCT_DELETED");
    if (live.data.product.updatedAt !== source.data.updatedAt) throw new SeoWorkerError("STALE_SOURCE");
  };
}
