import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export const FILE_CREATE_MUTATION = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        createdAt
        ... on MediaImage {
          image {
            url
            width
            height
          }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_NODE_QUERY = `
  query GetFileNode($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        alt
        image {
          url
          width
          height
        }
      }
      ... on GenericFile {
        id
        fileStatus
        alt
        url
      }
    }
  }
`;

export interface FileCreateSummary {
  readonly fileId: string;
  readonly shopifyCdnUrl: string;
  readonly fileStatus: string;
  readonly alt?: string;
}

interface RawFileNode {
  readonly id: string;
  readonly fileStatus: string;
  readonly alt?: string | null;
  readonly image?: {
    readonly url: string;
    readonly width?: number | null;
    readonly height?: number | null;
  } | null;
  readonly url?: string | null;
}

interface FileCreateResponse {
  readonly fileCreate: {
    readonly files: readonly RawFileNode[] | null;
    readonly userErrors: readonly MutationUserErrorItem[];
  };
}

interface FileNodeQueryResponse {
  readonly node: RawFileNode | null;
}

export async function executeFilesCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<FileCreateSummary> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const originalSource = typeof p.originalSource === "string" ? p.originalSource.trim() : "";
  if (!originalSource) {
    throw new GatewayError("originalSource is required", "SHOPIFY_USER_ERROR", 400);
  }

  const filename = typeof p.filename === "string" && p.filename.trim() !== "" ? p.filename.trim() : undefined;
  const alt = typeof p.alt === "string" && p.alt.trim() !== "" ? p.alt.trim() : undefined;
  const contentType = p.contentType === "FILE" || p.contentType === "IMAGE" ? p.contentType : "IMAGE";
  const pollIntervalMs = typeof p.pollIntervalMs === "number" && p.pollIntervalMs >= 0 ? p.pollIntervalMs : 500;
  const maxPollAttempts = typeof p.maxPollAttempts === "number" && p.maxPollAttempts > 0 ? p.maxPollAttempts : 8;

  if (mode === "preview") {
    const safeFilename = filename || "mock-file.jpg";
    return {
      fileId: "gid://shopify/MediaImage/preview-file-1",
      shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${safeFilename}`,
      fileStatus: "READY",
      ...(alt ? { alt } : {}),
    };
  }

  const fileInput: Record<string, unknown> = {
    originalSource,
    contentType,
  };
  if (filename) {
    fileInput.filename = filename;
  }
  if (alt) {
    fileInput.alt = alt;
  }

  const raw = await client.query<FileCreateResponse>(
    store,
    FILE_CREATE_MUTATION,
    { files: [fileInput] },
    { isWrite: true, requestId },
  );

  if (raw.fileCreate.userErrors && raw.fileCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.fileCreate.userErrors);
  }

  const fileNode = raw.fileCreate.files?.[0];
  if (!fileNode) {
    throw new GatewayError("Failed to create file on Shopify; no file returned", "SHOPIFY_USER_ERROR", 400);
  }

  let fileStatus = fileNode.fileStatus;
  let url = fileNode.image?.url ?? fileNode.url ?? undefined;

  if (fileStatus !== "READY" || !url) {
    for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
      if (pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      const polled = await client.query<FileNodeQueryResponse>(
        store,
        FILE_NODE_QUERY,
        { id: fileNode.id },
        { isWrite: false },
      );

      if (polled?.node) {
        fileStatus = polled.node.fileStatus;
        if (fileStatus === "FAILED") {
          throw new GatewayError(
            `File processing failed on Shopify for file ${fileNode.id}`,
            "SHOPIFY_USER_ERROR",
            400,
          );
        }
        url = polled.node.image?.url ?? polled.node.url ?? undefined;
        if (fileStatus === "READY" && url) {
          break;
        }
      }
    }
  }

  if (!url) {
    throw new GatewayError(
      `File processing timed out waiting for READY status for file ${fileNode.id}`,
      "SHOPIFY_USER_ERROR",
      408,
    );
  }

  return {
    fileId: fileNode.id,
    shopifyCdnUrl: url,
    fileStatus: "READY",
    ...(alt || fileNode.alt ? { alt: alt ?? fileNode.alt ?? undefined } : {}),
  };
}
