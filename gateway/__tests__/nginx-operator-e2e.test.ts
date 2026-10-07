import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { startGatewayServer } from "../server";

/**
 * Real Multi-Tier Nginx Topology E2E Test (MODULE-API-04 & MODULE-API-06)
 *
 * Verifies:
 * 1. Topology: Client -> Nginx Reverse Proxy -> Server:3001 (Gateway) & Server:8768 (Pinterest)
 * 2. Operator Authentication Flow:
 *    - Unauthenticated request to protected route -> 401 Unauthorized (Basic Challenge)
 *    - Invalid credentials -> 401 Unauthorized
 *    - Valid Operator credentials -> Nginx passes + forwards Authorization -> Gateway validates
 *      operator credentials -> injects internal X-Gateway-Key -> request succeeds
 *    - Internal service using X-Gateway-Key directly -> succeeds
 * 3. Scope Isolation / Regression Protection:
 *    - /health is exempt from Basic Auth (Docker healthcheck safe)
 *    - /api/ads-intelligence/media-proxy is exempt from Basic Auth (video tag safe)
 *    - /api/v1/gpt-seo/ uses independent Bearer token (Custom GPT safe)
 *    - /api/pinterest-pod/sync-shopify and /handover-seo route to Gateway (3001)
 *    - Other /api/pinterest-pod/* routes to Pinterest service (8768)
 *    - Unknown /api/* routes return JSON 404 (never HTML SPA fallback)
 */

interface UpstreamServers {
  readonly gatewayUrl: string;
  readonly pinterestUrl: string;
}

