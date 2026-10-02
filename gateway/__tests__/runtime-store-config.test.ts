import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeStoreConfigFile } from "../server";

test("Gateway stores dynamically registered stores in the persistent runtime volume by default", () => {
  assert.equal(getRuntimeStoreConfigFile({}), ".runtime/stores.local.json");
});

test("Gateway honors an explicit persistent store configuration path", () => {
  assert.equal(getRuntimeStoreConfigFile({ GATEWAY_STORES_FILE: "/data/stores.json" }), "/data/stores.json");
});
