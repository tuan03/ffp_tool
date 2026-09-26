import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GatewayError } from "../errors";
import {
  InMemoryThrottleManager,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
} from "../index";
import type { HttpTransport, StoreConfig } from "../index";
import { executeProductsCreate } from "../operations/products-write";
import {
  assertPathInAllowedRoots,
  ensureMediaPubliclyAccessible,
  fetchSafePublicUrl,
  getAllowedUploadRoots,
  isLocalOrPrivateUrl,
  isPrivateIp,
  resolveLocalImageBytes,
  stageLocalMedia,
  validateSafeFetchUrl,
} from "../operations/staged-uploads";

const testStore: StoreConfig = {
  storeId: "test-store",
  shopDomain: "test-store.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "shpat_test_token" },
};

function createMockClient(handler: (queryStr: string, variables?: Record<string, unknown>) => unknown): ShopifyGraphqlClient {
  const graphqlTransport: HttpTransport = async (_url, init) => {
    let bodyObj: { query?: string; variables?: Record<string, unknown> } = {};
    if (typeof init?.body === "string") {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {
        // ignore
      }
    }
    const responseData = handler(bodyObj.query ?? "", bodyObj.variables);
    return new Response(JSON.stringify({ data: responseData }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return new ShopifyGraphqlClient({
    tokenProvider: new StaticAccessTokenProvider(),
    throttleManager: new InMemoryThrottleManager(),
    baseTransport: graphqlTransport,
  });
}

test("isLocalOrPrivateUrl correctly identifies local, private, and public URLs", () => {
  // Localhost & loopback
  assert.equal(isLocalOrPrivateUrl("http://127.0.0.1:8768/api/pinterest-pod/assets/job1/img.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("http://localhost:5173/api/pinterest-pod/assets/job1/img.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("http://0.0.0.0:8000/image.png"), true);
  assert.equal(isLocalOrPrivateUrl("http://[::1]:3000/image.png"), true);

  // Private network ranges (RFC 1918)
  assert.equal(isLocalOrPrivateUrl("http://192.168.1.206:5173/api/pinterest-pod/assets/job1/img.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("http://10.0.0.1:8080/image.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("http://172.16.0.1/test.png"), true);
  assert.equal(isLocalOrPrivateUrl("http://172.31.255.255/test.png"), true);

  // Relative and data URLs
  assert.equal(isLocalOrPrivateUrl("/api/pinterest-pod/assets/job1/img.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("./mockups/sample.jpg"), true);
  assert.equal(isLocalOrPrivateUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), true);

  // Public internet URLs (Amazon CDN, Shopify CDN, Unsplash, etc.)
  assert.equal(isLocalOrPrivateUrl("https://m.media-amazon.com/images/I/71abcXYZ.jpg"), false);
  assert.equal(isLocalOrPrivateUrl("https://cdn.shopify.com/s/files/1/000/products/sample.jpg"), false);
  assert.equal(isLocalOrPrivateUrl("https://images.unsplash.com/photo-1579783902614-a3fb3927b675"), false);
  assert.equal(isLocalOrPrivateUrl("https://172.32.0.1/image.png"), false); // 172.32 is public
});

test("resolveLocalImageBytes resolves inline base64 data URIs", async () => {
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const resolved = await resolveLocalImageBytes(dataUri);

  assert.equal(resolved.contentType, "image/png");
  assert.ok(resolved.buffer.length > 0);
  assert.match(resolved.filename, /\.png$/);
});

test("stageLocalMedia skips public URLs without executing queries", async () => {
  let queryCount = 0;
  const mockClient = createMockClient(() => {
    queryCount++;
    return {};
  });

  const amazonUrl = "https://m.media-amazon.com/images/I/71abcXYZ.jpg";
  const result = await stageLocalMedia(testStore, mockClient, amazonUrl);

  assert.equal(result, amazonUrl);
  assert.equal(queryCount, 0);
});

test("ensureMediaPubliclyAccessible converts local URLs to staged GCS URLs and preserves public URLs", async () => {
  const dummy1x1PngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const mockClient = createMockClient((queryStr) => {
    if (queryStr.includes("StagedUploadsCreate")) {
      return {
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: "https://shopify-staged-uploads.storage.googleapis.com",
              resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/staged_image_123.png",
              parameters: [{ name: "key", value: "tmp/staged_image_123.png" }],
            },
          ],
          userErrors: [],
        },
      };
    }
    return {};
  });

  // Mock global fetch for the staged upload POST to Google Cloud Storage
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes("shopify-staged-uploads.storage.googleapis.com")) {
      return new Response("", { status: 200, statusText: "OK" });
    }
    return originalFetch(input, init);
  };

  try {
    const inputMedia = [
      {
        originalSource: "https://m.media-amazon.com/images/I/71abcXYZ.jpg",
        mediaContentType: "IMAGE" as const,
        alt: "Amazon Public Image",
      },
      {
        originalSource: dummy1x1PngBase64,
        mediaContentType: "IMAGE" as const,
        alt: "Pinterest POD Local Image 1",
      },
      {
        originalSource: dummy1x1PngBase64,
        mediaContentType: "IMAGE" as const,
        alt: "Pinterest POD Local Image 2 (Duplicate)",
      },
    ];

    const { mediaList, urlMap } = await ensureMediaPubliclyAccessible(testStore, mockClient, inputMedia);

    assert.equal(mediaList.length, 3);
    // Amazon image remains untouched
    assert.equal(mediaList[0]?.originalSource, "https://m.media-amazon.com/images/I/71abcXYZ.jpg");
    assert.equal(mediaList[0]?.alt, "Amazon Public Image");

    // Local data URIs are converted to Shopify GCS staged URLs
    assert.equal(
      mediaList[1]?.originalSource,
      "https://shopify-staged-uploads.storage.googleapis.com/tmp/staged_image_123.png",
    );
    assert.equal(
      mediaList[2]?.originalSource,
      "https://shopify-staged-uploads.storage.googleapis.com/tmp/staged_image_123.png",
    );

    assert.equal(urlMap.get("https://m.media-amazon.com/images/I/71abcXYZ.jpg"), "https://m.media-amazon.com/images/I/71abcXYZ.jpg");
    assert.equal(urlMap.get(dummy1x1PngBase64), "https://shopify-staged-uploads.storage.googleapis.com/tmp/staged_image_123.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("executeProductsCreate automatically stages local media before sending productCreate mutation", async () => {
  const dummy1x1PngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  let capturedVariables: Record<string, unknown> | undefined;

  const mockClient = createMockClient((queryStr, variables) => {
    if (queryStr.includes("StagedUploadsCreate")) {
      return {
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: "https://shopify-staged-uploads.storage.googleapis.com",
              resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/pod_staged_mockup.png",
              parameters: [{ name: "key", value: "tmp/pod_staged_mockup.png" }],
            },
          ],
          userErrors: [],
        },
      };
    }
    if (queryStr.includes("ProductCreate")) {
      capturedVariables = variables;
      return {
        productCreate: {
          product: {
            id: "gid://shopify/Product/12345",
            title: "Test Rug",
            handle: "test-rug",
            media: {
              nodes: [
                {
                  id: "gid://shopify/MediaImage/999",
                  image: { url: "https://cdn.shopify.com/s/files/1/000/products/test-rug.jpg" },
                },
              ],
            },
            variants: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/ProductVariant/888",
                    title: "Default Title",
                    price: "49.99",
                  },
                },
              ],
            },
          },
          userErrors: [],
        },
      };
    }
    return {};
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (urlStr.includes("shopify-staged-uploads.storage.googleapis.com")) {
      return new Response("", { status: 200, statusText: "OK" });
    }
    return originalFetch(input, init);
  };

  try {
    const result = await executeProductsCreate(
      testStore,
      mockClient,
      {
        product: {
          title: "Test Halloween Rug",
          media: [
            {
              originalSource: dummy1x1PngBase64,
              mediaContentType: "IMAGE",
              alt: "Design #2 Mockup",
            },
          ],
        },
      },
      "apply",
    );

    assert.equal(result.product.id, "gid://shopify/Product/12345");
    assert.ok(capturedVariables);
    const mediaParam = capturedVariables.media as { originalSource: string; alt?: string }[];
    assert.equal(mediaParam.length, 1);
    // Verifies the mutation received the Shopify GCS staged URL instead of the local data URI!
    assert.equal(mediaParam[0]?.originalSource, "https://shopify-staged-uploads.storage.googleapis.com/tmp/pod_staged_mockup.png");
    assert.equal(mediaParam[0]?.alt, "Design #2 Mockup");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isPrivateIp correctly flags private, loopback, metadata, and reserved IP ranges", () => {
  // IPv4 Private & Loopback & Cloud metadata
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("127.255.255.255"), true);
  assert.equal(isPrivateIp("10.0.0.1"), true);
  assert.equal(isPrivateIp("10.255.255.255"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true); // AWS/GCP/Azure instance metadata
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.31.255.255"), true);
  assert.equal(isPrivateIp("0.0.0.0"), true);
  assert.equal(isPrivateIp("100.64.0.1"), true); // CGNAT
  assert.equal(isPrivateIp("224.0.0.1"), true); // Multicast
  assert.equal(isPrivateIp("240.0.0.1"), true); // Reserved

  // IPv6
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("0:0:0:0:0:0:0:1"), true);
  assert.equal(isPrivateIp("0000:0000:0000:0000:0000:0000:0000:0001"), true);
  assert.equal(isPrivateIp("::0001"), true);
  assert.equal(isPrivateIp("::"), true);
  assert.equal(isPrivateIp("::0"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fd12:3456::1"), true);
  assert.equal(isPrivateIp("fd00:ec2::254"), true); // AWS EC2 IMDSv2 metadata
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true); // IPv4-mapped IPv6 loopback
  assert.equal(isPrivateIp("::ffff:169.254.169.254"), true);
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("::127.0.0.1"), true); // IPv4-compatible IPv6 loopback
  assert.equal(isPrivateIp("::7f00:1"), true);
  assert.equal(isPrivateIp("::169.254.169.254"), true); // IPv4-compatible IPv6 metadata
  assert.equal(isPrivateIp("::a9fe:a9fe"), true);
  assert.equal(isPrivateIp("::10.0.0.1"), true);
  assert.equal(isPrivateIp("::192.168.1.1"), true);
  assert.equal(isPrivateIp("2002:7f00:0001::"), true); // 6to4 private IPv4
  assert.equal(isPrivateIp("64:ff9b::127.0.0.1"), true); // NAT64 private IPv4

  // Public IPs
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("1.1.1.1"), false);
  assert.equal(isPrivateIp("172.32.0.1"), false);
  assert.equal(isPrivateIp("192.169.0.1"), false);
  assert.equal(isPrivateIp("2001:4860:4860::8888"), false);
  assert.equal(isPrivateIp("2607:f8b0:4005:805::200e"), false);
});

