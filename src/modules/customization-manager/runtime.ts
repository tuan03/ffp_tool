import type { AppEnvironment } from "../../shared/types";
import { createMockCustomizationManagerRunner } from "./mocks/runner";
import { createCustomizationManagerRunner, createDryRunCustomizationGateway } from "./service";
import type { CustomizationGateway, CustomizationManagerConfig, CustomizationManagerRunner } from "./types";

export function getCustomizationManagerRunner(
  environment: AppEnvironment,
  gateway?: CustomizationGateway,
  config?: CustomizationManagerConfig,
): CustomizationManagerRunner {
  if (environment === "mock") {
    return createMockCustomizationManagerRunner();
  }

  const effectiveGateway = gateway ?? createDryRunCustomizationGateway();
  return createCustomizationManagerRunner(effectiveGateway, config);
}
