import type { ModuleAInput, ModuleAOutput } from "../types";
import { moduleAMockData } from "./data";

export async function runMockModuleA(input: ModuleAInput): Promise<ModuleAOutput> {
  return {
    ...moduleAMockData,
    workflowId: input.workflowId,
    normalizedItems: [...moduleAMockData.normalizedItems],
  };
}
