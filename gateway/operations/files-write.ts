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

export const BATCH_FILE_NODES_QUERY = `
  query GetFileNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on MediaImage {
        fileStatus
        alt
        image {
          url
          width
          height
        }
      }
      ... on GenericFile {
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

export interface FileBulkCreateItemInput {
  readonly originalSource: string;
  readonly filename?: string;
  readonly alt?: string;
  readonly contentType?: "FILE" | "IMAGE";
}

export interface FilesBulkCreatePayload {
  readonly files: readonly FileBulkCreateItemInput[];
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

export interface FilesBulkCreateItemResult {
  readonly originalSource: string;
  readonly fileId?: string;
  readonly shopifyCdnUrl?: string;
  readonly fileStatus: string;
  readonly alt?: string;
  readonly error?: string;
}

export interface FilesBulkCreateSummary {
  readonly files: readonly FilesBulkCreateItemResult[];
  readonly totalCount: number;
  readonly successCount: number;
  readonly failedCount: number;
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
  if (Array.isArray(p.files)) {
    const bulk = await executeFilesBulkCreate(store, client, payload, mode, requestId);
    const first = bulk.files[0];
    if (!first || first.fileStatus !== "READY" || !first.shopifyCdnUrl) {
      throw new GatewayError(
        first?.error || "Failed to create file on Shopify",
        "SHOPIFY_USER_ERROR",
        400,
      );
    }
    return {
      fileId: first.fileId || "",
      shopifyCdnUrl: first.shopifyCdnUrl,
      fileStatus: first.fileStatus,
      ...(first.alt ? { alt: first.alt } : {}),
    };
  }

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
  if (fileStatus === "FAILED") {
    throw new GatewayError(
      `File processing failed on Shopify for file ${fileNode.id}`,
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

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

  if (fileStatus !== "READY" || !url) {
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

interface BatchFileNodesQueryResponse {
  readonly nodes: readonly (RawFileNode | null)[] | null;
}

export async function executeFilesBulkCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<FilesBulkCreateSummary> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rawFiles = Array.isArray(p.files) ? (p.files as readonly Record<string, unknown>[]) : [];
  if (rawFiles.length === 0) {
    throw new GatewayError("files array is required and must not be empty", "SHOPIFY_USER_ERROR", 400);
  }

  const pollIntervalMs = typeof p.pollIntervalMs === "number" && p.pollIntervalMs >= 0 ? p.pollIntervalMs : 500;
  const maxPollAttempts = typeof p.maxPollAttempts === "number" && p.maxPollAttempts > 0 ? p.maxPollAttempts : 12;

  if (mode === "preview") {
    const mockFiles: FilesBulkCreateItemResult[] = rawFiles.map((f, idx) => {
      const originalSource = typeof f.originalSource === "string" ? f.originalSource.trim() : `https://example.com/asset-${idx + 1}.png`;
      const filename = typeof f.filename === "string" && f.filename.trim() !== "" ? f.filename.trim() : `mock-file-${idx + 1}.jpg`;
      const alt = typeof f.alt === "string" && f.alt.trim() !== "" ? f.alt.trim() : undefined;
      return {
        originalSource,
        fileId: `gid://shopify/MediaImage/preview-file-${idx + 1}`,
        shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${filename}`,
        fileStatus: "READY",
        ...(alt ? { alt } : {}),
      };
    });
    return {
      files: mockFiles,
      totalCount: mockFiles.length,
      successCount: mockFiles.length,
      failedCount: 0,
    };
  }

  const fileInputs = rawFiles.map((f, idx) => {
    const originalSource = typeof f.originalSource === "string" ? f.originalSource.trim() : "";
    if (!originalSource) {
      throw new GatewayError(`originalSource is required for file at index ${idx}`, "SHOPIFY_USER_ERROR", 400);
    }
    const contentType = f.contentType === "FILE" || f.contentType === "IMAGE" ? f.contentType : "IMAGE";
    const input: Record<string, unknown> = {
      originalSource,
      contentType,
    };
    if (typeof f.filename === "string" && f.filename.trim() !== "") {
      input.filename = f.filename.trim();
    }
    if (typeof f.alt === "string" && f.alt.trim() !== "") {
      input.alt = f.alt.trim();
    }
    return input;
  });

  const raw = await client.query<FileCreateResponse>(
    store,
    FILE_CREATE_MUTATION,
    { files: fileInputs },
    { isWrite: true, requestId },
  );

  if (
    raw.fileCreate.userErrors &&
    raw.fileCreate.userErrors.length > 0 &&
    (!raw.fileCreate.files || raw.fileCreate.files.length === 0)
  ) {
    throw mapUserErrorsToGatewayError(raw.fileCreate.userErrors);
  }

  const results: FilesBulkCreateItemResult[] = rawFiles.map((f, idx) => {
    const originalSource = typeof f.originalSource === "string" ? f.originalSource.trim() : "";
    const node = raw.fileCreate.files?.[idx];
    if (!node) {
      return {
        originalSource,
        fileStatus: "FAILED",
        error: "Shopify did not return file node",
        alt: typeof f.alt === "string" ? f.alt.trim() : undefined,
      };
    }
    const url = node.image?.url ?? node.url ?? undefined;
    return {
      originalSource,
      fileId: node.id,
      shopifyCdnUrl: url,
      fileStatus: node.fileStatus,
      alt: typeof f.alt === "string" && f.alt.trim() !== "" ? f.alt.trim() : node.alt ?? undefined,
    };
  });

  // Batch poll nodes that are not yet READY
  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    const pending = results.filter(
      (r) => r.fileId && r.fileStatus !== "READY" && r.fileStatus !== "FAILED" && !r.shopifyCdnUrl,
    );
    if (pending.length === 0) {
      break;
    }

    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const ids = pending.map((p) => p.fileId as string);
    const chunkSize = 250;
    for (let c = 0; c < ids.length; c += chunkSize) {
      const chunkIds = ids.slice(c, c + chunkSize);
      const polled = await client.query<BatchFileNodesQueryResponse>(
        store,
        BATCH_FILE_NODES_QUERY,
        { ids: chunkIds },
        { isWrite: false },
      );

      if (polled?.nodes) {
        for (const node of polled.nodes) {
          if (!node) continue;
          const target = results.find((r) => r.fileId === node.id);
          if (target) {
            const mutableTarget = target as {
              fileStatus: string;
              shopifyCdnUrl?: string;
              error?: string;
            };
            mutableTarget.fileStatus = node.fileStatus;
            const newUrl = node.image?.url ?? node.url ?? undefined;
            if (newUrl) {
              mutableTarget.shopifyCdnUrl = newUrl;
            }
            if (node.fileStatus === "FAILED") {
              mutableTarget.error = `File processing failed on Shopify for ${node.id}`;
            }
          }
        }
      }
    }
  }

  for (const item of results) {
    if (item.fileStatus !== "READY" || !item.shopifyCdnUrl) {
      if (item.fileStatus !== "FAILED") {
        const mutableItem = item as { fileStatus: string; error?: string };
        mutableItem.fileStatus = "TIMED_OUT";
        mutableItem.error = "File processing timed out waiting for READY status";
      }
    }
  }

  return {
    files: results,
    totalCount: results.length,
    successCount: results.filter((r) => r.fileStatus === "READY" && Boolean(r.shopifyCdnUrl)).length,
    failedCount: results.filter((r) => r.fileStatus !== "READY" || !r.shopifyCdnUrl).length,
  };
}

export const FILE_DELETE_MUTATION = `
  mutation FileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors {
        field
        message
      }
    }
  }
