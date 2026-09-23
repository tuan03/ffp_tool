import type { AppEnvironment } from "../../shared/types";
import { mockProductCrawlerClient } from "./mocks/runner";
import { realProductCrawlerClient } from "./service";
import type { ProductCrawlerClient } from "./types";

export function getProductCrawlerClient(env: AppEnvironment): ProductCrawlerClient {
  if (env === "mock") {
    return mockProductCrawlerClient;
  }

  return realProductCrawlerClient;
}
