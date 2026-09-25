import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonAsinChecker } from "../service";

test("crawler ASIN checker sends the selected store and parses Shopify matches", async () => {
  const checker = createAmazonAsinChecker(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.storeId, "jeminise");
    assert.equal(body.operation, "products.preflightAmazonAsins");
    assert.equal(body.mode, "apply");
    assert.deepEqual(body.payload, { asins: ["B012345678"] });
    assert.ok(typeof body.requestId === "string");
    return Response.json({ success: true, data: { ready: true, matches: [] } });
  });

  assert.deepEqual(await checker("jeminise", ["B012345678"]), { ready: true, matches: [] });
});

test("crawler ASIN checker rejects Shopify failures instead of assuming no duplicates", async () => {
  const checker = createAmazonAsinChecker(async () => Response.json({
    success: false, error: { message: "Shopify permission denied" },
  }, { status: 403 }));

  await assert.rejects(checker("capozen", ["B012345678"]), /Shopify permission denied/);
});
