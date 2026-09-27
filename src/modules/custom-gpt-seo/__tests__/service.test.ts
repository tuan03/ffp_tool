import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomGptClient } from "../service";

test("Custom GPT client preserves store scope and reports server errors", async () => {
  let requested = "";
  const client = createCustomGptClient(async (url) => { requested = String(url); return new Response(JSON.stringify({ error: { message: "Invalid batch size" } }), { status: 400 }); });
  await assert.rejects(client.settings("store one"), /Invalid batch size/);
  assert.match(requested, /storeId=store%20one/);
});
