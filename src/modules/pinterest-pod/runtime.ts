import type { AppEnvironment } from "../../shared/types";
import { mockPinterestPodClient } from "./mocks/runner";
import { realPinterestPodClient } from "./service";
import type { PinterestPodClient } from "./types";

export function getPinterestPodClient(environment: AppEnvironment): PinterestPodClient {
  return environment === "mock" ? mockPinterestPodClient : realPinterestPodClient;
}
