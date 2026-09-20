import { runModuleA } from "../module-a";
import { runModuleB } from "../module-b";
import { runModuleC } from "../module-c";
import { AppError } from "../../shared/errors";
import type { WorkflowDependencies, WorkflowInput, WorkflowOutput } from "./types";

const defaultDependencies: WorkflowDependencies = { runModuleA, runModuleB, runModuleC };

export function createWorkflowRunner(
  dependencies: WorkflowDependencies = defaultDependencies,
): (input: WorkflowInput) => Promise<WorkflowOutput> {
  return async (input: WorkflowInput): Promise<WorkflowOutput> => {
    const moduleA = await runStep("MODULE_A_FAILED", () => dependencies.runModuleA(input));

    const [moduleB, moduleC] = await Promise.all([
      runStep("MODULE_B_FAILED", () =>
        dependencies.runModuleB({ workflowId: input.workflowId, items: moduleA.normalizedItems }),
      ),
      runStep("MODULE_C_FAILED", () =>
        dependencies.runModuleC({ workflowId: input.workflowId, items: moduleA.normalizedItems }),
      ),
    ]);

    return { moduleA, moduleB, moduleC };
  };
}

export const runWorkflow = createWorkflowRunner();

async function runStep<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw new AppError(`Workflow step failed: ${code}`, code, error);
  }
}
