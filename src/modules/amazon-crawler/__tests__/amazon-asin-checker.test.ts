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
    return Response.json({ success: true, data: {
      ready: true,
      matches: [],
      families: [{
        parentAsin: "B012345678", inputAsins: ["B012345678"], memberAsins: ["B012345678"],
        isResolved: false, databaseStatus: null, jobId: null, status: "available",
      }],
      allowedAsins: ["B012345678"],
    } });
  });

  assert.deepEqual(await checker("jeminise", ["B012345678"]), {
    ready: true,
    matches: [],
    families: [{
      parentAsin: "B012345678", inputAsins: ["B012345678"], memberAsins: ["B012345678"],
      isResolved: false, databaseStatus: null, jobId: null, status: "available",
    }],
    allowedAsins: ["B012345678"],
  });
});

test("crawler ASIN checker sends coordinator family aliases to Shopify", async () => {
  const requests: string[] = [];
  const checker = createAmazonAsinChecker(async (input, init) => {
    requests.push(String(input));
    if (String(input).includes("/api/v1/asin-families/resolve")) {
      return Response.json({ families: [{
        parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001", "B0CHILD002"],
        isResolved: true, databaseStatus: "synced", jobId: "job-1",
      }] });
    }
    const body = JSON.parse(String(init?.body)) as { payload: Record<string, unknown> };
    assert.ok(Array.isArray(body.payload.families));
    return Response.json({ success: true, data: {
      ready: true,
      matches: [{
        asin: "B0CHILD001", parentAsin: "B0PARENT01", productId: "1", title: "Existing", adminUrl: "https://example.com/1",
      }],
      families: [{
        parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001", "B0CHILD002"],
        isResolved: true, databaseStatus: "synced", jobId: "job-1", status: "existing",
      }],
      allowedAsins: [],
    } });
  }, { engineUrl: "https://crawler.example.com" });

  const result = await checker("capozen", ["B0CHILD001"]);
  assert.equal(result.families[0]?.parentAsin, "B0PARENT01");
  assert.equal(requests.length, 2);
});

test("crawler ASIN checker rejects Shopify failures instead of assuming no duplicates", async () => {
  const checker = createAmazonAsinChecker(async () => Response.json({
    success: false, error: { message: "Shopify permission denied" },
  }, { status: 403 }));

  await assert.rejects(checker("capozen", ["B012345678"]), /Shopify permission denied/);
});

test("crawler ASIN checker reports a readable coordinator routing failure", async () => {
  const checker = createAmazonAsinChecker(
    async () => new Response(null, { status: 404 }),
    { engineUrl: "https://crawler.example.com" },
  );

  await assert.rejects(
    checker("capozen", ["B012345678"]),
    /Không kiểm tra được family ASIN trong FFP\./,
  );
});
