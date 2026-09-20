import type { ModuleBInput, ModuleBOutput } from "./types";

/** TODO: Implement Module B business logic. */
export async function runModuleB(input: ModuleBInput): Promise<ModuleBOutput> {
  return {
    workflowId: input.workflowId,
    success: true,
    itemCount: input.items.length,
  };
}
