import assert from "node:assert/strict";
import test from "node:test";

import { CorpusRevisionConflictError } from "../internal/conflict-control/corpus-errors";
import { SeoCorpusCommitCoordinator } from "../corpus-commit-coordinator";

interface FakeSeoExecution {
  readonly productId: string;
  readonly observedRevision: number;
}

test("corpus coordinator rebases concurrent SEO results before each product syncs once", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  const runCounts = new Map<string, number>();
  const syncCounts = new Map<string, number>();
  let revision = 0;

  const processProduct = async (productId: string): Promise<void> => {
    const prepared = await coordinator.prepare({
      runSeo: async (): Promise<FakeSeoExecution> => {
        runCounts.set(productId, (runCounts.get(productId) ?? 0) + 1);
        return { productId, observedRevision: revision };
      },
      register: async (execution) => {
        if (execution.observedRevision !== revision) {
          throw new CorpusRevisionConflictError(execution.observedRevision, revision);
        }
        revision += 1;
      },
    });

    assert.equal(prepared.execution.productId, productId);
    syncCounts.set(productId, (syncCounts.get(productId) ?? 0) + 1);
  };

  await Promise.all(["p1", "p2", "p3", "p4"].map(processProduct));

  assert.equal(revision, 4);
  assert.equal(runCounts.get("p1"), 1);
  assert.equal(runCounts.get("p2"), 2);
  assert.equal(runCounts.get("p3"), 2);
  assert.equal(runCounts.get("p4"), 2);
  assert.deepEqual([...syncCounts.values()], [1, 1, 1, 1]);
});

test("corpus coordinator releases its queue after a non-revision failure", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();

  await assert.rejects(
    coordinator.prepare({
      runSeo: async () => ({ productId: "broken", observedRevision: 0 }),
      register: async () => {
        throw new Error("corrupt corpus");
      },
    }),
    /corrupt corpus/,
  );

  const recovered = await coordinator.prepare({
    runSeo: async () => ({ productId: "healthy", observedRevision: 0 }),
    register: async () => undefined,
  });
  assert.equal(recovered.execution.productId, "healthy");
});
