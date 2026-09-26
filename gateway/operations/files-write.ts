import { FormData } from "undici";

import { executeChunkedWrite } from "../chunked-write";
import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import { createStoreTransport } from "../proxy-transport";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { HttpTransport, StoreConfig } from "../types";
import { isLocalOrPrivateUrl, stageLocalMedia } from "./staged-uploads";

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

export const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

interface StagedUploadCreateResponse {
  readonly stagedUploadsCreate: {
    readonly stagedTargets: readonly {
      readonly url: string;
      readonly resourceUrl: string;
      readonly parameters: readonly { readonly name: string; readonly value: string }[];
    }[] | null;
    readonly userErrors: readonly MutationUserErrorItem[];
  };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function readXmlElement(xml: string, elementName: "Code" | "Message" | "Details"): string | undefined {
  const match = new RegExp(`<${elementName}>([\\s\\S]*?)<\\/${elementName}>`, "i").exec(xml);
  return match?.[1] ? decodeXmlText(match[1]) : undefined;
}

function stagedUploadFailureMessage(status: number, responseBody: string): {
  readonly message: string;
  readonly details: Record<string, unknown>;
} {
  const storageCode = readXmlElement(responseBody, "Code");
  const storageMessage = readXmlElement(responseBody, "Message");
  const storageDetails = readXmlElement(responseBody, "Details");
  const safeParts = [storageCode, storageMessage, storageDetails]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.slice(0, 300));
  return {
    message: `Staged image upload failed with status ${status}${safeParts.length > 0 ? `: ${safeParts.join(" - ")}` : ""}`,
    details: {
      stage: "staged_binary_upload",
      upstreamStatus: status,
      ...(storageCode ? { storageCode: storageCode.slice(0, 100) } : {}),
      ...(storageMessage ? { storageMessage: storageMessage.slice(0, 300) } : {}),
      ...(storageDetails ? { storageDetails: storageDetails.slice(0, 300) } : {}),
    },
  };
}

