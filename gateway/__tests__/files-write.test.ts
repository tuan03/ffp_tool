import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FormData as UndiciFormData } from "undici";

import {
  executeFilesStageBinary,
  GatewayError,
  InMemoryThrottleManager,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
} from "../index";
import type { HttpTransport, StoreConfig } from "../index";

const STORE: StoreConfig = {
  storeId: "staged-upload-test",
  shopDomain: "staged-upload-test.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test-token" },
};

function createStagedUploadClient(): ShopifyGraphqlClient {
  const graphqlTransport: HttpTransport = async () => new Response(JSON.stringify({
    data: {
      stagedUploadsCreate: {
        stagedTargets: [{
          url: "https://shopify-staged-uploads.storage.googleapis.com",
          resourceUrl: "https://shopify-staged-uploads.storage.googleapis.com/tmp/test/image.jpg",
          parameters: [
            { name: "Content-Type", value: "image/jpeg" },
            { name: "key", value: "tmp/test/image.jpg" },
            { name: "policy", value: "signed-policy" },
          ],
        }],
        userErrors: [],
      },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  return new ShopifyGraphqlClient({
    tokenProvider: new StaticAccessTokenProvider(),
    throttleManager: new InMemoryThrottleManager(),
    baseTransport: graphqlTransport,
  });
}

describe("Gateway: staged binary image upload", () => {
  it("uses undici FormData so proxy transport serializes a valid multipart body", async () => {
    let capturedBody: BodyInit | null | undefined;
    const uploadTransport: HttpTransport = async (_url, init) => {
      capturedBody = init?.body;
      return new Response("created", { status: 201 });
    };

    const result = await executeFilesStageBinary(
      STORE,
      createStagedUploadClient(),
      {
        filename: "image.jpg",
        mimeType: "image/jpeg",
        contentBase64: Buffer.from("jpeg-content").toString("base64"),
      },
      "apply",
      "staged-upload-request",
      uploadTransport,
    );

    assert.equal(
      result.resourceUrl,
      "https://shopify-staged-uploads.storage.googleapis.com/tmp/test/image.jpg",
    );
    assert.ok(capturedBody instanceof UndiciFormData);
    assert.equal(capturedBody.get("Content-Type"), "image/jpeg");
    assert.equal(capturedBody.get("key"), "tmp/test/image.jpg");
    const file = capturedBody.get("file");
    assert.ok(file instanceof Blob);
    assert.equal(file.type, "image/jpeg");
    assert.equal(file.size, Buffer.byteLength("jpeg-content"));
  });

  it("includes safe storage diagnostics when a staged upload is rejected", async () => {
    const uploadTransport: HttpTransport = async () => new Response(
      "<?xml version='1.0'?><Error><Code>InvalidArgument</Code><Message>Invalid argument.</Message><Details>Cannot create buckets using a POST.</Details><Signature>private</Signature></Error>",
      { status: 400, headers: { "Content-Type": "application/xml" } },
    );

    await assert.rejects(
      executeFilesStageBinary(
        STORE,
        createStagedUploadClient(),
        {
          filename: "image.jpg",
          mimeType: "image/jpeg",
          contentBase64: Buffer.from("jpeg-content").toString("base64"),
        },
        "apply",
        "staged-upload-request",
        uploadTransport,
      ),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.httpStatus, 400);
        assert.equal(error.retryable, false);
        assert.match(error.message, /InvalidArgument/);
        assert.match(error.message, /Cannot create buckets using a POST/);
        assert.equal(error.message.includes("private"), false);
        assert.deepEqual(error.details, {
          stage: "staged_binary_upload",
          upstreamStatus: 400,
          storageCode: "InvalidArgument",
          storageMessage: "Invalid argument.",
          storageDetails: "Cannot create buckets using a POST.",
        });
        return true;
      },
    );
  });
});
