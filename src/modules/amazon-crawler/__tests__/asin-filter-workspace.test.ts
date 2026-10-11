import assert from "node:assert/strict";
import test from "node:test";

import { readAsinFilterWorkspace, writeAsinFilterWorkspace } from "../ui/asin-filter-workspace";

function createStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const entries = new Map<string, string>();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: (key) => { entries.delete(key); } };
}

const workspace = {
  inputText: "B0MOCK1002",
  snapshot: { inputText: "B0MOCK1002", checkedAt: "2026-10-11T10:00:00.000Z", result: { storeId: "store-a", matches: [], missingAsins: ["B0MOCK1002"], scannedProducts: 10 } },
};

test("ASIN filter restores drafts/results independently per store and only clears explicitly", () => {
  const storage = createStorage();
  assert.equal(writeAsinFilterWorkspace(storage, "store-a", workspace), true);
  assert.deepEqual(readAsinFilterWorkspace(storage, "store-a"), workspace);
  assert.equal(readAsinFilterWorkspace(storage, "store-b").snapshot, null);
  const updated = { ...workspace, inputText: "B0MOCK1003" };
  writeAsinFilterWorkspace(storage, "store-a", updated);
  assert.deepEqual(readAsinFilterWorkspace(storage, "store-a"), updated, "editing preserves the prior snapshot");
  writeAsinFilterWorkspace(storage, "store-a", { inputText: "", snapshot: null });
  assert.deepEqual(readAsinFilterWorkspace(storage, "store-a"), { inputText: "", snapshot: null });
});

test("ASIN filter rejects damaged or cross-store storage and tolerates unavailable storage", () => {
  const storage = createStorage();
  writeAsinFilterWorkspace(storage, "store-b", workspace);
  assert.equal(readAsinFilterWorkspace(storage, "store-b").snapshot, null);
  const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readAsinFilterWorkspace(unavailable, "store-a"), { inputText: "", snapshot: null });
  assert.equal(writeAsinFilterWorkspace(unavailable, "store-a", workspace), false);
  for (const value of ["{broken", JSON.stringify({ ...workspace, snapshot: { ...workspace.snapshot, result: { ...workspace.snapshot.result, missingAsins: ["not-an-asin"] } } })]) {
    assert.deepEqual(readAsinFilterWorkspace({ getItem: () => value }, "store-a"), { inputText: "", snapshot: null });
  }
});

test("saved Shopify match links cannot restore script URLs into the filter", () => {
  const poisoned = { ...workspace, snapshot: { ...workspace.snapshot, result: { ...workspace.snapshot.result, matches: [{ asin: "B0MOCK1001", productId: "1", title: "Fixture", status: "ACTIVE", adminUrl: "javascript:alert(1)" }] } } };
  assert.equal(readAsinFilterWorkspace({ getItem: () => JSON.stringify(poisoned) }, "store-a").snapshot, null);
});
