import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { loadBootstrappedStores, loadLocalEnv } from "../store-config-loader";

describe("Store Config Loader (Multi-Store Bootstrap)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "store-loader-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("loads multiple stores from JSON file with static tokens and proxies", () => {
    const configPath = join(tempDir, "stores.test.json");
    const jsonContent = JSON.stringify([
      {
        storeId: "store-us-1",
        shopDomain: "store-us-1.myshopify.com",
        apiVersion: "2026-07",
        auth: {
          type: "static",
          staticToken: "shpat_token_1",
        },
        proxy: {
          url: "http://us-proxy-1.example.com:8080",
          username: "usr1",
          password: "pwd1",
          failClosed: true,
        },
      },
      {
        storeId: "store-us-2",
        shopDomain: "store-us-2",
        auth: {
          type: "client_credentials",
          clientId: "client_2",
          clientSecret: "secret_2",
        },
        proxy: {
          url: "http://us-proxy-2.example.com:8080",
          failClosed: false,
        },
      },
    ]);
    writeFileSync(configPath, jsonContent, "utf-8");

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      configFile: configPath,
      env: {},
    });

    assert.equal(stores.length, 2);

    const s1 = stores.find((s) => s.storeId === "store-us-1");
    assert.ok(s1);
    assert.equal(s1.shopDomain, "store-us-1.myshopify.com");
    assert.equal(s1.auth.type, "static");
    assert.equal(s1.auth.staticToken, "shpat_token_1");
    assert.equal(s1.proxy?.url, "http://us-proxy-1.example.com:8080");
    assert.equal(s1.proxy?.username, "usr1");
    assert.equal(s1.proxy?.password, "pwd1");
    assert.equal(s1.proxy?.failClosed, true);

    const s2 = stores.find((s) => s.storeId === "store-us-2");
    assert.ok(s2);
    assert.equal(s2.shopDomain, "store-us-2.myshopify.com"); // normalized
    assert.equal(s2.auth.type, "client_credentials");
    assert.equal(s2.auth.clientId, "client_2");
    assert.equal(s2.auth.clientSecret, "secret_2");
    assert.equal(s2.proxy?.url, "http://us-proxy-2.example.com:8080");
    assert.equal(s2.proxy?.failClosed, false);
  });

  it("creates fail-closed sticky store routes for enabled crawler proxy profiles", () => {
    const proxyConfigPath = join(tempDir, "amazon-crawler-profiles.json");
    writeFileSync(proxyConfigPath, JSON.stringify({
      profiles: [
        {
          name: "US Proxy 1",
          enabled: true,
          proxy: {
            server: "http://proxy-1.example.com:8000",
            username: "proxy-user",
            password: "proxy-password",
          },
        },
        {
          name: "Disabled Proxy",
          enabled: false,
          proxy: { server: "http://disabled.example.com:8000" },
        },
      ],
    }), "utf-8");

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      env: {
        GATEWAY_STORE_ID: "primary",
        GATEWAY_SHOP_DOMAIN: "primary.myshopify.com",
        GATEWAY_ACCESS_TOKEN: "test-token",
        SHOPIFY_PROXY_CONFIG: proxyConfigPath,
      },
    });

    const proxyStore = stores.find((store) => store.storeId === "primary--us-proxy-1");
    assert.ok(proxyStore);
    assert.equal(proxyStore.proxy?.url, "http://proxy-1.example.com:8000");
    assert.equal(proxyStore.proxy?.username, "proxy-user");
    assert.equal(proxyStore.proxy?.password, "proxy-password");
    assert.equal(proxyStore.proxy?.failClosed, true);
    assert.equal(proxyStore.throttleGroupId, "primary");
    assert.equal(stores.some((store) => store.storeId.includes("disabled-proxy")), false);
  });

  it("loads multiple stores from inline GATEWAY_STORES environment variable", () => {
    const inlineJson = JSON.stringify({
      stores: [
        {
          id: "store-env-1",
          domain: "env1.myshopify.com",
          accessToken: "shpat_env_token_1",
          proxyUrl: "http://us-proxy-env:8080",
          proxyUsername: "env_user",
          proxyPassword: "env_password",
        },
      ],
    });

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      env: {
        GATEWAY_STORES: inlineJson,
      },
    });

    assert.equal(stores.length, 1);
    const s = stores[0];
    assert.equal(s.storeId, "store-env-1");
    assert.equal(s.shopDomain, "env1.myshopify.com");
    assert.equal(s.auth.type, "static");
    assert.equal(s.auth.staticToken, "shpat_env_token_1");
    assert.equal(s.proxy?.url, "http://us-proxy-env:8080");
    assert.equal(s.proxy?.username, "env_user");
    assert.equal(s.proxy?.password, "env_password");
    assert.equal(s.proxy?.failClosed, true); // default true
  });

  it("loads multiple stores from prefixed STORE_<ID>_* environment variables", () => {
    const env: Record<string, string> = {
      STORE_WRYDECO_DOMAIN: "wrydeco.myshopify.com",
      STORE_WRYDECO_ACCESS_TOKEN: "shpat_wrydeco_123",
      STORE_WRYDECO_PROXY_URL: "http://us-wrydeco-proxy:8080",
      STORE_WRYDECO_PROXY_USERNAME: "wry_usr",
      STORE_WRYDECO_PROXY_PASSWORD: "wry_pwd",

      STORE_CHILLGEN_DOMAIN: "chillgen",
      STORE_CHILLGEN_CLIENT_ID: "chill_client",
      STORE_CHILLGEN_CLIENT_SECRET: "chill_secret",
      STORE_CHILLGEN_PROXY_URL: "http://us-chillgen-proxy:8080",
      STORE_CHILLGEN_FAIL_CLOSED: "true",
    };

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      env,
    });

    assert.equal(stores.length, 2);

    const wrydeco = stores.find((s) => s.storeId === "wrydeco");
    assert.ok(wrydeco);
    assert.equal(wrydeco.shopDomain, "wrydeco.myshopify.com");
    assert.equal(wrydeco.auth.type, "static");
    assert.equal(wrydeco.auth.staticToken, "shpat_wrydeco_123");
    assert.equal(wrydeco.proxy?.url, "http://us-wrydeco-proxy:8080");
    assert.equal(wrydeco.proxy?.username, "wry_usr");
    assert.equal(wrydeco.proxy?.password, "wry_pwd");
    assert.equal(wrydeco.proxy?.failClosed, true);

    const chillgen = stores.find((s) => s.storeId === "chillgen");
    assert.ok(chillgen);
    assert.equal(chillgen.shopDomain, "chillgen.myshopify.com"); // normalized from handle
    assert.equal(chillgen.auth.type, "client_credentials");
    assert.equal(chillgen.auth.clientId, "chill_client");
    assert.equal(chillgen.auth.clientSecret, "chill_secret");
    assert.equal(chillgen.proxy?.url, "http://us-chillgen-proxy:8080");
  });

  it("falls back to single-store env variables for backward compatibility", () => {
    const env: Record<string, string> = {
      GATEWAY_STORE_ID: "my-store",
      GATEWAY_SHOP_DOMAIN: "https://my-store.myshopify.com",
      GATEWAY_ACCESS_TOKEN: "shpat_my_store_token",
      GATEWAY_PROXY_URL: "http://us-my-proxy:8080",
    };

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      env,
    });

    assert.equal(stores.length, 1);
    const s = stores[0];
    assert.equal(s.storeId, "my-store");
    assert.equal(s.shopDomain, "my-store.myshopify.com");
    assert.equal(s.auth.type, "static");
    assert.equal(s.auth.staticToken, "shpat_my_store_token");
    assert.equal(s.proxy?.url, "http://us-my-proxy:8080");
    assert.equal(s.proxy?.failClosed, true);
  });

  it("does not silently fallback to Capozen when GATEWAY_STORE_ID or GATEWAY_SHOP_DOMAIN is missing", () => {
    // Missing GATEWAY_STORE_ID
    const missingStoreIdEnv: Record<string, string> = {
      GATEWAY_SHOP_DOMAIN: "https://valid-shop.myshopify.com",
      GATEWAY_ACCESS_TOKEN: "shpat_valid_token",
    };
    const stores1 = loadBootstrappedStores({
      cwd: tempDir,
      env: missingStoreIdEnv,
    });
    assert.equal(stores1.length, 0);

    // Missing GATEWAY_SHOP_DOMAIN
    const missingDomainEnv: Record<string, string> = {
      GATEWAY_STORE_ID: "valid-store",
      GATEWAY_ACCESS_TOKEN: "shpat_valid_token",
    };
    const stores2 = loadBootstrappedStores({
      cwd: tempDir,
      env: missingDomainEnv,
    });
    assert.equal(stores2.length, 0);

    // Invalid GATEWAY_SHOP_DOMAIN
    const invalidDomainEnv: Record<string, string> = {
      GATEWAY_STORE_ID: "valid-store",
      GATEWAY_SHOP_DOMAIN: "invalid..domain",
      GATEWAY_ACCESS_TOKEN: "shpat_valid_token",
    };
    const stores3 = loadBootstrappedStores({
      cwd: tempDir,
      env: invalidDomainEnv,
    });
    assert.equal(stores3.length, 0);
  });

  it("merges stores and deduplicates by storeId", () => {
    const configPath = join(tempDir, "stores.local.json");
    writeFileSync(
      configPath,
      JSON.stringify([
        {
          storeId: "shared",
          shopDomain: "shared-file.myshopify.com",
          auth: { type: "static", staticToken: "tok-file" },
        },
      ]),
      "utf-8",
    );

    const env: Record<string, string> = {
      STORE_SHARED_DOMAIN: "shared-env.myshopify.com",
      STORE_SHARED_ACCESS_TOKEN: "tok-env",
      STORE_OTHER_DOMAIN: "other.myshopify.com",
      STORE_OTHER_ACCESS_TOKEN: "tok-other",
    };

    const stores = loadBootstrappedStores({
      cwd: tempDir,
      env,
    });

    assert.equal(stores.length, 2);
    const shared = stores.find((s) => s.storeId === "shared");
    assert.ok(shared);
    // Earlier source (file) takes precedence over prefixed env
    assert.equal(shared.shopDomain, "shared-file.myshopify.com");
    assert.equal(shared.auth.staticToken, "tok-file");

    const other = stores.find((s) => s.storeId === "other");
    assert.ok(other);
  });

  it("throws a clear error when configuration file contains invalid JSON", () => {
    const configPath = join(tempDir, "stores.local.json");
    writeFileSync(configPath, "{ invalid json content", "utf-8");

    assert.throws(
      () => {
        loadBootstrappedStores({ cwd: tempDir, env: {} });
      },
      {
        name: "GatewayError",
        message: /Failed to parse store configuration JSON/,
      },
    );
  });

  it("strips double and single quotes from .env.local values", () => {
    const envFile = join(tempDir, ".env.local");
    writeFileSync(
      envFile,
      `
GATEWAY_DOUBLE_QUOTES="hello world"
GATEWAY_SINGLE_QUOTES='single quote test'
GATEWAY_EMPTY_DOUBLE=""
GATEWAY_EMPTY_SINGLE=''
GATEWAY_NO_QUOTES=unquoted_value
`,
      "utf-8",
    );

    const loaded = loadLocalEnv(tempDir);
    assert.equal(loaded.GATEWAY_DOUBLE_QUOTES, "hello world");
    assert.equal(loaded.GATEWAY_SINGLE_QUOTES, "single quote test");
    assert.equal(loaded.GATEWAY_EMPTY_DOUBLE, "");
    assert.equal(loaded.GATEWAY_EMPTY_SINGLE, "");
    assert.equal(loaded.GATEWAY_NO_QUOTES, "unquoted_value");
  });

  it("ensures process.env takes precedence over .env.local", () => {
    const envFile = join(tempDir, ".env.local");
    writeFileSync(
      envFile,
      `
TEST_OVERRIDE_KEY="value_from_env_local"
TEST_LOCAL_ONLY_KEY="local_value"
`,
      "utf-8",
    );

    const origEnv = process.env.TEST_OVERRIDE_KEY;
    try {
      process.env.TEST_OVERRIDE_KEY = "runtime_container_value";
      const loaded = loadLocalEnv(tempDir);
      assert.equal(loaded.TEST_OVERRIDE_KEY, "runtime_container_value");
      assert.equal(loaded.TEST_LOCAL_ONLY_KEY, "local_value");
    } finally {
      if (origEnv !== undefined) {
        process.env.TEST_OVERRIDE_KEY = origEnv;
      } else {
        delete process.env.TEST_OVERRIDE_KEY;
      }
    }
  });

  it("handles export prefix and strips inline comments for quoted and unquoted values", () => {
    const envFile = join(tempDir, ".env.local");
    writeFileSync(
      envFile,
      `
export GATEWAY_EXPORT_QUOTED="exported_value" # comment after quote
export GATEWAY_EXPORT_SINGLE='single_export' # trailing comment
GATEWAY_PORT=3001 # port number
GATEWAY_PLAIN=simple_token # trailing comment
`,
      "utf-8",
    );

    const loaded = loadLocalEnv(tempDir);
    assert.equal(loaded.GATEWAY_EXPORT_QUOTED, "exported_value");
    assert.equal(loaded.GATEWAY_EXPORT_SINGLE, "single_export");
    assert.equal(loaded.GATEWAY_PORT, "3001");
    assert.equal(loaded.GATEWAY_PLAIN, "simple_token");
  });
});
