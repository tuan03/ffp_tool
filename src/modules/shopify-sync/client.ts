import type {
  CreateProductInput,
  CreateProductOutput,
  CreateVariantItem,
  CreateVariantsOutput,
  ShopifyCredentials,
  ShopifyGateway,
  ShopifySyncOptions,
  UploadFileInput,
  UploadFileOutput,
  SetMetafieldInput,
  SetMetafieldOutput,
} from "./types";

interface GraphqlUserError {
  readonly field?: readonly string[];
  readonly message: string;
}

interface GraphqlResponse<T = Record<string, unknown>> {
  readonly data?: T;
  readonly errors?: readonly {
    readonly message: string;
    readonly extensions?: {
      readonly code?: string;
    };
  }[];
}

const CREATE_PRODUCT_MUTATION = `
mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
  productCreate(product: $product, media: $media) {
    product {
      id
      handle
      title
    }
    userErrors {
      field
      message
    }
  }
}
`;

const CREATE_VARIANTS_MUTATION = `
mutation CreateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants {
      id
      title
      price
      sku
    }
    userErrors {
      field
      message
    }
  }
}
`;

const CREATE_FILE_MUTATION = `
mutation CreateFile($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      fileStatus
      alt
      ... on MediaImage {
        image {
          url
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

const GET_FILE_QUERY = `
query GetFile($id: ID!) {
  node(id: $id) {
    ... on File {
      id
      fileStatus
      alt
    }
    ... on MediaImage {
      image {
        url
      }
    }
    ... on GenericFile {
      url
    }
  }
}
`;

const SET_METAFIELDS_MUTATION = `
mutation SetCustomizerMetafield($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      type
    }
    userErrors {
      field
      message
    }
  }
}
`;

export interface ShopifyClient {
  readonly shop: string;
  readonly apiVersion: string;
  readonly request: <T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<T>;
}

function normalizeShopDomain(shop: string): string {
  const clean = shop.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean) {
    throw new Error("Shopify shop domain is required.");
  }
  if (!clean.includes(".")) {
    return `${clean}.myshopify.com`;
  }
  return clean;
}

function isThrottled(errors?: readonly { readonly message?: string; readonly extensions?: { readonly code?: string } }[]): boolean {
  if (!errors || errors.length === 0) {
    return false;
  }
  return errors.some((error) => {
    const code = error.extensions?.code?.toUpperCase() ?? "";
    const msg = error.message ?? "";
    return code === "THROTTLED" || /throttl/i.test(msg);
  });
}

function calculateThrottleDelayMs(
  attempt: number,
  baseDelayMs: number,
  retryAfterHeader?: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const exponential = Math.min(10000, baseDelayMs * 2 ** attempt);
  const jitter = Math.random() * 200;
  return exponential + jitter;
}

function tryLoadEnvFile(): void {
  try {
    if (typeof process !== "undefined" && process.versions?.node) {
      if (process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ACCESS_TOKEN) {
        return;
      }
      const nodeRequire = typeof require === "function" ? require : null;
      if (nodeRequire) {
        const fs = nodeRequire("node:fs");
        const path = nodeRequire("node:path");
        const candidatePaths = [
          path.join(process.cwd(), ".env.shopify"),
          path.join(process.cwd(), "..", "tool_sync_customize", ".env.shopify"),
          path.join(process.cwd(), "..", "tool_shopify", "SHOPIFY_TOOL", ".env.shopify"),
        ];
        for (const candidate of candidatePaths) {
          if (fs.existsSync(candidate)) {
            const content = fs.readFileSync(candidate, "utf8");
            for (const line of content.split(/\r?\n/)) {
              const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
              if (match && !process.env[match[1]]) {
                let val = match[2].trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                  val = val.slice(1, -1);
                }
                process.env[match[1]] = val;
              }
            }
            if (process.env.SHOPIFY_SHOP && process.env.SHOPIFY_ACCESS_TOKEN) {
              break;
            }
          }
        }
      }
    }
  } catch {
    // Ignore in non-node environments
  }
}

export function createShopifyClient(
  credentials?: ShopifyCredentials,
  options?: ShopifySyncOptions,
): ShopifyClient {
  tryLoadEnvFile();

  const shop = normalizeShopDomain(
    credentials?.shop !== undefined
      ? credentials.shop
      : ((typeof process !== "undefined" && process.env?.SHOPIFY_SHOP) || ""),
  );
  const token =
    credentials?.accessToken !== undefined
      ? credentials.accessToken
      : ((typeof process !== "undefined" && process.env?.SHOPIFY_ACCESS_TOKEN) || "");
  const apiVersion =
    credentials?.apiVersion ||
    (typeof process !== "undefined" && process.env?.SHOPIFY_API_VERSION) ||
    "2026-04";

  if (!token) {
    throw new Error("Shopify accessToken is required.");
  }

  const maxAttempts = Math.max(1, options?.maxThrottleAttempts ?? 4);
  const baseDelayMs = Math.max(100, options?.throttleBaseDelayMs ?? 1000);

  return {
    shop,
    apiVersion,
    async request<T = Record<string, unknown>>(
      query: string,
      variables: Record<string, unknown> = {},
    ): Promise<T> {
      const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query, variables }),
        });

        const json = (await response.json().catch(() => ({}))) as GraphqlResponse<T>;
        const throttled = response.status === 429 || isThrottled(json.errors);

        if (throttled && attempt + 1 < maxAttempts) {
          const delay = calculateThrottleDelayMs(
            attempt,
            baseDelayMs,
            response.headers.get("retry-after"),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          const errorMsg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`;
          throw new Error(`Shopify GraphQL HTTP error: ${errorMsg}`);
        }

        if (json.errors && json.errors.length > 0) {
          const errorMsg = json.errors.map((e) => e.message).join("; ");
          throw new Error(`Shopify GraphQL error: ${errorMsg}`);
        }

        if (!json.data) {
          throw new Error("Shopify GraphQL response did not contain data.");
        }

        return json.data;
      }

      throw new Error("Shopify GraphQL request exhausted maximum retry attempts.");
    },
  };
}

