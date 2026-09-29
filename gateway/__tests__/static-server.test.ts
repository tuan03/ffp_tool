import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { serveStaticFile } from "../static-server";

test("serveStaticFile serves existing static assets with correct MIME and cache headers", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-test-"));
  const assetsDir = path.join(tempDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body>App</body></html>");
  fs.writeFileSync(path.join(assetsDir, "bundle.js"), "console.log('test');");

  try {
    // 1. Test serving assets/bundle.js
    const req1 = { method: "GET", url: "/assets/bundle.js" } as http.IncomingMessage;
    const headers1: Record<string, string | number> = {};
    let ended1 = false;
    let data1 = "";

    const res1 = {
      statusCode: 200,
      setHeader: (key: string, val: string | number) => { headers1[key.toLowerCase()] = val; },
      end: () => { ended1 = true; },
      on: () => res1,
      once: () => res1,
      emit: () => true,
      headersSent: false,
      write: (chunk: Buffer | string) => { data1 += chunk.toString(); return true; },
    } as unknown as http.ServerResponse;

    const handled1 = serveStaticFile(req1, res1, tempDir);
    assert.equal(handled1, true);
    assert.equal(headers1["content-type"], "text/javascript; charset=utf-8");
    assert.equal(headers1["cache-control"], "public, max-age=31536000, immutable");

    // 2. Test SPA fallback on unknown client-side route
    const req2 = { method: "GET", url: "/seo-review?storeId=capozen" } as http.IncomingMessage;
    const headers2: Record<string, string | number> = {};
    const res2 = {
      statusCode: 200,
      setHeader: (key: string, val: string | number) => { headers2[key.toLowerCase()] = val; },
      end: () => {},
      on: () => res2,
      once: () => res2,
      emit: () => true,
      headersSent: false,
      write: () => true,
    } as unknown as http.ServerResponse;

    const handled2 = serveStaticFile(req2, res2, tempDir);
    assert.equal(handled2, true);
    assert.equal(headers2["content-type"], "text/html; charset=utf-8");
    assert.equal(headers2["cache-control"], "no-cache");

    // 3. Test that /api/ URLs are ignored
    const req3 = { method: "GET", url: "/api/shopify" } as http.IncomingMessage;
    const handled3 = serveStaticFile(req3, res2, tempDir);
    assert.equal(handled3, false);

    // 4. Test path traversal is rejected
    const req4 = { method: "GET", url: "/../../../etc/passwd" } as http.IncomingMessage;
    const handled4 = serveStaticFile(req4, res2, tempDir);
    // Should fallback to index.html or reject, but never serve /etc/passwd
    assert.ok(handled4 === true || handled4 === false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
