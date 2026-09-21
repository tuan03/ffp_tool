import { runAutoSeo } from "../service";
import type {
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
} from "../types";
import { autoSeoMockProducts } from "./data";

function cloneMockProduct(
  product: AutoSeoProductCandidate,
): AutoSeoProductCandidate {
  return {
    ...product,
    images: product.images.map((image) => ({ ...image })),
  };
}

export async function runMockAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const products =
    input.products.length > 0
      ? input.products
      : autoSeoMockProducts.map(cloneMockProduct);

  return runAutoSeo({
    workflowId: input.workflowId,
    products,
    selectedProductIds: input.selectedProductIds,
    selectedHandles: input.selectedHandles,
  });
}