/**
 * Creates the default ShopifyGateway implementing the 4 core operations required
 * by the sync pipeline. When Hiệp provides an external module, it can satisfy
 * the same ShopifyGateway interface.
 */
export function createShopifyGateway(
  credentials?: ShopifyCredentials,
  options?: ShopifySyncOptions,
): ShopifyGateway {
  const client = createShopifyClient(credentials, options);

  return {
    async createProduct(input: CreateProductInput): Promise<CreateProductOutput> {
      const mediaInputs = (input.media || []).map((m) => ({
        originalSource: m.originalSource,
        alt: m.alt || input.title,
        mediaContentType: m.mediaContentType || "IMAGE",
      }));

      const productPayload: Record<string, unknown> = {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        vendor: input.vendor || "Default Vendor",
        productType: input.productType || "Customized Item",
        tags: input.tags || [],
      };

      const response = await client.request<{
        productCreate: {
          product: { id: string; handle: string; title: string } | null;
          userErrors: GraphqlUserError[];
        };
      }>(CREATE_PRODUCT_MUTATION, {
        product: productPayload,
        media: mediaInputs.length > 0 ? mediaInputs : undefined,
      });

      const payload = response.productCreate;
      if (payload.userErrors && payload.userErrors.length > 0) {
        const errorMsg = payload.userErrors.map((u) => u.message).join("; ");
        throw new Error(`productCreate user errors: ${errorMsg}`);
      }

      if (!payload.product?.id) {
        throw new Error("productCreate failed: No product returned from Shopify.");
      }

      return {
        productId: payload.product.id,
        productHandle: payload.product.handle,
      };
    },

    async createVariants(
      productId: string,
      variants: readonly CreateVariantItem[],
    ): Promise<CreateVariantsOutput> {
      if (!variants || variants.length === 0) {
        return { createdCount: 0 };
      }

      const bulkVariants = variants.map((v) => ({
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        sku: v.sku,
        barcode: v.barcode,
        optionValues: v.optionValues,
      }));

      const response = await client.request<{
        productVariantsBulkCreate: {
          productVariants: Array<{ id: string }> | null;
          userErrors: GraphqlUserError[];
        };
      }>(CREATE_VARIANTS_MUTATION, {
        productId,
        variants: bulkVariants,
      });

      const payload = response.productVariantsBulkCreate;
      if (payload.userErrors && payload.userErrors.length > 0) {
        const errorMsg = payload.userErrors.map((u) => u.message).join("; ");
        throw new Error(`productVariantsBulkCreate user errors: ${errorMsg}`);
      }

      return {
        createdCount: payload.productVariants?.length ?? 0,
      };
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileOutput> {
      const response = await client.request<{
        fileCreate: {
          files: Array<{
            id: string;
            fileStatus: string;
            image?: { url: string };
            url?: string;
          }> | null;
          userErrors: GraphqlUserError[];
        };
      }>(CREATE_FILE_MUTATION, {
        files: [
          {
            originalSource: input.originalSource,
            filename: input.filename,
            alt: input.alt,
            contentType: "IMAGE",
          },
        ],
      });

      const payload = response.fileCreate;
      if (payload.userErrors && payload.userErrors.length > 0) {
        const errorMsg = payload.userErrors.map((u) => u.message).join("; ");
        throw new Error(`fileCreate user errors: ${errorMsg}`);
      }

      const createdFile = payload.files?.[0];
      if (!createdFile?.id) {
        throw new Error(`fileCreate failed: No file created for ${input.originalSource}`);
      }

      const immediateUrl = createdFile.image?.url || createdFile.url;
      if (immediateUrl && createdFile.fileStatus === "READY") {
        return {
          fileId: createdFile.id,
          shopifyCdnUrl: immediateUrl,
        };
      }

      // Poll briefly for READY status
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const pollResponse = await client.request<{
          node: {
            id: string;
            fileStatus: string;
            image?: { url: string };
            url?: string;
          } | null;
        }>(GET_FILE_QUERY, { id: createdFile.id });

        const node = pollResponse.node;
        if (node && node.fileStatus === "READY") {
          const finalUrl = node.image?.url || node.url || "";
          return {
            fileId: node.id,
            shopifyCdnUrl: finalUrl,
          };
        }
        if (node && node.fileStatus === "FAILED") {
          throw new Error(`Shopify file processing failed for ${input.originalSource}`);
        }
      }

      const fallbackUrl = createdFile.image?.url || createdFile.url || input.originalSource;
      return {
        fileId: createdFile.id,
        shopifyCdnUrl: fallbackUrl,
      };
    },

    async setProductMetafield(input: SetMetafieldInput): Promise<SetMetafieldOutput> {
      const response = await client.request<{
        metafieldsSet: {
          metafields: Array<{ id: string; namespace: string; key: string }> | null;
          userErrors: GraphqlUserError[];
        };
      }>(SET_METAFIELDS_MUTATION, {
        metafields: [
          {
            ownerId: input.productId,
            namespace: input.namespace,
            key: input.key,
            type: input.type,
            value: input.value,
          },
        ],
      });

      const payload = response.metafieldsSet;
      if (payload.userErrors && payload.userErrors.length > 0) {
        const errorMsg = payload.userErrors.map((u) => u.message).join("; ");
        throw new Error(`metafieldsSet user errors: ${errorMsg}`);
      }

      const metafield = payload.metafields?.[0];
      return {
        success: Boolean(metafield?.id),
        metafieldId: metafield?.id,
      };
    },
  };
}
