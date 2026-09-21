import type { ModuleBInput, ModuleBOutput } from "../types";
import { moduleBMockData } from "./data";

export async function runMockModuleB(input: ModuleBInput): Promise<ModuleBOutput> {
  return {
    ...moduleBMockData,
    workflowId: input.workflowId,
  };
}
