import assert from "node:assert/strict";
import test from "node:test";

import { shopifyGatewayDevPlugin } from "../vite-plugin";

function invokeConfigureServer(p: unknown, serverMock: unknown): void {
  const plugin = p as { configureServer?: ((s: unknown) => void) | { handler?: (s: unknown) => void } };
  if (typeof plugin.configureServer === "function") {
    plugin.configureServer(serverMock);
  } else if (plugin.configureServer && typeof plugin.configureServer.handler === "function") {
    plugin.configureServer.handler(serverMock);
  }
}

test("gateway mock guard: /api/auto-seo/run is rejected with 403 when Vite runs in mock mode", async () => {
  let middleware: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
  const plugin = shopifyGatewayDevPlugin({ authToken: "test-token-123" });

  invokeConfigureServer(plugin, {
    config: { server: { host: "localhost" }, mode: "mock" },
    middlewares: {
      use: (fn: any) => {
        middleware = fn;
      },
    },
  });

  assert.ok(middleware, "Middleware must be registered");

  let statusCode = 0;
  let responseBody = "";
  const mockRes = {
    statusCode: 200,
    setHeader: () => {},
    end: (content: string) => {
      statusCode = mockRes.statusCode;
      responseBody = content;
    },
  };

  const mockReq = {
    url: "/api/auto-seo/run",
    method: "POST",
    headers: {
      host: "localhost:5173",
      "sec-fetch-site": "same-origin",
    },
  };

  let nextCalled = false;
  await middleware(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false, "Should not call next() for /api/auto-seo/run");
  assert.equal(mockRes.statusCode, 403, "Must return 403 Forbidden in mock mode");
  const parsed = JSON.parse(responseBody);
  assert.equal(parsed.success, false);
  assert.equal(parsed.error.code, "AUTO_SEO_MOCK_MODE_RESTRICTION");
});

test("gateway mock guard: /api/auto-seo/run is not blocked by mock guard in development mode", async () => {
  let middleware: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
  const plugin = shopifyGatewayDevPlugin({ authToken: "test-token-123" });

  const origEnv = process.env.VITE_APP_ENV;
  const origAppEnv = process.env.APP_ENV;
  delete process.env.VITE_APP_ENV;
  delete process.env.APP_ENV;

  try {
    invokeConfigureServer(plugin, {
      config: { server: { host: "localhost" }, mode: "development" },
      middlewares: {
        use: (fn: any) => {
          middleware = fn;
        },
      },
    });

    assert.ok(middleware);

    let statusCode = 0;
    let responseBody = "";
    const mockRes = {
      statusCode: 200,
      setHeader: () => {},
      end: (content: string) => {
        statusCode = mockRes.statusCode;
        responseBody = content;
      },
    };

    // Send a non-POST request to test that it enters the normal handler (which returns 405 Method Not Allowed)
    // rather than being blocked by the mock guard (which returns 403 AUTO_SEO_MOCK_MODE_RESTRICTION)
    const mockReq = {
      url: "/api/auto-seo/run",
      method: "GET",
      headers: {
        host: "localhost:5173",
        "sec-fetch-site": "same-origin",
      },
    };

    await middleware(mockReq, mockRes, () => {});

    assert.notEqual(mockRes.statusCode, 403, "Should not return 403 mock restriction in dev mode");
    assert.equal(mockRes.statusCode, 405, "Normal handler should process request and reject GET with 405");
  } finally {
    if (origEnv !== undefined) {
      process.env.VITE_APP_ENV = origEnv;
    } else {
      delete process.env.VITE_APP_ENV;
    }
    if (origAppEnv !== undefined) {
      process.env.APP_ENV = origAppEnv;
    } else {
      delete process.env.APP_ENV;
    }
  }
});

test("gateway mock guard: runSeoContent defaults to mock runner when VITE_APP_ENV=mock", async () => {
  const { runSeoContent } = await import("../seo-content/service");
  const origViteEnv = process.env.VITE_APP_ENV;
  const origAppEnv = process.env.APP_ENV;
  process.env.VITE_APP_ENV = "mock";
  delete process.env.APP_ENV;

  try {
    const result = await runSeoContent({
      workflowId: "test-mock-env-wf",
      storeId: "store-1",
      shopDomain: "store-1.myshopify.com",
      products: [
        {
          id: "prod-1",
          handle: "test-prod",
          title: "Test Product",
        },
      ],
    });

    assert.equal(result.success, true);
    assert.equal(result.processedCount, 1);
  } finally {
    if (origViteEnv !== undefined) {
      process.env.VITE_APP_ENV = origViteEnv;
    } else {
      delete process.env.VITE_APP_ENV;
    }
    if (origAppEnv !== undefined) {
      process.env.APP_ENV = origAppEnv;
    }
  }
});
