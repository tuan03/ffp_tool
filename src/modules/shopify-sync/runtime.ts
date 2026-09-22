import type { AppEnvironment } from "../../shared/types";
import { runMockShopifySync } from "./mocks/runner";
import { runShopifySync } from "./service";
import type { ShopifySyncBatchInput, ShopifySyncBatchOutput, ShopifySyncOptions, ShopifySyncProductInput } from "./types";

export type ShopifySyncRunner = (
  input: ShopifySyncBatchInput | readonly ShopifySyncProductInput[],
  options?: ShopifySyncOptions,
) => Promise<ShopifySyncBatchOutput>;

export function getShopifySyncRunner(environment: AppEnvironment): ShopifySyncRunner {
  if (environment === "mock") {
    return runMockShopifySync;
  }
  return runShopifySync;
}
