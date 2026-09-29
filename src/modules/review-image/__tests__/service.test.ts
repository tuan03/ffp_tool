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
  assert.equal(client.templateUrl("room 1.png"), "/api/review-images/templates/room%201.png");
});

test("review image client turns backend errors into a readable message", async () => {
  const client = createReviewImageClient(async () => new Response(JSON.stringify({ detail: "No extension is connected" }), { status: 503 }));
  await assert.rejects(() => client.approve("abc"), /No extension is connected/);
});

test("product upload rejects unsupported or oversized images before submission", async () => {
  const wrongType = new File(["x"], "note.txt", { type: "text/plain" });
  await assert.rejects(() => encodeProductFile(wrongType), /PNG, JPEG hoặc WebP/);
  const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
  await assert.rejects(() => encodeProductFile(oversized), /5 MB/);
});
