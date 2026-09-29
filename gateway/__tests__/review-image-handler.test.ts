import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import { handleReviewImageHttpRequest } from "../review-image-handler";

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