export async function executeFilesStageBinary(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
  uploadTransport?: HttpTransport,
): Promise<{ readonly resourceUrl: string }> {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const filename = typeof value.filename === "string" ? value.filename.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim() : "";
  const rawResource = typeof value.resource === "string" ? value.resource.trim().toUpperCase() : "";
  const contentBase64 = typeof value.contentBase64 === "string" ? value.contentBase64.trim() : "";
  const rawContent = value.content;
  if (!filename || (!contentBase64 && !rawContent)) {
    throw new GatewayError("filename and contentBase64 are required", "SHOPIFY_USER_ERROR", 400);
  }
  let content: Buffer;
  if (Buffer.isBuffer(rawContent) || rawContent instanceof Uint8Array) {
    content = Buffer.from(rawContent);
  } else if (contentBase64) {
    try {
      content = Buffer.from(contentBase64, "base64");
    } catch (error: unknown) {
      throw new GatewayError("contentBase64 is invalid", "SHOPIFY_USER_ERROR", 400, undefined, error);
    }
  } else {
    throw new GatewayError("contentBase64 is invalid", "SHOPIFY_USER_ERROR", 400);
  }

  const isGenericFile = rawResource === "FILE" || content.length > 20 * 1024 * 1024 || (Boolean(mimeType) && !/^image\/(?:jpeg|png|webp)$/i.test(mimeType));
  const resource = isGenericFile ? "FILE" : "IMAGE";
  const maxBytes = isGenericFile ? 1024 * 1024 * 1024 : 20 * 1024 * 1024;

  if (content.length === 0 || content.length > maxBytes) {
    throw new GatewayError(
      `Staged ${isGenericFile ? "file" : "image"} must be between 1 byte and ${isGenericFile ? "1 GB" : "20 MB"}`,
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

  if (!isGenericFile && (!mimeType || !/^image\/(?:jpeg|png|webp)$/i.test(mimeType))) {
    throw new GatewayError("filename, supported image mimeType and contentBase64 are required", "SHOPIFY_USER_ERROR", 400);
  }

  const resolvedMimeType = mimeType || (isGenericFile ? "application/octet-stream" : "image/jpeg");

  if (mode === "preview") {
    return { resourceUrl: `https://cdn.shopify.com/staged/${encodeURIComponent(filename)}` };
  }
  const response = await client.query<StagedUploadCreateResponse>(
    store,
    STAGED_UPLOADS_CREATE_MUTATION,
    {
      input: [{
        filename,
        mimeType: resolvedMimeType,
        httpMethod: "POST",
        resource,
        fileSize: String(content.length),
      }],
    },
    { isWrite: true, requestId },
  );
  if (response.stagedUploadsCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(response.stagedUploadsCreate.userErrors);
  }
  const target = response.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new GatewayError("Shopify did not return a staged image target", "SHOPIFY_USER_ERROR", 400);
  }
  const transport = uploadTransport ?? createStoreTransport(store);
  // Match FormData implementation to transport:
  // - When using globalThis.fetch (direct connection without proxy), Node's native fetch
  //   requires globalThis.FormData to serialize a valid multipart/form-data body.
  //   Passing undici.FormData to globalThis.fetch causes Node to serialize it as "[object FormData]",
  //   leading to GCS 400 "Cannot create buckets using a POST".
  // - When using proxyTransport (undici.fetch with ProxyAgent), undici requires undici.FormData.
  const useGlobalFormData = transport === globalThis.fetch;
  const form = useGlobalFormData ? new globalThis.FormData() : new FormData();
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append("file", new Blob([Uint8Array.from(content)], { type: resolvedMimeType }), filename);
  let upload: Response;
  try {
    upload = await transport(target.url, {
      method: "POST",
      body: form as unknown as BodyInit,
    });
  } catch (error: unknown) {
    throw new GatewayError("Failed to upload staged image through the configured proxy", "SHOPIFY_NETWORK_ERROR", 502, undefined, error);
  }
  if (!upload.ok) {
    const responseBody = await upload.text().catch(() => "");
    const failure = stagedUploadFailureMessage(upload.status, responseBody.slice(0, 8_192));
    throw new GatewayError(
      failure.message,
      "SHOPIFY_NETWORK_ERROR",
      upload.status,
      undefined,
      undefined,
      undefined,
      upload.status === 408 || upload.status === 429 || upload.status >= 500,
      failure.details,
    );
  }
  return { resourceUrl: target.resourceUrl };
}

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
  const hasCustomPoll = typeof p.pollIntervalMs === "number" || typeof p.maxPollAttempts === "number";
  const pollIntervalMs = typeof p.pollIntervalMs === "number" && p.pollIntervalMs >= 0 ? p.pollIntervalMs : 1000;
  const maxPollAttempts = typeof p.maxPollAttempts === "number" && p.maxPollAttempts > 0 ? p.maxPollAttempts : 30;

  if (mode === "preview") {
    const safeFilename = filename || "mock-file.jpg";
    return {
      fileId: "gid://shopify/MediaImage/preview-file-1",
      shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${safeFilename}`,
      fileStatus: "READY",
      ...(alt ? { alt } : {}),
    };
  }

  let resolvedSource = originalSource;
  if (mode === "apply" && isLocalOrPrivateUrl(originalSource)) {
    resolvedSource = await stageLocalMedia(store, client, originalSource, {
      requestId,
      resource: contentType === "FILE" ? "FILE" : undefined,
    });
  }

  const fileInput: Record<string, unknown> = {
    originalSource: resolvedSource,
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
      const waitTime = hasCustomPoll
        ? pollIntervalMs
        : Math.min(3000, Math.floor(1000 * Math.pow(1.15, attempt)));
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
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

  const hasCustomPoll = typeof p.pollIntervalMs === "number" || typeof p.maxPollAttempts === "number";
  const pollIntervalMs = typeof p.pollIntervalMs === "number" && p.pollIntervalMs >= 0 ? p.pollIntervalMs : 1000;
  const maxPollAttempts = typeof p.maxPollAttempts === "number" && p.maxPollAttempts > 0 ? p.maxPollAttempts : 30;

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

  type CreatedNode = NonNullable<FileCreateResponse["fileCreate"]["files"]>[number];
  const chunkedResult = await executeChunkedWrite<Record<string, unknown>, CreatedNode[]>({
    items: fileInputs,
    chunkSize: 250,
    operationName: "files.bulkCreate",
    executeChunk: async (chunk, chunkIndex) => {
      const chunkReqId = requestId ? `${requestId}:${chunkIndex}` : undefined;
      const raw = await client.query<FileCreateResponse>(
        store,
        FILE_CREATE_MUTATION,
        { files: chunk },
        { isWrite: true, requestId: chunkReqId },
      );

      const createdNodes = (raw.fileCreate.files ?? []).filter(Boolean);
      const userErrors = raw.fileCreate.userErrors ?? [];

      if (userErrors.length > 0) {
        if (createdNodes.length > 0) {
          const createdFileIds = createdNodes.map((n) => n.id);
          const errMsg = `Shopify fileCreate partially created ${createdNodes.length} file(s) but failed with user errors: ${userErrors.map((e) => e.message).join(", ")}`;
          throw new GatewayError(
            errMsg,
            "SHOPIFY_PARTIAL_WRITE",
            409,
            undefined,
            undefined,
            userErrors.flatMap((e) => (e.field ? [...e.field] : [])),
            false,
            {
              createdFileIds,
              userErrors,
              reconciliationRequired: true,
            },
            true,
          );
        }
        throw mapUserErrorsToGatewayError(userErrors);
      }

      return createdNodes as CreatedNode[];
    },
    extractCompletedDetails: (completedResults) => {
      const allFiles = completedResults.flat().filter(Boolean);
      return {
        completedCount: allFiles.length,
        createdFileIds: allFiles.map((f) => f.id),
      };
    },
  });

  const allCreatedNodes = chunkedResult.chunkResults.flat();

  const results: FilesBulkCreateItemResult[] = rawFiles.map((f, idx) => {
    const originalSource = typeof f.originalSource === "string" ? f.originalSource.trim() : "";
    const node = allCreatedNodes[idx];
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
      (r) => r.fileId && r.fileStatus !== "READY" && r.fileStatus !== "FAILED",
    );
    if (pending.length === 0) {
      break;
    }

    const waitTime = hasCustomPoll
      ? pollIntervalMs
      : Math.min(3000, Math.floor(1000 * Math.pow(1.15, attempt)));
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
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
  requestId?: string,
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

  const chunkedResult = await executeChunkedWrite<string, readonly string[]>({
    items: fileIds,
    chunkSize: 250,
    operationName: "files.delete",
    executeChunk: async (chunk, chunkIndex) => {
      const chunkReqId = requestId ? `${requestId}:del:${chunkIndex}` : undefined;
      const raw = await client.query<RawFileDeleteResponse>(
        store,
        FILE_DELETE_MUTATION,
        { fileIds: chunk },
        { isWrite: true, requestId: chunkReqId },
      );

      if (!raw?.fileDelete) {
        throw new GatewayError("Shopify returned empty fileDelete response", "SHOPIFY_USER_ERROR", 502);
      }

      const deletedIds = raw.fileDelete.deletedFileIds ?? [];
      const userErrors = raw.fileDelete.userErrors ?? [];

      if (userErrors.length > 0) {
        if (deletedIds.length > 0) {
          const errMsg = `Shopify fileDelete partially deleted ${deletedIds.length} file(s) but failed with user errors: ${userErrors.map((e) => e.message).join(", ")}`;
          throw new GatewayError(
            errMsg,
            "SHOPIFY_PARTIAL_WRITE",
            409,
            undefined,
            undefined,
            userErrors.flatMap((e) => (e.field ? [...e.field] : [])),
            false,
            {
              deletedFileIds: deletedIds,
              userErrors,
              reconciliationRequired: true,
            },
            true,
          );
        }
        throw mapUserErrorsToGatewayError(userErrors);
      }

      return deletedIds;
    },
    extractCompletedDetails: (completedResults) => {
      const allDeleted = completedResults.flat();
      return {
        completedCount: allDeleted.length,
        deletedFileIds: allDeleted,
      };
    },
  });

  const allDeleted = chunkedResult.chunkResults.flat();

  return {
    success: true,
    deletedFileIds: allDeleted,
  };
}

export const FILES_LIST_QUERY = `
  query FilesList($first: Int, $after: String, $query: String) {
    files(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          fileStatus
          alt
          createdAt
          updatedAt
          ... on MediaImage {
            image {
              url
              width
              height
            }
          }
          ... on GenericFile {
            url
            mimeType
            originalFileSize
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export interface FilesListPayload {
  readonly first?: number;
  readonly after?: string;
  readonly query?: string;
}

export interface ShopifyFileItem {
  readonly id: string;
  readonly url: string;
  readonly altText?: string;
  readonly fileStatus: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface FilesListData {
  readonly files: readonly ShopifyFileItem[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage?: boolean;
    readonly startCursor?: string | null;
    readonly endCursor?: string | null;
  };
}

interface RawFilesListResponse {
  readonly files?: {
    readonly edges?: readonly {
      readonly cursor: string;
      readonly node: {
        readonly id: string;
        readonly fileStatus: string;
        readonly alt?: string | null;
        readonly createdAt: string;
        readonly updatedAt?: string | null;
        readonly image?: {
          readonly url: string;
          readonly width?: number | null;
          readonly height?: number | null;
        } | null;
        readonly url?: string | null;
        readonly mimeType?: string | null;
        readonly originalFileSize?: number | null;
      };
    }[];
    readonly pageInfo?: {
      readonly hasNextPage?: boolean;
      readonly hasPreviousPage?: boolean;
      readonly startCursor?: string | null;
      readonly endCursor?: string | null;
    };
  };
}

export async function executeFilesList(
  client: ShopifyGraphqlClient,
  store: StoreConfig,
  payload: unknown,
  executionMode: "preview" | "apply",
): Promise<FilesListData> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const first = typeof p.first === "number" && p.first > 0 ? Math.min(p.first, 250) : 50;
  const after = typeof p.after === "string" && p.after.trim() !== "" ? p.after.trim() : undefined;
  const query = typeof p.query === "string" && p.query.trim() !== "" ? p.query.trim() : undefined;

  if (executionMode === "preview") {
    return {
      files: [
        {
          id: "gid://shopify/MediaImage/preview-file-1",
          url: "https://cdn.shopify.com/s/files/1/0000/preview-file-1.jpg",
          altText: "Preview Image",
          fileStatus: "READY",
          createdAt: new Date().toISOString(),
          width: 800,
          height: 600,
        },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: "cur-1",
        endCursor: "cur-1",
      },
    };
  }

  const raw = await client.query<RawFilesListResponse>(
    store,
    FILES_LIST_QUERY,
    { first, after, query },
    { isWrite: false },
  );

  const edges = raw?.files?.edges ?? [];
  const files: ShopifyFileItem[] = edges.map((e) => {
    const node = e.node;
    const url = node.image?.url ?? node.url ?? "";
    return {
      id: node.id,
      url,
      altText: node.alt ?? undefined,
      fileStatus: node.fileStatus,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt ?? undefined,
      mimeType: node.mimeType ?? undefined,
      width: typeof node.image?.width === "number" ? node.image.width : undefined,
      height: typeof node.image?.height === "number" ? node.image.height : undefined,
    };
  });

  return {
    files,
    pageInfo: {
      hasNextPage: Boolean(raw?.files?.pageInfo?.hasNextPage),
      hasPreviousPage: Boolean(raw?.files?.pageInfo?.hasPreviousPage),
      startCursor: raw?.files?.pageInfo?.startCursor ?? null,
      endCursor: raw?.files?.pageInfo?.endCursor ?? null,
    },
  };
}

