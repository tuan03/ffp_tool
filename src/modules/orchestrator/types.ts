import type { ModuleAInput, ModuleAOutput } from "../module-a";
import type { ModuleBInput, ModuleBOutput } from "../module-b";
import type { ModuleCInput, ModuleCOutput } from "../module-c";

export interface WorkflowInput {
  workflowId: string;
  items: readonly string[];
}

export interface WorkflowOutput {
  moduleA: ModuleAOutput;
  moduleB: ModuleBOutput;
  moduleC: ModuleCOutput;
}

export interface WorkflowDependencies {
  runModuleA(input: ModuleAInput): Promise<ModuleAOutput>;
  runModuleB(input: ModuleBInput): Promise<ModuleBOutput>;
  runModuleC(input: ModuleCInput): Promise<ModuleCOutput>;
}
