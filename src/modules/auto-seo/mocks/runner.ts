import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoWorkflowInput,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { runAutoSeo } from "../service";
import { mockShopifyProducts } from "./data";

export class MockAutoSeoClient implements AutoSeoClient {
  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    // Return fresh deep copies to prevent state mutation in tests or UI
    return JSON.parse(JSON.stringify(mockShopifyProducts)) as ShopifyProductForAutoSeoUi[];
  }

  public async runAutoSeo(input: AutoSeoWorkflowInput): Promise<AutoSeoOutput> {
    return runAutoSeo(input);
  }
}

export const mockAutoSeoClient = new MockAutoSeoClient();
