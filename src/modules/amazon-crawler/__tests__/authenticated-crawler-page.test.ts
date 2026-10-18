import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonCrawlerOperatorPageProps } from "../ui/AuthenticatedCrawlerPage";
import { createCrawlerOperatorFetch } from "../service";

test("ASIN activity polling uses the authenticated Coordinator client", async () => {
  let calls = 0;
  const authenticatedFetch = createCrawlerOperatorFetch({ engineUrl: "https://crawler.test", username: "fixture", password: "fixture-password",
    fetchImplementation: async (url, init) => {
      calls++;
      assert.equal(String(url), "https://crawler.test/api/v1/asin-families/activity");
      assert.equal(new Headers(init?.headers).get("Authorization"), `Basic ${btoa("fixture:fixture-password")}`);
      return Response.json({ storeId: "sample", entries: [{ asin: "B0CHILD001", parentAsin: "B0CHILD001", status: "processing" }] });
    },
  });
  const props = createAmazonCrawlerOperatorPageProps("https://crawler.test", authenticatedFetch);
  assert.ok(props.filterShopifyAsins.loadActivity);
  const entries = await props.filterShopifyAsins.loadActivity({ storeId: "sample", asins: ["B0CHILD001"] });
  assert.equal(entries[0]?.status, "processing");
  assert.equal(calls, 1);
});

test("public operator composition keeps per-agent pause commands available", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null,
    });
    return Response.json({ commandId: "pause-command" }, { status: 202 });
  };
  const pageProps = createAmazonCrawlerOperatorPageProps("https://crawler.test", fetchImplementation);

  await pageProps.amazonCrawlerCommands.submit("agent/one", "PAUSE");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://crawler.test/api/v1/clients/agent%2Fone/commands");
  assert.equal(requests[0]?.method, "POST");
  const body = requests[0]?.body as { requestId?: unknown; type?: unknown };
  assert.match(String(body.requestId), /^[0-9a-f-]{36}$/);
  assert.equal(body.type, "PAUSE");
});
