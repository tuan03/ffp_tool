import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { handleAutoSeoHttpRequest } from "../auto-seo-handler";

for (const chunked of [false, true]) {
  test(`oversized Auto SEO ${chunked ? "chunked" : "content-length"} body returns JSON 413 without resetting transport`, async () => {
    const server = http.createServer((request, response) => { void handleAutoSeoHttpRequest(request, response, { maxBodyBytes: 1024 }); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const reply = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port: address.port, method: "POST", path: "/api/auto-seo/run",
          headers: { "Content-Type": "application/json", ...(chunked ? {} : { "Content-Length": 2048 }) } }, response => {
          let body = "";
          response.on("data", chunk => { body += String(chunk); });
          response.on("error", reject); response.on("aborted", () => reject(new Error("Response aborted")));
          response.on("end", () => resolve({ status: response.statusCode, body }));
        });
        request.setTimeout(3000, () => request.destroy(new Error("Request timeout")));
        request.on("error", reject);
        request.write(Buffer.alloc(2048, 97)); request.end();
      });
      assert.equal(reply.status, 413);
      assert.equal(JSON.parse(reply.body).error.code, "AUTO_SEO_PAYLOAD_TOO_LARGE");
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