test("validateSafeFetchUrl blocks SSRF against private IPs, localhost, and metadata hostnames", async () => {
  const blockedUrls = [
    "http://127.0.0.1/secret",
    "http://127.0.0.2:8080/test",
    "http://localhost:3000/api",
    "http://10.0.0.1/internal",
    "http://192.168.1.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]:8080/flag",
    "http://[0000:0000:0000:0000:0000:0000:0000:0001]:8080/flag",
    "http://[::127.0.0.1]/test",
    "http://[::169.254.169.254]/latest/meta-data",
    "http://[::10.0.0.1]/test",
    "http://[::192.168.1.1]/test",
    "http://[fd00:ec2::254]/latest/meta-data",
    "http://app.local/test",
    "http://service.internal/secret",
    "http://metadata/computeMetadata/v1",
    "http://metadata.google.internal/computeMetadata/v1",
    "file:///etc/passwd",
    "ftp://example.com/file",
  ];

  for (const urlStr of blockedUrls) {
    await assert.rejects(
      async () => {
        await validateSafeFetchUrl(urlStr);
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError, `Expected GatewayError for '${urlStr}'`);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR", `Expected SHOPIFY_SECURITY_ERROR for '${urlStr}'`);
        assert.equal(err.httpStatus, 403, `Expected status 403 for '${urlStr}'`);
        return true;
      },
    );
  }
});

