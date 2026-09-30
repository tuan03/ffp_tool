import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import { handleReviewImageHttpRequest } from "../review-image-handler";
import { startGatewayServer } from "../server";
import { createReviewImageClient } from "../../src/modules/review-image/service";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("review image gateway proxies binary output and keeps bridge token server-side", async () => {
  let forwardedToken = "";
  let forwardedPath = "";
  const upstream = createServer((request, response) => {
    forwardedToken = String(request.headers["x-bridge-token"] ?? "");
    forwardedPath = String(request.url ?? "");
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Disposition", 'attachment; filename="review.png"');
    response.end(Buffer.from([137, 80, 78, 71]));
  });
  const upstreamUrl = await listen(upstream);
  const gateway = createServer((request, response) => {
    void handleReviewImageHttpRequest(request, response, {
      authToken: "gateway-secret", bridgeToken: "bridge-secret", bridgeBaseUrl: upstreamUrl,
    });
  });
  const gatewayUrl = await listen(gateway);
  try {
    const denied = await fetch(`${gatewayUrl}/api/review-images/jobs/a/image`);
    assert.equal(denied.status, 401);
    const image = await fetch(`${gatewayUrl}/api/review-images/jobs/a/download`, {
      headers: { "x-gateway-key": "gateway-secret" },
    });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.match(image.headers.get("content-disposition") ?? "", /attachment/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from([137, 80, 78, 71]));
    assert.equal(forwardedToken, "bridge-secret");
    assert.equal(forwardedPath, "/api/review-images/jobs/a/download");
  } finally {
    await close(gateway);
    await close(upstream);
  }
});

test("review image gateway rejects a body above its configured limit", async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => { upstreamCalls++; response.end("unexpected"); });
  const upstreamUrl = await listen(upstream);
  const gateway = createServer((request, response) => {
    void handleReviewImageHttpRequest(request, response, {
      bridgeToken: "bridge-secret", bridgeBaseUrl: upstreamUrl, maxBodyBytes: 8,
    });
  });
  const gatewayUrl = await listen(gateway);
  try {
    const response = await fetch(`${gatewayUrl}/api/review-images/jobs`, {
      method: "POST", body: "long request body",
    });
    assert.equal(response.status, 413);
    assert.equal(upstreamCalls, 0);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});

test("review image gateway forwards template deletion", async () => {
  let forwardedMethod = "";
  let forwardedPath = "";
  const upstream = createServer((request, response) => {
    forwardedMethod = request.method ?? "";
    forwardedPath = request.url ?? "";
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, template: { name: "room.png" } }));
  });
  const upstreamUrl = await listen(upstream);
  const gateway = createServer((request, response) => {
    void handleReviewImageHttpRequest(request, response, {
      bridgeToken: "bridge-secret", bridgeBaseUrl: upstreamUrl,
    });
  });
  const gatewayUrl = await listen(gateway);
  try {
    const response = await fetch(`${gatewayUrl}/api/review-images/templates/room.png`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.equal(forwardedMethod, "DELETE");
    assert.equal(forwardedPath, "/api/review-images/templates/room.png");
  } finally {
    await close(gateway);
    await close(upstream);
  }
});

test("review image gateway reports an unavailable local bridge", async () => {
  const gateway = createServer((request, response) => {
    void handleReviewImageHttpRequest(request, response, {
      bridgeToken: "bridge-secret", bridgeBaseUrl: "http://127.0.0.1:1",
    });
  });
  const gatewayUrl = await listen(gateway);
  try {
    const response = await fetch(`${gatewayUrl}/api/review-images/health`);
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /Bridge chưa chạy/);
  } finally {
    await close(gateway);
  }
});

test("production gateway serves authenticated review image previews using the page client", async () => {
  const upstream = createServer((request, response) => {
    if (request.url === "/api/review-images/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, templates: 1 }));
      return;
    }
    response.setHeader("Content-Type", "image/png");
    response.end(Buffer.from([137, 80, 78, 71]));
  });
  const upstreamUrl = await listen(upstream);
  const gateway = startGatewayServer({ port: 0, host: "127.0.0.1", authToken: "production-secret", reviewImageBridgeBaseUrl: upstreamUrl });
  await new Promise<void>((resolve) => gateway.once("listening", resolve));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Missing gateway address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const denied = await fetch(`${baseUrl}/api/review-images/health`);
    assert.equal(denied.status, 401);
    const client = createReviewImageClient((input, init) => fetch(new URL(String(input), baseUrl), init));
    client.setGatewayToken("production-secret");
    assert.equal((await client.health()).templates, 1);
    assert.deepEqual(Buffer.from(await (await client.image("abc")).arrayBuffer()), Buffer.from([137, 80, 78, 71]));
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
