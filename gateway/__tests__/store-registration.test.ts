import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Readable } from "node:stream";

import { InMemoryStoreRegistry } from "../store-registry";
import { StaticAccessTokenProvider } from "../token-provider";
import { InMemoryThrottleManager } from "../throttle-manager";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { StoreControlPlane } from "../store-control-plane";
import {
  handleStoreRegistrationHttpRequest,
  handleProxyCheckHttpRequest,
  handleStoreUpdateHttpRequest,
  handleStoreDeleteHttpRequest,
  handleStoreGetHttpRequest,
} from "../store-control-handler";
import { persistStoreToConfigFile } from "../store-config-loader";
import type { HttpTransport } from "../types";

function createMockReqRes(options: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): { req: http.IncomingMessage; res: http.ServerResponse; getResult: () => { status: number; body: Record<string, unknown> } } {
  const bodyString = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});
  const req = Readable.from([Buffer.from(bodyString)]) as unknown as http.IncomingMessage;
  req.method = options.method;
  req.url = options.url || "/api/stores/register";
  req.headers = options.headers || { "content-type": "application/json" };

  let statusCode = 200;
  let responseData = "";
  const headersObj: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, val: string) {
      headersObj[key.toLowerCase()] = val;
    },
    end(chunk?: unknown) {
      if (chunk) {
        responseData += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      }
    },
    destroy() {},
  } as unknown as http.ServerResponse;

  return {
    req,
    res,
    getResult: () => ({
      status: statusCode,
      body: responseData ? JSON.parse(responseData) : {},
    }),
  };
}

test("handleStoreRegistrationHttpRequest rejects non-POST with 405", async () => {
  const storeRegistry = new InMemoryStoreRegistry([]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({ method: "GET" });
  await handleStoreRegistrationHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 405);
  assert.equal(result.body.success, false);
});

