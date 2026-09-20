import type { ModuleAInput, ModuleAOutput } from "./types";

/** TODO: Implement Module A business logic. */
export async function runModuleA(input: ModuleAInput): Promise<ModuleAOutput> {
  return {
    workflowId: input.workflowId,
    success: true,
    normalizedItems: input.items.map((item) => item.trim()),
  };
}
