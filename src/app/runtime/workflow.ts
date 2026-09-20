import { getModuleARunner } from "../../modules/module-a";
import { getModuleBRunner } from "../../modules/module-b";
import { getModuleCRunner } from "../../modules/module-c";
import { createWorkflowRunner } from "../../modules/orchestrator";
import type { WorkflowDependencies } from "../../modules/orchestrator";
import { environment } from "../../config/environment";

function createWorkflowDependencies(): WorkflowDependencies {
  return {
    runModuleA: getModuleARunner(environment),
    runModuleB: getModuleBRunner(environment),
    runModuleC: getModuleCRunner(environment),
  };
}

export const runWorkflow = createWorkflowRunner(createWorkflowDependencies());