test("handleStoreRegistrationHttpRequest rejects missing storeId or shopDomain with 400", async () => {
  const storeRegistry = new InMemoryStoreRegistry([]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    body: { shopDomain: "test.myshopify.com" },
  });
  await handleStoreRegistrationHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handleStoreRegistrationHttpRequest registers a new store with skipVerify and persists to config file", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ffp-store-reg-test-"));
  const tempConfigFile = join(tempDir, "stores.local.json");

  try {
    const storeRegistry = new InMemoryStoreRegistry([]);
    const tokenProvider = new StaticAccessTokenProvider();
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
    const controlPlane = new StoreControlPlane({
      storeRegistry,
      tokenProvider,
      graphqlClient,
      persistConfigFile: tempConfigFile,
    });

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        storeId: "dizzy",
        shopDomain: "dizzy.myshopify.com",
        clientId: "dizzy_client_123",
        clientSecret: "dizzy_secret_456",
        proxyUrl: "http://proxy.example.com:8080",
        proxyUsername: "user",
        proxyPassword: "password",
        skipVerify: true,
      },
    });

    await handleStoreRegistrationHttpRequest(req, res, controlPlane);

    const result = getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data && typeof result.body.data === "object" && (result.body.data as Record<string, unknown>).registered, true);

    // Verify in memory registry
    const registered = await storeRegistry.getStore("dizzy");
    assert.ok(registered);
    assert.equal(registered?.storeId, "dizzy");
    assert.equal(registered?.shopDomain, "dizzy.myshopify.com");
    assert.equal(registered?.auth.clientId, "dizzy_client_123");
    assert.equal(registered?.proxy?.url, "http://proxy.example.com:8080");

    // Verify written to tempConfigFile
    assert.ok(existsSync(tempConfigFile));
    const savedContent = JSON.parse(readFileSync(tempConfigFile, "utf-8"));
    assert.ok(Array.isArray(savedContent));
    assert.equal(savedContent.length, 1);
    assert.equal(savedContent[0].storeId, "dizzy");
    assert.equal(savedContent[0].shopDomain, "dizzy.myshopify.com");
    assert.equal(savedContent[0].auth.clientId, "dizzy_client_123");
    assert.equal(savedContent[0].proxy.url, "http://proxy.example.com:8080");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("handleStoreRegistrationHttpRequest performs preflight test with testOnly: true without persisting", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ffp-store-reg-test2-"));
  const tempConfigFile = join(tempDir, "stores.local.json");

  try {
    const storeRegistry = new InMemoryStoreRegistry([]);
    const tokenProvider = new StaticAccessTokenProvider();
    const throttleManager = new InMemoryThrottleManager();

    const mockTransport: HttpTransport = async () => {
      return new Response(
        JSON.stringify({
          data: {
            shop: {
              id: "gid://shopify/Shop/123456",
              name: "Dizzy Shop",
              myshopifyDomain: "dizzy.myshopify.com",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const graphqlClient = new ShopifyGraphqlClient({
      tokenProvider,
      throttleManager,
      baseTransport: mockTransport,
    });

    const controlPlane = new StoreControlPlane({
      storeRegistry,
      tokenProvider,
      graphqlClient,
      persistConfigFile: tempConfigFile,
    });

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        storeId: "dizzy-test",
        shopDomain: "dizzy.myshopify.com",
        accessToken: "shpat_test_token_ok",
        testOnly: true,
      },
    });

    await handleStoreRegistrationHttpRequest(req, res, controlPlane);

    const result = getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal((result.body.data as Record<string, unknown>).connected, true);

    // Verify NOT persisted to registry
    const inReg = await storeRegistry.getStore("dizzy-test");
    assert.equal(inReg, undefined);

    // Verify NOT written to config file
    assert.equal(existsSync(tempConfigFile), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("handleProxyCheckHttpRequest rejects missing proxy URL with 400", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/proxy/check",
    body: {},
  });

  await handleProxyCheckHttpRequest(req, res);

  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handleProxyCheckHttpRequest rejects invalid proxy URL format", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/proxy/check",
    body: {
      url: "not-a-valid-url",
    },
  });

  await handleProxyCheckHttpRequest(req, res);

  const result = getResult();
  assert.equal(result.status, 200);
  assert.equal(result.body.success, false);
  assert.ok(String(result.body.error).includes("Định dạng Proxy URL không hợp lệ") || typeof result.body.error === "object");
});

test("persistStoreToConfigFile withConfigMutex serializes 50 concurrent store writes without file corruption", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "mutex-test-"));
  const tempConfigFile = join(tempDir, "stores.local.json");
  try {
    const writes = Array.from({ length: 50 }, (_, i) =>
      persistStoreToConfigFile(
        {
          storeId: `concurrent-store-${i}`,
          shopDomain: `store-${i}.myshopify.com`,
          apiVersion: "2026-07",
          auth: { type: "static", staticToken: `token-${i}` },
          productTypes: [`Type-${i}`],
          defaultProductType: `Type-${i}`,
        },
        { configFile: tempConfigFile },
      ),
    );

    await Promise.all(writes);

    assert.equal(existsSync(tempConfigFile), true);
    const saved = JSON.parse(readFileSync(tempConfigFile, "utf-8"));
    assert.ok(Array.isArray(saved));
    assert.equal(saved.length, 50);

    // Verify all 50 stores are present and productTypes are preserved
    const savedStoreIds = new Set(saved.map((s: Record<string, unknown>) => s.storeId));
    assert.equal(savedStoreIds.size, 50);
    for (let i = 0; i < 50; i++) {
      assert.ok(savedStoreIds.has(`concurrent-store-${i}`));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("handleStoreGetHttpRequest rejects missing storeId with 400", async () => {
  const storeRegistry = new InMemoryStoreRegistry([]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/stores/get",
  });
  await handleStoreGetHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handleStoreGetHttpRequest returns 404 for nonexistent store", async () => {
  const storeRegistry = new InMemoryStoreRegistry([]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/stores/get?storeId=nonexistent",
  });
  await handleStoreGetHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 404);
  assert.equal(result.body.success, false);
});

test("handleStoreGetHttpRequest returns 200 with safe metadata and no leaked secrets", async () => {
  const storeRegistry = new InMemoryStoreRegistry([
    {
      storeId: "safe-store",
      shopDomain: "safe-store.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "client_credentials", clientId: "my-client-id", clientSecret: "super-secret" },
      proxy: { url: "http://proxy.host:8080", username: "user1", password: "proxypassword" },
      productTypes: ["Rug"],
      defaultProductType: "Rug",
    },
  ]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/stores/get?storeId=safe-store",
  });
  await handleStoreGetHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  const data = result.body.data as { store: Record<string, unknown> };
  assert.equal(data.store.storeId, "safe-store");
  assert.equal(data.store.clientId, "my-client-id");
  assert.equal(data.store.hasProxy, true);
  assert.equal(data.store.proxyUrl, "http://proxy.host:8080");
  assert.equal(data.store.proxyUsername, "user1");
  // Check that secrets are NEVER leaked
  assert.equal(data.store.clientSecret, undefined);
  assert.equal(data.store.proxyPassword, undefined);
  assert.equal(data.store.password, undefined);
  assert.equal(data.store.staticToken, undefined);
});

