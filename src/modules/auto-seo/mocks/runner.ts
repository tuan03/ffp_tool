import { runAutoSeo } from "../service";
import type { AutoSeoOutput, AutoSeoSelectionInput } from "../types";
import { autoSeoMockProducts } from "./data";

export async function runMockAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const products =
    input.products.length > 0 ? input.products : autoSeoMockProducts;
  const niche =
    input.niche.trim().length > 0 ? input.niche.trim() : "print-on-demand";

  return runAutoSeo({
    workflowId: input.workflowId,
    products,
    niche,
    selectedProductIds: input.selectedProductIds,
    selectedHandles: input.selectedHandles,
  });
}