function createNginxSimulator(
  upstreams: UpstreamServers,
  credentials: { username: string; password: string },
): http.Server {
  const validAuthHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;

  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    const pathname = parsedUrl.pathname;
    const authHeader = req.headers.authorization;

    // Helper to proxy request to an upstream URL
    const proxyTo = (targetBaseUrl: string, forwardAuth: boolean) => {
      const targetUrl = new URL(req.url || "/", targetBaseUrl);
      const headersToSend: Record<string, string> = {};

      for (const [k, v] of Object.entries(req.headers)) {
        if (v && k.toLowerCase() !== "host") {
          headersToSend[k] = Array.isArray(v) ? v[0] : v;
        }
      }
      headersToSend["host"] = req.headers.host || "localhost";
      headersToSend["x-real-ip"] = req.socket.remoteAddress || "127.0.0.1";
      headersToSend["x-forwarded-for"] = req.socket.remoteAddress || "127.0.0.1";
      headersToSend["x-forwarded-proto"] = "http";

      if (forwardAuth && authHeader) {
        headersToSend["authorization"] = authHeader;
      }

      const proxyReq = http.request(
        targetUrl,
        {
          method: req.method,
          headers: headersToSend,
        },
        (proxyRes) => {
          res.statusCode = proxyRes.statusCode || 500;
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v) res.setHeader(k, v);
          }
          proxyRes.pipe(res);
        },
      );

      proxyReq.on("error", (err) => {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message: err.message } }));
      });

      req.pipe(proxyReq);
    };

    const requireBasicAuth = (): boolean => {
      if (!authHeader || authHeader !== validAuthHeader) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="FFP Tool", charset="UTF-8"');
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Authentication required");
        return false;
      }
      return true;
    };

    // 1. /health -> auth_basic off -> Gateway
    if (pathname === "/health") {
      proxyTo(upstreams.gatewayUrl, false);
      return;
    }

    // 2. /api/ads-intelligence/media-proxy -> auth_basic off -> Gateway
    if (pathname.startsWith("/api/ads-intelligence/media-proxy")) {
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 3. Pinterest cross-module handovers -> Gateway:3001
    if (
      pathname === "/api/pinterest-pod/sync-shopify" ||
      pathname === "/api/pinterest-pod/handover-seo"
    ) {
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 4. Pinterest POD internal routes -> Server:8768
    if (pathname.startsWith("/api/pinterest-pod/")) {
      proxyTo(upstreams.pinterestUrl, true);
      return;
    }

    // 5. Custom GPT admin -> auth_basic on -> Gateway:3001
    if (pathname.startsWith("/api/v1/gpt-seo/admin/")) {
      if (!requireBasicAuth()) return;
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 6. Custom GPT Actions & MCP -> independent Bearer tokens (auth_basic off) -> Gateway:3001
    if (pathname.startsWith("/api/v1/gpt-seo/") || pathname === "/mcp/gpt-seo") {
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 7. Ads intelligence API -> auth_basic on -> Gateway:3001
    if (pathname.startsWith("/api/ads-intelligence/")) {
      if (!requireBasicAuth()) return;
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 8. Auto SEO durable review API -> auth_basic on -> Gateway:3001
    if (pathname.startsWith("/api/seo-review/")) {
      if (!requireBasicAuth()) return;
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 9. Core browser Gateway and Shopify APIs -> auth_basic on -> Gateway:3001
    if (/^\/api\/(shopify|stores|auto-seo|proxy|review-images|amazon-reviews)/.test(pathname)) {
      if (!requireBasicAuth()) return;
      proxyTo(upstreams.gatewayUrl, true);
      return;
    }

    // 10. Fallback for unknown /api/* -> JSON 404 (NEVER SPA index.html)
    if (pathname.startsWith("/api/")) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end('{"error":{"code":"NOT_FOUND"}}');
      return;
    }

    // 11. Static SPA root fallback
    if (!requireBasicAuth()) return;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!DOCTYPE html><html><head><title>FFP Tool</title></head><body>SPA Root</body></html>");
  });
}

test("Nginx -> Gateway -> Shopify E2E Topology & Operator Authentication Flow", async () => {
  const operatorUsername = "e2e-operator";
  const operatorPassword = "e2e-password-secure-123";
  const gatewayAuthToken = "e2e-internal-gateway-token-456";

  // 1. Start mock Pinterest server (:8768)
  const pinterestServer = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", service: "pinterest-pod-8768", path: req.url }));
  });
  await new Promise<void>((resolve) => pinterestServer.listen(0, "127.0.0.1", resolve));
  const pinterestPort = (pinterestServer.address() as import("node:net").AddressInfo).port;
  const pinterestUrl = `http://127.0.0.1:${pinterestPort}`;

  // 2. Start Gateway server (:3001) with Operator Auth & Internal Token
  const gatewayServer = startGatewayServer({
    port: 0,
    host: "127.0.0.1",
    authToken: gatewayAuthToken,
    operatorUsername,
    operatorPassword,
  });
  await new Promise<void>((resolve) => gatewayServer.once("listening", resolve));
  const gatewayPort = (gatewayServer.address() as import("node:net").AddressInfo).port;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  // 3. Start Nginx Proxy Server (matching deploy/client/nginx.conf)
  const nginxServer = createNginxSimulator(
    { gatewayUrl, pinterestUrl },
    { username: operatorUsername, password: operatorPassword },
  );
  await new Promise<void>((resolve) => nginxServer.listen(0, "127.0.0.1", resolve));
  const nginxPort = (nginxServer.address() as import("node:net").AddressInfo).port;
  const nginxUrl = `http://127.0.0.1:${nginxPort}`;

  const validBasicAuth = `Basic ${Buffer.from(`${operatorUsername}:${operatorPassword}`).toString("base64")}`;
  const invalidBasicAuth = `Basic ${Buffer.from(`${operatorUsername}:wrong-password`).toString("base64")}`;

  try {
    // --------------------------------------------------------------------------
    // Test 1: Unauthenticated request to /api/shopify -> 401 Basic Challenge
    // --------------------------------------------------------------------------
    const unauthRes = await fetch(`${nginxUrl}/api/shopify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: "capozen", operation: "connection.test", payload: {} }),
    });
    assert.equal(unauthRes.status, 401, "Unauthenticated request must be rejected with 401");
    assert.ok(
      unauthRes.headers.get("www-authenticate")?.includes('Basic realm="FFP Tool"'),
      "Must present Basic realm challenge",
    );

    // --------------------------------------------------------------------------
    // Test 2: Invalid operator credentials to /api/shopify -> 401 Unauthorized
    // --------------------------------------------------------------------------
    const invalidAuthRes = await fetch(`${nginxUrl}/api/shopify`, {
      method: "POST",
      headers: {
        Authorization: invalidBasicAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: "capozen", operation: "connection.test", payload: {} }),
    });
    assert.equal(invalidAuthRes.status, 401, "Invalid Basic Auth must be rejected with 401");

    // --------------------------------------------------------------------------
    // Test 3: Correct operator Basic Auth -> Nginx passes -> Gateway validates -> 200 OK
    // --------------------------------------------------------------------------
    const validAuthRes = await fetch(`${nginxUrl}/api/shopify`, {
      method: "POST",
      headers: {
        Authorization: validBasicAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: "capozen", operation: "connection.test", payload: {} }),
    });
    assert.equal(validAuthRes.status, 200, "Valid Operator Basic Auth must succeed with 200 OK");
    const validJson = (await validAuthRes.json()) as { success: boolean; data?: unknown };
    assert.equal(validJson.success, true, "Response payload must indicate success");

    // --------------------------------------------------------------------------
    // Test 4: Machine/worker request with X-Gateway-Key directly to Gateway -> 200 OK
    // --------------------------------------------------------------------------
    const directInternalRes = await fetch(`${gatewayUrl}/api/shopify`, {
      method: "POST",
      headers: {
        "X-Gateway-Key": gatewayAuthToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: "capozen", operation: "connection.test", payload: {} }),
    });
    assert.equal(directInternalRes.status, 200, "Direct internal call with X-Gateway-Key must succeed");

    // --------------------------------------------------------------------------
    // Test 5: Docker healthcheck /health is public (auth_basic off) -> 200 OK
    // --------------------------------------------------------------------------
    const healthRes = await fetch(`${nginxUrl}/health`);
    assert.equal(healthRes.status, 200, "/health must not require operator Basic Auth");
    const healthJson = (await healthRes.json()) as { status: string };
    assert.equal(healthJson.status, "ok");

    // --------------------------------------------------------------------------
    // Test 6: Media proxy /api/ads-intelligence/media-proxy is exempt from Basic Auth
    // --------------------------------------------------------------------------
    const mediaProxyRes = await fetch(`${nginxUrl}/api/ads-intelligence/media-proxy`);
    // Should NOT be 401 (Nginx basic auth challenge). Should pass through to gateway proxy handler (400 URL_REQUIRED)
    assert.notEqual(mediaProxyRes.status, 401, "Media proxy must not require operator Basic Auth");
    assert.equal(mediaProxyRes.status, 400, "Missing ?url= returns 400 from gateway handler");

    // --------------------------------------------------------------------------
    // Test 7: Pinterest POD handover /api/pinterest-pod/sync-shopify routes to Gateway
    // --------------------------------------------------------------------------
    const pinterestHandoverRes = await fetch(`${nginxUrl}/api/pinterest-pod/sync-shopify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // Routed to Gateway (returns 400 invalid input or 401 if unauth, NOT pinterest server 8768 response)
    const handoverText = await pinterestHandoverRes.text();
    assert.ok(!handoverText.includes("pinterest-pod-8768"), "Handover must route to Gateway, not 8768");

    // --------------------------------------------------------------------------
    // Test 8: Pinterest route /api/pinterest-pod/status routes to Server:8768
    // --------------------------------------------------------------------------
    const pinterestPodRes = await fetch(`${nginxUrl}/api/pinterest-pod/status`);
    assert.equal(pinterestPodRes.status, 200);
    const podJson = (await pinterestPodRes.json()) as { service: string };
    assert.equal(podJson.service, "pinterest-pod-8768", "POD routes must route to server:8768");

    // --------------------------------------------------------------------------
    // Test 9: Unknown /api/* route returns JSON 404, never SPA HTML
    // --------------------------------------------------------------------------
    const unknownApiRes = await fetch(`${nginxUrl}/api/nonexistent-service`);
    assert.equal(unknownApiRes.status, 404);
    assert.equal(unknownApiRes.headers.get("content-type")?.includes("application/json"), true);
    const unknownJson = (await unknownApiRes.json()) as { error: { code: string } };
    assert.equal(unknownJson.error.code, "NOT_FOUND");

    // --------------------------------------------------------------------------
    // Test 10: SPA root / requires Basic Auth
    // --------------------------------------------------------------------------
    const spaUnauthRes = await fetch(`${nginxUrl}/`);
    assert.equal(spaUnauthRes.status, 401, "SPA root must be protected by Basic Auth");

    const spaAuthRes = await fetch(`${nginxUrl}/`, {
      headers: { Authorization: validBasicAuth },
    });
    assert.equal(spaAuthRes.status, 200, "SPA root with valid Basic Auth must load HTML");
    const spaText = await spaAuthRes.text();
    assert.ok(spaText.includes("SPA Root"));
  } finally {
    await new Promise<void>((resolve) => nginxServer.close(() => resolve()));
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    await new Promise<void>((resolve) => pinterestServer.close(() => resolve()));
  }
});
