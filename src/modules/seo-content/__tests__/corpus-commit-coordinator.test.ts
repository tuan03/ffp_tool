import assert from "node:assert/strict";
import test from "node:test";

import { CorpusRevisionConflictError } from "../internal/conflict-control/corpus-errors";
import { SeoCorpusCommitCoordinator } from "../corpus-commit-coordinator";

interface FakeSeoExecution {
  readonly productId: string;
  readonly observedRevision: number;
}

test("sixteen competing products all register against the latest corpus revision", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  let revision = 0;
  const committed = await Promise.all(Array.from({ length: 16 }, () => coordinator.prepare({
    runSeo: async () => revision,
    register: async observedRevision => {
      if (observedRevision !== revision) throw new CorpusRevisionConflictError(observedRevision, revision);
      revision++;
    },
  })));
  assert.equal(revision, 16);
  assert.equal(committed.length, 16);
});

test("revision retry stays bounded when external writers continuously invalidate the snapshot", async () => {
  let attempts = 0;
  await assert.rejects(new SeoCorpusCommitCoordinator().prepare({
    maxRevisionRetries: 2, runSeo: async () => 0,
    register: async () => { attempts++; throw new CorpusRevisionConflictError(0, 1); },
  }), CorpusRevisionConflictError);
  assert.equal(attempts, 3);
});

test("independent corpus writes do not block each other", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  let release: (() => void) | undefined;
  const first = coordinator.prepare({ corpusKey: "store-a", runSeo: async () => 1,
    register: () => new Promise<void>(resolve => { release = resolve; }),
  });
  await new Promise(resolve => setImmediate(resolve));
  const second = await coordinator.prepare({ corpusKey: "store-b", runSeo: async () => 2, register: async () => undefined });
  assert.equal(second.execution, 2);
  release?.();
  await first;
});

test("cancellation during atomic registration returns the reservation for cleanup", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  const controller = new AbortController();
  const reservation = await coordinator.prepare({ signal: controller.signal,
    runSeo: async () => "reserved-product", register: async () => { controller.abort(); },
  });
  assert.equal(reservation.execution, "reserved-product");
  assert.equal(controller.signal.aborted, true);
});

test("rebase does not hold the commit queue and uses the rebase callback", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  let releaseRebase: (() => void) | undefined;
  let initialRuns = 0;
  let registrations = 0;
  const first = coordinator.prepare({
    runSeo: async () => { initialRuns++; return 0; },
    rebaseSeo: async () => new Promise<number>((resolve) => { releaseRebase = () => resolve(1); }),
    register: async () => { if (registrations++ === 0) throw new CorpusRevisionConflictError(0, 1); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  let secondCommitted = false;
  const second = coordinator.prepare({ runSeo: async () => 2, register: async () => { secondCommitted = true; } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(secondCommitted, true);
  releaseRebase?.();
  await Promise.all([first, second]);
  assert.equal(initialRuns, 1);
});

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
  assert.ok((runCounts.get("p3") ?? 0) >= 2);
  assert.ok((runCounts.get("p4") ?? 0) >= 2);
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

test("corpus coordinator removes a cancelled operation while it waits in the commit queue", async () => {
  const coordinator = new SeoCorpusCommitCoordinator();
  let releaseFirst: (() => void) | undefined;
  const first = coordinator.prepare({
    runSeo: async () => ({ productId: "first", observedRevision: 0 }),
    register: async () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const controller = new AbortController();
  let didRegisterCancelled = false;
  const cancelled = coordinator.prepare({
    signal: controller.signal,
    runSeo: async () => ({ productId: "cancelled", observedRevision: 0 }),
    register: async () => { didRegisterCancelled = true; },
  });
  controller.abort();

  await assert.rejects(cancelled, (error: unknown) => error instanceof Error && error.name === "AbortError");
  releaseFirst?.();
  await first;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(didRegisterCancelled, false);
});
