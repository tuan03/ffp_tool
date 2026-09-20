import assert from "node:assert/strict";
import test from "node:test";

import { getModuleBRunner, moduleBMockData, runMockModuleB, runModuleB } from "..";

test("Module B counts its own input without using other modules", async () => {
  const result = await runModuleB({ workflowId: "workflow-1", items: ["a", "b"] });

  assert.deepEqual(result, { workflowId: "workflow-1", success: true, itemCount: 2 });
});

test("Module B exposes representative mock data for mock mode", async () => {
  const result = await runMockModuleB({ workflowId: "mock-workflow", items: [] });

  assert.deepEqual(result, { ...moduleBMockData, workflowId: "mock-workflow" });
});

test("Module B owns selection of its mock runner", async () => {
  const result = await getModuleBRunner("mock")({ workflowId: "mock-workflow", items: [] });

  assert.equal(result.itemCount, moduleBMockData.itemCount);
});
