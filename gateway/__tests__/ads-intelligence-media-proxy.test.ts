import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { computeMediaHash, handleMediaProxy } from "../ads-intelligence/media-proxy";

const MEDIA_CACHE_DIR = resolve(process.cwd(), ".runtime/ads-intelligence/media-cache");

test("Media Proxy: rejects missing or invalid URLs", async () => {
  const server = http.createServer(async (req, res) => {
    await handleMediaProxy(req, res);
  });

  await new Promise<void>((resolveServer) => server.listen(0, resolveServer));
  const port = (server.address() as { port: number }).port;

  try {
    // Missing ?url=
    const res1 = await fetch(`http://127.0.0.1:${port}/api/ads-intelligence/media-proxy`);
    assert.equal(res1.status, 400);
    const json1 = (await res1.json()) as { error: { code: string } };
    assert.equal(json1.error.code, "URL_REQUIRED");

    // Invalid protocol
    const res2 = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=javascript:alert(1)`
    );
    assert.equal(res2.status, 400);
    const json2 = (await res2.json()) as { error: { code: string } };
    assert.equal(json2.error.code, "INVALID_PROTOCOL");
  } finally {
    server.close();
  }
});

test("Media Proxy: blocks SSRF and private IP addresses", async () => {
  const server = http.createServer(async (req, res) => {
    await handleMediaProxy(req, res);
  });

  await new Promise<void>((resolveServer) => server.listen(0, resolveServer));
  const port = (server.address() as { port: number }).port;

  try {
    // Localhost / Loopback
    const res1 = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=http://127.0.0.1:3001/secret`
    );
    assert.equal(res1.status, 403);
    const json1 = (await res1.json()) as { error: { code: string } };
    assert.equal(json1.error.code, "SSRF_PROTECTED");

    // AWS/GCP instance metadata IP
    const res2 = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=http://169.254.169.254/latest/meta-data`
    );
    assert.equal(res2.status, 403);
    const json2 = (await res2.json()) as { error: { code: string } };
    assert.equal(json2.error.code, "SSRF_PROTECTED");

    // Private RFC1918 IP
    const res3 = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=http://192.168.1.100/admin`
    );
    assert.equal(res3.status, 403);
    const json3 = (await res3.json()) as { error: { code: string } };
    assert.equal(json3.error.code, "SSRF_PROTECTED");
  } finally {
    server.close();
  }
});

test("Media Proxy: serves cached file with HTTP 200 and HTTP 206 Range", async () => {
  const fakeUrl = "https://video.xx.fbcdn.net/v/t42.1790-2/fake_video_test_123.mp4";
  const hash = computeMediaHash(fakeUrl);

  await fs.mkdir(MEDIA_CACHE_DIR, { recursive: true });
  const fakeContent = Buffer.from("0123456789ABCDEF0123456789ABCDEF"); // 32 bytes
  const videoPath = join(MEDIA_CACHE_DIR, `${hash}.mp4`);
  const metaPath = join(MEDIA_CACHE_DIR, `${hash}.meta.json`);

  await fs.writeFile(videoPath, fakeContent);
  await fs.writeFile(
    metaPath,
    JSON.stringify({
      originalUrl: fakeUrl,
      contentType: "video/mp4",
      size: fakeContent.length,
      cachedAt: new Date().toISOString(),
    })
  );

  const server = http.createServer(async (req, res) => {
    await handleMediaProxy(req, res);
  });

  await new Promise<void>((resolveServer) => server.listen(0, resolveServer));
  const port = (server.address() as { port: number }).port;

  try {
    // 1. Full content request (200 OK)
    const resFull = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=${encodeURIComponent(fakeUrl)}`
    );
    assert.equal(resFull.status, 200);
    assert.equal(resFull.headers.get("content-type"), "video/mp4");
    assert.equal(resFull.headers.get("content-length"), "32");
    assert.equal(resFull.headers.get("accept-ranges"), "bytes");
    const fullBody = Buffer.from(await resFull.arrayBuffer());
    assert.deepEqual(fullBody, fakeContent);

    // 2. Range request (206 Partial Content: bytes 0-9)
    const resRange = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=${encodeURIComponent(fakeUrl)}`,
      {
        headers: { Range: "bytes=0-9" },
      }
    );
    assert.equal(resRange.status, 206);
    assert.equal(resRange.headers.get("content-range"), "bytes 0-9/32");
    assert.equal(resRange.headers.get("content-length"), "10");
    const rangeBody = Buffer.from(await resRange.arrayBuffer());
    assert.deepEqual(rangeBody, fakeContent.subarray(0, 10));

    // 3. Range request (206 Partial Content: bytes 10-31)
    const resRangeEnd = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=${encodeURIComponent(fakeUrl)}`,
      {
        headers: { Range: "bytes=10-" },
      }
    );
    assert.equal(resRangeEnd.status, 206);
    assert.equal(resRangeEnd.headers.get("content-range"), "bytes 10-31/32");
    assert.equal(resRangeEnd.headers.get("content-length"), "22");
    const rangeEndBody = Buffer.from(await resRangeEnd.arrayBuffer());
    assert.deepEqual(rangeEndBody, fakeContent.subarray(10, 32));
  } finally {
    server.close();
    await fs.rm(videoPath, { force: true });
    await fs.rm(metaPath, { force: true });
  }
});

test("Media Proxy: normalizes &amp; entities and finds cached file", async () => {
  const cleanUrl = "https://video.xx.fbcdn.net/v/t42.1790-2/fake_video_amp.mp4?cat=1&sid=2";
  const encodedUrl = "https://video.xx.fbcdn.net/v/t42.1790-2/fake_video_amp.mp4?cat=1&amp;sid=2";

  // Hashes should match because &amp; is normalized to &
  assert.equal(computeMediaHash(cleanUrl), computeMediaHash(encodedUrl));

  const hash = computeMediaHash(cleanUrl);
  await fs.mkdir(MEDIA_CACHE_DIR, { recursive: true });
  const fakeContent = Buffer.from("VIDEO_DATA_WITH_AMP_PARAMS");
  const videoPath = join(MEDIA_CACHE_DIR, `${hash}.mp4`);
  const metaPath = join(MEDIA_CACHE_DIR, `${hash}.meta.json`);

  await fs.writeFile(videoPath, fakeContent);
  await fs.writeFile(
    metaPath,
    JSON.stringify({
      originalUrl: cleanUrl,
      contentType: "video/mp4",
      size: fakeContent.length,
      cachedAt: new Date().toISOString(),
    })
  );

  const server = http.createServer(async (req, res) => {
    await handleMediaProxy(req, res);
  });
  await new Promise<void>((resolveServer) => server.listen(0, resolveServer));
  const port = (server.address() as { port: number }).port;

  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/ads-intelligence/media-proxy?url=${encodeURIComponent(encodedUrl)}`
    );
    assert.equal(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(body, fakeContent);
  } finally {
    server.close();
    await fs.rm(videoPath, { force: true });
    await fs.rm(metaPath, { force: true });
  }
});

