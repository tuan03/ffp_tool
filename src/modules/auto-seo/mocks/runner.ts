import { runAutoSeo } from "../service";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { autoSeoMockProducts, mockShopifyProducts } from "./data";

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

export class MockAutoSeoClient implements AutoSeoClient {
  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    return JSON.parse(JSON.stringify(mockShopifyProducts)) as ShopifyProductForAutoSeoUi[];
  }

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    return runAutoSeo(input);
  }
}

export const mockAutoSeoClient = new MockAutoSeoClient();