test("assertPathInAllowedRoots blocks arbitrary file reads, traversal, and symlink escapes", () => {
  // 1. Files outside allowed roots
  const forbiddenPaths = [
    "/etc/passwd",
    "/etc/hosts",
    "stores.local.json",
    ".env",
    "../../stores.local.json",
    "../../../etc/passwd",
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "stores.local.json"),
    path.resolve(process.cwd(), "gateway/stores.local.json"),
    path.resolve(process.cwd(), "package.json"),
  ];

  for (const filePath of forbiddenPaths) {
    assert.throws(
      () => {
        assertPathInAllowedRoots(filePath);
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError, `Expected GatewayError for '${filePath}'`);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  }

  // 2. Path traversal escaping the root
  const traversalPaths = [
    path.resolve(process.cwd(), "src/modules/pinterest-pod/server/data/pinterest_pod/output/../../../../etc/passwd"),
    path.resolve(process.cwd(), ".local-data/../../../../.env"),
  ];

  for (const filePath of traversalPaths) {
    assert.throws(
      () => {
        assertPathInAllowedRoots(filePath);
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  }

  // 3. Symlink escape check: Create a symlink inside allowed root pointing outside
  const allowedRoots = getAllowedUploadRoots();
  const testRoot = allowedRoots[0] ?? path.resolve(process.cwd(), ".local-data");
  if (!fs.existsSync(testRoot)) {
    fs.mkdirSync(testRoot, { recursive: true });
  }

  const symlinkPath = path.join(testRoot, `symlink-test-${Date.now()}.png`);
  try {
    fs.symlinkSync("/etc/hosts", symlinkPath);
    assert.throws(
      () => {
        assertPathInAllowedRoots(symlinkPath);
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  } finally {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
  }

  // 4. Valid file inside allowed root succeeds
  const validFilePath = path.join(testRoot, `valid-test-${Date.now()}.png`);
  try {
    fs.writeFileSync(validFilePath, Buffer.from("dummy-png-content"));
    const resolvedPath = assertPathInAllowedRoots(validFilePath);
    assert.ok(resolvedPath);
    assert.equal(fs.realpathSync(validFilePath), resolvedPath);
  } finally {
    if (fs.existsSync(validFilePath)) {
      fs.unlinkSync(validFilePath);
    }
  }
});

test("fetchSafePublicUrl blocks redirects targeting private addresses (SSRF)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Mock fetch to simulate an external server 302 redirecting to internal metadata
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes("public-site.com/image.jpg")) {
        return new Response("", {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data" },
        });
      }
      return originalFetch(input);
    };

    await assert.rejects(
      async () => {
        await fetchSafePublicUrl("https://public-site.com/image.jpg");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveLocalImageBytes resolves Pinterest POD asset from disk and rejects traversal and private network URLs", async () => {
  const allowedRoots = getAllowedUploadRoots();
  const testRoot = allowedRoots[0] ?? path.resolve(process.cwd(), ".local-data");
  if (!fs.existsSync(testRoot)) {
    fs.mkdirSync(testRoot, { recursive: true });
  }

  const jobDir = path.join(testRoot, "job-regression-test");
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }

  const assetFile = path.join(jobDir, "mockup.png");
  try {
    fs.writeFileSync(assetFile, Buffer.from("fake-png-binary-data"));

    // 1. Valid Pinterest POD URL resolves directly from disk without HTTP calls
    const resolved = await resolveLocalImageBytes("/api/pinterest-pod/assets/job-regression-test/mockup.png");
    assert.equal(resolved.filename, "mockup.png");
    assert.equal(resolved.contentType, "image/png");
    assert.equal(resolved.buffer.toString(), "fake-png-binary-data");

    // 2. Traversal in Pinterest POD URL is rejected with SHOPIFY_SECURITY_ERROR (403)
    await assert.rejects(
      async () => {
        await resolveLocalImageBytes("/api/pinterest-pod/assets/job-regression-test/../../../../etc/passwd");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // 2b. URL-encoded path traversal in Pinterest POD URL is rejected with SHOPIFY_SECURITY_ERROR (403)
    await assert.rejects(
      async () => {
        await resolveLocalImageBytes("/api/pinterest-pod/assets/%2e%2e/passwd");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // 3. Local file path outside allowed roots is rejected with SHOPIFY_SECURITY_ERROR (403)
    await assert.rejects(
      async () => {
        await resolveLocalImageBytes("/etc/passwd");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // 4. Private network HTTP URL is rejected with SHOPIFY_SECURITY_ERROR (403)
    await assert.rejects(
      async () => {
        await resolveLocalImageBytes("http://127.0.0.1:8768/secret-endpoint");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // 4b. Private network IPv6 / IPv4-compatible URL is rejected with SHOPIFY_SECURITY_ERROR (403)
    await assert.rejects(
      async () => {
        await resolveLocalImageBytes("http://[::127.0.0.1]:8768/secret-endpoint");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_SECURITY_ERROR");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );
  } finally {
    if (fs.existsSync(assetFile)) {
      fs.unlinkSync(assetFile);
    }
    if (fs.existsSync(jobDir)) {
      fs.rmdirSync(jobDir);
    }
  }
});
