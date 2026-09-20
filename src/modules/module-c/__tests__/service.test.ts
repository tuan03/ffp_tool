import assert from "node:assert/strict";
import test from "node:test";

import { getModuleCRunner, moduleCMockData, runMockModuleC, runModuleC } from "..";

test("Module C returns an independent copy of its input", async () => {
  const items = ["a"];
  const result = await runModuleC({ workflowId: "workflow-1", items });
  items.push("b");

  assert.deepEqual(result.processedItems, ["a"]);
});

test("Module C exposes independent mock data for mock mode", async () => {
  const result = await runMockModuleC({ workflowId: "mock-workflow", items: [] });

  assert.deepEqual(result, {
    ...moduleCMockData,
    workflowId: "mock-workflow",
  });
  assert.notEqual(result.processedItems, moduleCMockData.processedItems);
});

test("Module C owns selection of its mock runner", async () => {
  const result = await getModuleCRunner("mock")({ workflowId: "mock-workflow", items: [] });

  assert.deepEqual(result.processedItems, moduleCMockData.processedItems);
});
