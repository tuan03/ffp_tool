import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmbientCrawlerOperatorFetch } from "../ui/ambient-operator-session";

test("ambient operator session reuses browser authentication after reload", async () => {
  const fetchImplementation: typeof fetch = async () => Response.json([]);

  assert.equal(
    await resolveAmbientCrawlerOperatorFetch("https://fixture.test", fetchImplementation),
    fetchImplementation,
  );
});

test("ambient operator session falls back to the login form when unauthorized", async () => {
  const fetchImplementation: typeof fetch = async () => new Response(null, { status: 401 });

  assert.equal(
    await resolveAmbientCrawlerOperatorFetch("https://fixture.test", fetchImplementation),
    null,
  );
});
