import assert from "node:assert/strict";
import test from "node:test";

import { createReviewImageClient, encodeProductFile } from "../service";

test("review image client sends the product, prompt and selected scope to the same-origin API", async () => {
  let requestedUrl = "";
  let submitted: unknown;
  const client = createReviewImageClient(async (input, init) => {
    requestedUrl = String(input);
    submitted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, job: { job_id: "abc", status: "queued", template_name: "room.png", scope: "main", approved: false, error: null, output_name: null } }), { status: 202 });
  });
  const job = await client.create({ productDataUrl: "data:image/png;base64,AA==", prompt: "Replace bag", scope: "main" });
  assert.equal(requestedUrl, "/api/review-images/jobs");
  assert.deepEqual(submitted, { productDataUrl: "data:image/png;base64,AA==", prompt: "Replace bag", scope: "main" });
  assert.equal(job.template_name, "room.png");
  assert.equal(typeof client.template, "function");
});

test("review image client turns backend errors into a readable message", async () => {
  const client = createReviewImageClient(async () => new Response(JSON.stringify({ detail: "No extension is connected" }), { status: 503 }));
  await assert.rejects(() => client.approve("abc"), /No extension is connected/);
});

test("review image client authenticates binary previews and downloads with an entered gateway token", async () => {
  const calls: Array<{ url: string; token: string | null }> = [];
  const client = createReviewImageClient(async (input, init) => {
    calls.push({ url: String(input), token: new Headers(init?.headers).get("x-gateway-key") });
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  });
  client.setGatewayToken("secret");
  const preview = await client.image("abc");
  const download = await client.download("abc");
  assert.equal(preview.type, "image/png");
  assert.equal(download.type, "image/png");
  assert.deepEqual(calls, [
    { url: "/api/review-images/jobs/abc/image", token: "secret" },
    { url: "/api/review-images/jobs/abc/download", token: "secret" },
  ]);
});

test("product upload rejects unsupported or oversized images before submission", async () => {
  const wrongType = new File(["x"], "note.txt", { type: "text/plain" });
  await assert.rejects(() => encodeProductFile(wrongType), /PNG, JPEG hoặc WebP/);
  const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
  await assert.rejects(() => encodeProductFile(oversized), /5 MB/);
});
