import assert from "node:assert/strict";
import test from "node:test";

import { requestPinterestOperatorSession } from "../service";

test("Pinterest login uses a same-origin session without putting credentials in the URL", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/pinterest-pod/operator-session");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(new Headers(options.headers).has("Authorization"), false);
    assert.deepEqual(JSON.parse(String(options.body)), { username: "fixture", password: "secret" });
    return Response.json({ authenticated: true });
  });
  assert.deepEqual(await requestPinterestOperatorSession("login", { username: "fixture", password: "secret" }), {
    authRequired: true, authenticated: true,
  });
});

test("Pinterest session rejects malformed discovery and unavailable auth instead of legacy fallback", async (context) => {
  const mock = context.mock.method(globalThis, "fetch", async () => Response.json({ authenticated: false }));
  await assert.rejects(requestPinterestOperatorSession("status"));
  mock.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await assert.rejects(requestPinterestOperatorSession("status"));
  mock.mock.mockImplementation(async () => Response.json({ authRequired: false, authenticated: false }));
  assert.equal((await requestPinterestOperatorSession("status")).authRequired, false);
});

test("Pinterest never sends a login password over remote HTTP", async (context) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", hostname: "remote.invalid" } } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ authenticated: true }));
  await assert.rejects(requestPinterestOperatorSession("login", { username: "fixture", password: "secret" }));
  assert.equal(fetchMock.mock.callCount(), 0);
});