test("handleStoreUpdateHttpRequest rejects missing storeId with 400", async () => {
  const storeRegistry = new InMemoryStoreRegistry([]);
  const tokenProvider = new StaticAccessTokenProvider();
  const throttleManager = new InMemoryThrottleManager();
  const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
  const controlPlane = new StoreControlPlane({ storeRegistry, tokenProvider, graphqlClient });

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/stores/update",
    body: { shopDomain: "test.myshopify.com" },
  });
  await handleStoreUpdateHttpRequest(req, res, controlPlane);

  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handleStoreUpdateHttpRequest updates store and preserves existing secrets if omitted", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ffp-store-update-test-"));
  const tempConfigFile = join(tempDir, "stores.local.json");

  try {
    const storeRegistry = new InMemoryStoreRegistry([
      {
        storeId: "store-to-update",
        shopDomain: "store-to-update.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "client_credentials", clientId: "old-client-id", clientSecret: "secret-preserve-me" },
        proxy: { url: "http://old-proxy.com:8080", username: "old-user", password: "old-password" },
      },
    ]);
    const tokenProvider = new StaticAccessTokenProvider();
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
    const controlPlane = new StoreControlPlane({
      storeRegistry,
      tokenProvider,
      graphqlClient,
      persistConfigFile: tempConfigFile,
    });

    // Update proxy URL and username only, without re-entering clientSecret or proxyPassword
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      url: "/api/stores/update",
      body: {
        storeId: "store-to-update",
        proxy: {
          url: "http://new-proxy.com:9000",
          username: "new-user",
        },
        skipVerify: true,
      },
    });

    await handleStoreUpdateHttpRequest(req, res, controlPlane);

    const result = getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);

    const updated = await storeRegistry.getStore("store-to-update");
    assert.ok(updated);
    // Secret preserved:
    assert.equal(updated.auth.type, "client_credentials");
    if (updated.auth.type === "client_credentials") {
      assert.equal(updated.auth.clientSecret, "secret-preserve-me");
    }
    // Proxy password preserved:
    assert.equal(updated.proxy?.url, "http://new-proxy.com:9000");
    assert.equal(updated.proxy?.username, "new-user");
    assert.equal(updated.proxy?.password, "old-password");

    // Check file persistence
    assert.equal(existsSync(tempConfigFile), true);
    const saved = JSON.parse(readFileSync(tempConfigFile, "utf-8"));
    assert.equal(saved[0].storeId, "store-to-update");
    assert.equal(saved[0].proxy?.url, "http://new-proxy.com:9000");
    assert.equal(saved[0].proxy?.password, "old-password");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("handleStoreDeleteHttpRequest deletes store from registry and config file", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ffp-store-delete-test-"));
  const tempConfigFile = join(tempDir, "stores.local.json");

  try {
    const storeRegistry = new InMemoryStoreRegistry([
      {
        storeId: "store-to-delete",
        shopDomain: "delete-me.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "token-to-delete" },
      },
    ]);
    const tokenProvider = new StaticAccessTokenProvider();
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager });
    const controlPlane = new StoreControlPlane({
      storeRegistry,
      tokenProvider,
      graphqlClient,
      persistConfigFile: tempConfigFile,
    });

    // First persist it to temp file
    await persistStoreToConfigFile(
      {
        storeId: "store-to-delete",
        shopDomain: "delete-me.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "token-to-delete" },
      },
      { configFile: tempConfigFile },
    );
    assert.equal(existsSync(tempConfigFile), true);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      url: "/api/stores/delete",
      body: { storeId: "store-to-delete" },
    });

    await handleStoreDeleteHttpRequest(req, res, controlPlane);

    const result = getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);

    // Verify removed from registry
    const inReg = await storeRegistry.getStore("store-to-delete");
    assert.equal(inReg, undefined);

    // Verify removed from config file
    const saved = JSON.parse(readFileSync(tempConfigFile, "utf-8"));
    assert.equal(saved.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

