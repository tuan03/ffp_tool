import assert from "node:assert/strict";
import test from "node:test";

import { getModuleARunner, moduleAMockData, runMockModuleA, runModuleA } from "..";

test("Module A returns a typed normalized result", async () => {
  const result = await runModuleA({
    workflowId: "workflow-1",
    items: [" first ", "second"],
  });

  assert.deepEqual(result, {
    workflowId: "workflow-1",
    success: true,
    normalizedItems: ["first", "second"],
  });
});

test("Module A exposes independent mock data for mock mode", async () => {
  const result = await runMockModuleA({ workflowId: "mock-workflow", items: [] });

  assert.deepEqual(result, {
    ...moduleAMockData,
    workflowId: "mock-workflow",
  });
  assert.notEqual(result.normalizedItems, moduleAMockData.normalizedItems);
});

test("Module A owns selection of its mock runner", async () => {
  const result = await getModuleARunner("mock")({ workflowId: "mock-workflow", items: [] });

  assert.deepEqual(result.normalizedItems, moduleAMockData.normalizedItems);
});
