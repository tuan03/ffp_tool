import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrappedStores } from "../store-config-loader";

test("shared proxy references require all secrets and never expose unresolved references", () => {
  const root = mkdtempSync(join(tmpdir(), "shared-proxy-"));
  try {
    const config = join(root, "profiles.json");
    writeFileSync(config, JSON.stringify({ profiles: [{ name: "team", proxy: { serverEnv: "TEAM_SERVER", passwordEnv: "TEAM_PASSWORD" } }] }));
    const env = { SHOPIFY_PROXY_CONFIG: config, GATEWAY_STORE_ID: "shop", GATEWAY_SHOP_DOMAIN: "shop.myshopify.com", GATEWAY_STATIC_TOKEN: "fixture", TEAM_SERVER: "http://proxy.test:80" };
    assert.equal(loadBootstrappedStores({ cwd: root, env }).length, 1);
    const stores = loadBootstrappedStores({ cwd: root, env: { ...env, TEAM_PASSWORD: "fixture-password" } });
    assert.equal(stores.length, 2);
    assert.equal(stores.find(store => store.storeId === "shop--team")?.proxy?.password, "fixture-password");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
