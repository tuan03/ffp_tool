import { createCustomGptClient } from "./service";
import { createMockCustomGptClient } from "./mocks/runner";
import type { CustomGptClient } from "./service";

export function getCustomGptClient(environment: "mock" | "development" | "production"): CustomGptClient {
  return environment === "mock" ? createMockCustomGptClient() : createCustomGptClient();
}
