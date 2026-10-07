import assert from "node:assert/strict";
import test from "node:test";

import { createAmazonCrawlerOperatorPageProps } from "../ui/AuthenticatedCrawlerPage";

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
