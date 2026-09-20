import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import { createWorkflowRunner } from "..";

test("orchestrator runs B and C after A and aggregates their results", async () => {
  const runner = createWorkflowRunner({
    async runModuleA(input) {
      return { workflowId: input.workflowId, success: true, normalizedItems: ["ready"] };
    },
    async runModuleB(input) {
      return { workflowId: input.workflowId, success: true, itemCount: input.items.length };
    },
    async runModuleC(input) {
      return { workflowId: input.workflowId, success: true, processedItems: [...input.items] };
    },
  });

  const result = await runner({ workflowId: "workflow-1", items: ["raw"] });
  assert.equal(result.moduleB.itemCount, 1);
  assert.deepEqual(result.moduleC.processedItems, ["ready"]);
});

test("orchestrator identifies the module that failed", async () => {
  const runner = createWorkflowRunner({
    async runModuleA() {
      throw new Error("source unavailable");
    },
    async runModuleB() {
      return { workflowId: "unused", success: true, itemCount: 0 };
    },
    async runModuleC() {
      return { workflowId: "unused", success: true, processedItems: [] };
    },
  });

  await assert.rejects(runner({ workflowId: "workflow-1", items: [] }), (error: unknown) => {
    return error instanceof AppError && error.code === "MODULE_A_FAILED";
  });
});
