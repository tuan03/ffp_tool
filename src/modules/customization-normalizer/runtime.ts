import type { AppEnvironment } from "../../shared/types";
import { runMockCustomizationNormalizer } from "./mocks/runner";
import { runCustomizationNormalizer } from "./service";

export function getCustomizationNormalizerRunner(
  environment: AppEnvironment,
): typeof runCustomizationNormalizer {
  return environment === "mock" ? runMockCustomizationNormalizer : runCustomizationNormalizer;
}
