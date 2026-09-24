import assert from "node:assert/strict";
import test from "node:test";

import { getDevelopmentProcessSpecs } from "./dev-processes.mjs";

test("development services launch directly without nested npm or command shells", () => {
  const specs = getDevelopmentProcessSpecs({
    nodeExecutable: "node-test",
    pythonExecutable: "python-test",
  });

  assert.deepEqual(
    specs.map(({ name, command }) => ({ name, command })),
    [
      { name: "web", command: "node-test" },
      { name: "coordinator", command: "python-test" },
      { name: "pipeline", command: "node-test" },
    ],
  );
  assert.equal(
    specs.some(({ command, args }) =>
      [command, ...args].some((value) => /(?:^|[\\/])(?:npm|npm\.cmd|cmd|cmd\.exe)$/i.test(value))),
    false,
  );
});

test("development stack includes the Shopify pipeline worker", () => {
  const specs = getDevelopmentProcessSpecs({
    nodeExecutable: "node-test",
    pythonExecutable: "python-test",
  });
  const pipeline = specs.find(({ name }) => name === "pipeline");

  assert.ok(pipeline);
  assert.deepEqual(pipeline.args, [
    "--disable-warning=ExperimentalWarning",
    "--import",
    "tsx",
    "scripts/shopify-pipeline-worker.ts",
  ]);
});
