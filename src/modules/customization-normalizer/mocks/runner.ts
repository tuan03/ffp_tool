import type { CustomizationNormalizerInput, CustomizationNormalizerOutput } from "../types";
import { customizationNormalizerMockData } from "./data";

export async function runMockCustomizationNormalizer(
  input: CustomizationNormalizerInput,
): Promise<CustomizationNormalizerOutput> {
  const cloned = JSON.parse(JSON.stringify(customizationNormalizerMockData)) as CustomizationNormalizerOutput;
  return {
    ...cloned,
    jobId: input.jobId,
  };
}
