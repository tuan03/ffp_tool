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
  const job = await client.create({ storeId: "preaureum", productDataUrl: "data:image/png;base64,AA==", prompt: "Replace bag", scope: "main" });
  assert.equal(requestedUrl, "/api/review-images/jobs");
  assert.deepEqual(submitted, { storeId: "preaureum", productDataUrl: "data:image/png;base64,AA==", prompt: "Replace bag", scope: "main" });
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

test("review image client scopes templates, bulk deletes and uploads approved jobs to Shopify", async () => {
  const calls: Array<{ url: string; method: string; token: string | null; body: unknown }> = [];
  const client = createReviewImageClient(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", token: new Headers(init?.headers).get("x-gateway-key"), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(url.endsWith("/templates") && init?.method === "POST"
      ? { ok: true, template: { name: "scene-123.png" } }
      : url.endsWith("/templates/batch")
        ? { ok: true, deleted: ["room.png"], failures: [{ name: "busy.png", message: "in use" }] }
        : url.endsWith("/shopify")
          ? { ok: true, fileId: "gid://shopify/MediaImage/1", shopifyCdnUrl: "https://cdn.shopify.com/review.png", fileStatus: "READY" }
      : { ok: true, templates: [{ name: "room.png" }] }, { status: init?.method === "POST" ? 201 : 200 });
  });
  client.setGatewayToken("secret");
  assert.deepEqual(await client.listTemplates("capozen"), [{ name: "room.png" }]);
  assert.deepEqual(await client.uploadTemplate({ storeId: "capozen", fileName: "scene.png", imageDataUrl: "data:image/png;base64,AA==" }), { name: "scene-123.png" });
  assert.deepEqual(await client.deleteTemplates("capozen", ["room.png", "busy.png"]), { deleted: ["room.png"], failures: [{ name: "busy.png", message: "in use" }] });
  assert.equal((await client.uploadToShopify("job-1", "capozen")).shopifyCdnUrl, "https://cdn.shopify.com/review.png");
  assert.deepEqual(calls, [
    { url: "/api/review-images/templates?storeId=capozen", method: "GET", token: "secret", body: null },
    { url: "/api/review-images/templates", method: "POST", token: "secret", body: { storeId: "capozen", fileName: "scene.png", imageDataUrl: "data:image/png;base64,AA==" } },
    { url: "/api/review-images/templates/batch", method: "DELETE", token: "secret", body: { storeId: "capozen", names: ["room.png", "busy.png"] } },
    { url: "/api/review-images/jobs/job-1/shopify", method: "POST", token: "secret", body: { storeId: "capozen" } },
  ]);
});
