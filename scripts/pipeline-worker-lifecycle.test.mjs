import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForCoordinator, createPipelineHealth, shutdownPipeline } from "./pipeline-worker-lifecycle.ts";

test("pipeline survives slow coordinator startup and bounds each readiness request", async () => {
  let now = 0;
  let calls = 0;
  await waitForCoordinator({ url: "http://coordinator", now: () => now,
    delay: async ms => { now += ms; },
    fetcher: async (_url, options) => {
      assert.ok(options.signal);
      calls++;
      return Response.json(now < 60_000 ? { status: "starting" } : { status: "ready" }, { status: now < 60_000 ? 503 : 200 });
    },
  });
  assert.ok(calls > 30);
  assert.equal(now, 60_000);
});

test("pipeline startup gives up after its deadline", async () => {
  let now = 0;
  await assert.rejects(waitForCoordinator({ url: "http://coordinator", timeoutMs: 3000, now: () => now,
    delay: async ms => { now += ms; }, fetcher: async () => { throw new Error("offline"); },
  }), /did not become ready/);
  assert.equal(now, 3000);
});

test("pipeline health only advances on actual activity and is removed on shutdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-health-"));
  const file = join(dir, "health.json");
  let now = 100_000;
  try {
    const health = createPipelineHealth({ file, now: () => now });
    assert.equal(JSON.parse(readFileSync(file)).status, "starting");
    health.activity();
    assert.equal(JSON.parse(readFileSync(file)).status, "healthy");
    now += 1000;
    health.activity();
    assert.equal(JSON.parse(readFileSync(file)).updatedAt, 100_000);
    now += 60_000;
    assert.equal(JSON.parse(readFileSync(file)).updatedAt, 100_000);
    health.stop();
    assert.equal(existsSync(file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("fatal shutdown stops background uploads and exits even if persistence close hangs", async () => {
  const events = [];
  await shutdownPipeline({ code: 1, timeoutMs: 10,
    abortUploads: () => events.push("abort"), closeGateway: () => events.push("gateway"),
    closePersistence: () => new Promise(() => {}), exit: code => { events.push(code); },
  });
  assert.deepEqual(events, ["abort", "gateway", 1]);
});
