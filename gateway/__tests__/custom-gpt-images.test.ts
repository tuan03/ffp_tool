import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadProductImage, signImage, verifyImageSignature } from "../custom-gpt-seo/images";

test("image signatures bind job, image and expiry", () => {
  const expires = Date.now() + 60_000;
  const signature = signImage("secret", "job", "front", expires);
  assert.equal(verifyImageSignature("secret", "job", "front", expires, signature), true);
  assert.equal(verifyImageSignature("secret", "other", "front", expires, signature), false);
  assert.equal(verifyImageSignature("secret", "job", "front", Date.now() - 1, signature), false);
});
test("image downloader rejects localhost, arbitrary domains and credentials before network", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network must not be reached"); });
  for (const source of ["http://127.0.0.1/image", "https://localhost/image", "https://example.com/image", "https://cdn.shopify.com.evil.example/image", "https://user:pass@cdn.shopify.com/image"]) await assert.rejects(downloadProductImage(source), /approved product CDN/);
});
test("image downloader bounds content size and revalidates redirect targets", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }));
  await assert.rejects(downloadProductImage("https://cdn.shopify.com/image.png"), /approved product CDN/);
  t.mock.method(globalThis, "fetch", async () => new Response("large", { headers: { "Content-Type": "image/png", "Content-Length": String(9 * 1024 * 1024) } }));
  await assert.rejects(downloadProductImage("https://cdn.shopify.com/image.png"), /exceeds 8 MB/);
});
test("image downloader accepts JPEG, PNG and WebP but rejects unsupported MIME types", async (t) => {
  for (const [contentType, extension] of [["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]] as const) {
    t.mock.method(globalThis, "fetch", async () => new Response("image", { headers: { "Content-Type": contentType } }));
    const image = await downloadProductImage("https://cdn.shopify.com/image");
    assert.equal(image.contentType, contentType);
    assert.equal(image.extension, extension);
  }
  t.mock.method(globalThis, "fetch", async () => new Response("image", { headers: { "Content-Type": "image/svg+xml" } }));
  await assert.rejects(downloadProductImage("https://cdn.shopify.com/image.svg"), /unsupported/);
});
