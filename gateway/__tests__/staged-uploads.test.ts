import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryThrottleManager,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
} from "../index";
import type { HttpTransport, StoreConfig } from "../index";
import { executeProductsCreate } from "../operations/products-write";
import {
  ensureMediaPubliclyAccessible,
  isLocalOrPrivateUrl,
  resolveLocalImageBytes,
  stageLocalMedia,
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
