import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getRuntimeStoreConfigFile, loadRuntimeStores } from "../store-config-loader";

test("Gateway stores dynamically registered stores in the persistent runtime volume by default", () => {
  assert.equal(getRuntimeStoreConfigFile({}), ".runtime/stores.local.json");
});

test("Gateway honors an explicit persistent store configuration path", () => {
  assert.equal(getRuntimeStoreConfigFile({ GATEWAY_STORES_FILE: "/data/stores.json" }), "/data/stores.json");
});

test("server consumers load stores registered in the durable runtime registry", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ffp-runtime-stores-"));
  const runtimeDirectory = join(cwd, ".runtime");

  try {
    mkdirSync(runtimeDirectory);
    writeFileSync(
      join(runtimeDirectory, "stores.local.json"),
      JSON.stringify({
        stores: [
          {
            storeId: "preaureum_dev",
            shopDomain: "leatherbag-3anqqbf8.myshopify.com",
            auth: { type: "static", staticToken: "test-token" },
          },
        ],
      }),
      "utf8",
    );

    const stores = loadRuntimeStores({ cwd, env: {} });

    assert.equal(stores.length, 1);
    assert.equal(stores[0]?.storeId, "preaureum_dev");
    assert.equal(stores[0]?.shopDomain, "leatherbag-3anqqbf8.myshopify.com");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});
