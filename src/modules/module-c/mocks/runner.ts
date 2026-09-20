import type { ModuleCInput, ModuleCOutput } from "../types";
import { moduleCMockData } from "./data";

export async function runMockModuleC(input: ModuleCInput): Promise<ModuleCOutput> {
  return {
    ...moduleCMockData,
    workflowId: input.workflowId,
    processedItems: [...moduleCMockData.processedItems],
  };
}