`;

export interface FilesDeletePayload {
  readonly fileIds: readonly string[];
}

export interface FilesDeleteData {
  readonly success: boolean;
  readonly deletedFileIds: readonly string[];
  readonly userErrors?: readonly MutationUserErrorItem[];
}

interface RawFileDeleteResponse {
  readonly fileDelete?: {
    readonly deletedFileIds: readonly string[] | null;
    readonly userErrors?: readonly MutationUserErrorItem[];
  } | null;
}

export async function executeFilesDelete(
  client: ShopifyGraphqlClient,
  store: StoreConfig,
  payload: unknown,
  executionMode: "preview" | "apply",
): Promise<FilesDeleteData> {
  const p = payload as Record<string, unknown> | null;
  if (!p || !Array.isArray(p.fileIds)) {
    throw new GatewayError("fileIds array is required", "SHOPIFY_USER_ERROR", 400);
  }

  const fileIds = (p.fileIds as unknown[]).map(String).filter((id) => id.trim().length > 0);
  if (fileIds.length === 0) {
    return {
      success: true,
      deletedFileIds: [],
    };
  }

  if (executionMode === "preview") {
    return {
      success: true,
      deletedFileIds: fileIds,
    };
  }

  const allDeleted: string[] = [];
  const chunkSize = 250;

  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize);
    const raw = await client.query<RawFileDeleteResponse>(
      store,
      FILE_DELETE_MUTATION,
      { fileIds: chunk },
      { isWrite: true },
    );

    if (!raw?.fileDelete) {
      throw new GatewayError("Shopify returned empty fileDelete response", "SHOPIFY_USER_ERROR", 502);
    }

    if (raw.fileDelete.userErrors && raw.fileDelete.userErrors.length > 0) {
      throw mapUserErrorsToGatewayError(raw.fileDelete.userErrors);
    }

    if (raw.fileDelete.deletedFileIds) {
      allDeleted.push(...raw.fileDelete.deletedFileIds);
    }
  }

  return {
    success: true,
    deletedFileIds: allDeleted,
  };
}

