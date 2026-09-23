import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { GatewayErrorCode, ProductImageSummary, ProductSummary, ProductVariantSummary, StoreConfig } from "../types";
import { mapProductNode, type RawProductNode } from "./products";

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        description
        descriptionHtml
        status
        vendor
        productType
        tags
        onlineStoreUrl
        featuredImage {
          id
          url
          altText
          width
          height
        }
        images(first: 50) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              url
              altText
              width
              height
            }
          }
        }
        seo {
          title
          description
        }
        createdAt
        updatedAt
        variants(first: 100) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              title
              price
              sku
              barcode
              inventoryQuantity
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_HANDLE_LOOKUP_QUERY = `
  query ProductHandleLookup($handle: String!) {
    productByHandle(handle: $handle) {
      id
    }
  }
`;

const MAX_HANDLE_SUFFIX = 100;

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
      productVariants {
        id
        title
        price
        compareAtPrice
        barcode
        inventoryQuantity
        inventoryItem {
          sku
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product {
        id
        title
        handle
        description
        descriptionHtml
        status
        vendor
        productType
        tags
        onlineStoreUrl
        featuredImage {
          id
          url
          altText
          width
          height
        }
        images(first: 50) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              url
              altText
              width
              height
            }
          }
        }
        seo {
          title
          description
        }
        createdAt
        updatedAt
        variants(first: 100) {
          pageInfo {
            hasNextPage
          }
          edges {
            node {
              id
              title
              price
              sku
              barcode
              inventoryQuantity
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_UPDATE_MUTATION = `
  mutation FileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
        alt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface FileUpdateItem {
  readonly id: string;
  readonly alt?: string;
}

export interface CreateMediaInputItem {
  readonly originalSource: string;
  readonly mediaContentType: "IMAGE" | "VIDEO";
  readonly alt?: string;
}

function extractMediaInputs(
  featuredImage?: unknown,
  images?: unknown,
  media?: unknown,
): readonly CreateMediaInputItem[] {
  const mediaList: CreateMediaInputItem[] = [];
  const seenUrls = new Set<string>();

  const addMedia = (rawUrl?: unknown, rawAlt?: unknown, rawContentType?: unknown) => {
    if (typeof rawUrl !== "string") return;
    const url = rawUrl.trim();
    if (!url || seenUrls.has(url)) return;
    const alt = typeof rawAlt === "string" && rawAlt.trim() ? rawAlt.trim() : undefined;
    const mediaContentType =
      rawContentType === "VIDEO" || rawContentType === "IMAGE" ? rawContentType : "IMAGE";
    mediaList.push({
      originalSource: url,
      mediaContentType,
      ...(alt ? { alt } : {}),
    });
    seenUrls.add(url);
  };

  if (featuredImage && typeof featuredImage === "object") {
    const feat = featuredImage as Record<string, unknown>;
    const url = typeof feat.url === "string" ? feat.url : typeof feat.src === "string" ? feat.src : undefined;
    const alt = typeof feat.altText === "string" ? feat.altText : typeof feat.alt === "string" ? feat.alt : undefined;
    addMedia(url, alt);
  }

  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string") {
        addMedia(img, undefined);
      } else if (img && typeof img === "object") {
        const imgObj = img as Record<string, unknown>;
        const url =
          typeof imgObj.originalSource === "string"
            ? imgObj.originalSource
            : typeof imgObj.url === "string"
            ? imgObj.url
            : typeof imgObj.src === "string"
            ? imgObj.src
            : undefined;
        const alt = typeof imgObj.altText === "string" ? imgObj.altText : typeof imgObj.alt === "string" ? imgObj.alt : undefined;
        addMedia(url, alt);
      }
    }
  }

  if (Array.isArray(media)) {
    for (const item of media) {
      if (typeof item === "string") {
        addMedia(item, undefined);
      } else if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        const url =
          typeof itemObj.originalSource === "string"
            ? itemObj.originalSource
            : typeof itemObj.url === "string"
            ? itemObj.url
            : typeof itemObj.src === "string"
            ? itemObj.src
            : undefined;
        const alt =
          typeof itemObj.alt === "string"
            ? itemObj.alt
            : typeof itemObj.altText === "string"
            ? itemObj.altText
            : undefined;
        const contentType = itemObj.mediaContentType;
        addMedia(url, alt, contentType);
      }
    }
  }

  return mediaList;
}

async function resolveAvailableProductHandle(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  requestedHandle: string,
): Promise<string> {
  interface ProductHandleLookupResponse {
    readonly productByHandle: { readonly id: string } | null;
  }

  for (let suffix = 1; suffix <= MAX_HANDLE_SUFFIX; suffix += 1) {
    const candidate = suffix === 1 ? requestedHandle : `${requestedHandle}-${suffix}`;
    const result = await client.query<ProductHandleLookupResponse>(
      store,
      PRODUCT_HANDLE_LOOKUP_QUERY,
      { handle: candidate },
    );
    if (!result.productByHandle) {
      return candidate;
    }
  }

  throw new GatewayError(
    `Unable to allocate a unique product handle for '${requestedHandle}'`,
    "SHOPIFY_USER_ERROR",
    400,
  );
}

export async function executeProductsCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ product: ProductSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const productInput = (p.product && typeof p.product === "object" ? p.product : undefined) as
    | Record<string, unknown>
    | undefined;

  if (!productInput) {
    throw new GatewayError("Product payload is required", "SHOPIFY_USER_ERROR", 400);
  }

  const title = typeof productInput.title === "string" ? productInput.title.trim() : "";
  if (!title) {
    throw new GatewayError("Product title is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const handle =
      typeof productInput.handle === "string" && productInput.handle.trim() !== ""
        ? productInput.handle.trim()
        : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const previewVariants: ProductVariantSummary[] =
      Array.isArray(productInput.variants) && productInput.variants.length > 0
        ? (productInput.variants as readonly Record<string, unknown>[]).map((v, i) => ({
            id: `gid://shopify/ProductVariant/preview-var-${i + 1}`,
            productId: "gid://shopify/Product/preview-new",
            title:
              typeof v.title === "string"
                ? v.title
                : Array.isArray(v.optionValues)
                ? (v.optionValues as Record<string, unknown>[])
                    .map((ov) => (typeof ov.name === "string" ? ov.name : typeof ov.value === "string" ? ov.value : ""))
                    .filter(Boolean)
                    .join(" / ") || "Default Title"
                : "Default Title",
            price: typeof v.price === "string" ? v.price : "0.00",
            compareAtPrice: typeof v.compareAtPrice === "string" ? v.compareAtPrice : undefined,
            sku: typeof v.sku === "string" ? v.sku : undefined,
            barcode: typeof v.barcode === "string" ? v.barcode : undefined,
          }))
        : [
            {
              id: "gid://shopify/ProductVariant/preview-var-1",
              productId: "gid://shopify/Product/preview-new",
              title: "Default Title",
              price: "0.00",
            },
          ];

    const previewProduct: ProductSummary = {
      id: "gid://shopify/Product/preview-new",
      title,
      handle,
      description:
        typeof productInput.description === "string" ? productInput.description : undefined,
      descriptionHtml:
        typeof productInput.descriptionHtml === "string" ? productInput.descriptionHtml : undefined,
      status:
        productInput.status === "ACTIVE" || productInput.status === "ARCHIVED" || productInput.status === "DRAFT"
          ? productInput.status
          : "DRAFT",
      vendor: typeof productInput.vendor === "string" ? productInput.vendor : undefined,
      productType: typeof productInput.productType === "string" ? productInput.productType : undefined,
      tags: Array.isArray(productInput.tags) ? (productInput.tags as string[]) : [],
      onlineStoreUrl:
        typeof productInput.onlineStoreUrl === "string"
          ? productInput.onlineStoreUrl
          : typeof productInput.handle === "string" && productInput.handle.trim() !== ""
          ? `https://${store.shopDomain}/products/${productInput.handle.trim()}`
          : title
          ? `https://${store.shopDomain}/products/${title.toLowerCase().replace(/\s+/g, "-")}`
          : undefined,
      featuredImage:
        productInput.featuredImage && typeof productInput.featuredImage === "object" && typeof (productInput.featuredImage as Record<string, unknown>).url === "string" && ((productInput.featuredImage as Record<string, unknown>).url as string).trim() !== ""
          ? {
              id: typeof (productInput.featuredImage as Record<string, unknown>).id === "string" ? (productInput.featuredImage as Record<string, unknown>).id as string : undefined,
              url: ((productInput.featuredImage as Record<string, unknown>).url as string).trim(),
              altText: typeof (productInput.featuredImage as Record<string, unknown>).altText === "string" ? (productInput.featuredImage as Record<string, unknown>).altText as string : undefined,
              width: typeof (productInput.featuredImage as Record<string, unknown>).width === "number" ? (productInput.featuredImage as Record<string, unknown>).width as number : undefined,
              height: typeof (productInput.featuredImage as Record<string, unknown>).height === "number" ? (productInput.featuredImage as Record<string, unknown>).height as number : undefined,
            }
          : undefined,
      images: Array.isArray(productInput.images) || Array.isArray(productInput.media)
        ? [
            ...(Array.isArray(productInput.images) ? (productInput.images as readonly unknown[]) : []),
            ...(Array.isArray(productInput.media) ? (productInput.media as readonly unknown[]) : []),
          ]
            .map((img): ProductImageSummary | undefined => {
              if (typeof img === "string" && img.trim() !== "") {
                return { url: img.trim() };
              }
              if (img && typeof img === "object") {
                const imgObj = img as Record<string, unknown>;
                const url =
                  typeof imgObj.originalSource === "string"
                    ? imgObj.originalSource.trim()
                    : typeof imgObj.url === "string"
                    ? imgObj.url.trim()
                    : typeof imgObj.src === "string"
                    ? imgObj.src.trim()
                    : "";
                if (url) {
                  return {
                    id: typeof imgObj.id === "string" ? imgObj.id : typeof imgObj.id === "number" ? String(imgObj.id) : undefined,
                    url,
                    altText:
                      typeof imgObj.altText === "string"
                        ? imgObj.altText
                        : typeof imgObj.alt === "string"
                        ? imgObj.alt
                        : undefined,
                    width: typeof imgObj.width === "number" ? imgObj.width : undefined,
                    height: typeof imgObj.height === "number" ? imgObj.height : undefined,
                  };
                }
              }
              return undefined;
            })
            .filter((img): img is ProductImageSummary => img !== undefined)
        : undefined,
      variants: previewVariants,
      seo:
        productInput.seo && typeof productInput.seo === "object"
          ? {
              title: typeof (productInput.seo as Record<string, unknown>).title === "string" ? (productInput.seo as Record<string, unknown>).title as string : undefined,
              description: typeof (productInput.seo as Record<string, unknown>).description === "string" ? (productInput.seo as Record<string, unknown>).description as string : undefined,
            }
          : undefined,
      hasMoreVariants: false,
      hasMoreImages: false,
      createdAt: now,
      updatedAt: now,
    };

    return { product: previewProduct };
  }

  const input: Record<string, unknown> = { title };
  if (typeof productInput.handle === "string" && productInput.handle.trim() !== "") {
    input.handle = await resolveAvailableProductHandle(store, client, productInput.handle.trim());
  }
  if (typeof productInput.descriptionHtml === "string") {
    input.descriptionHtml = productInput.descriptionHtml;
  } else if (typeof productInput.description === "string") {
    input.descriptionHtml = productInput.description;
  }
  if (typeof productInput.status === "string" && productInput.status.trim() !== "") {
    input.status = productInput.status.trim();
  }
  if (typeof productInput.vendor === "string") {
    input.vendor = productInput.vendor;
  }
  if (typeof productInput.productType === "string") {
    input.productType = productInput.productType;
  }
  if (Array.isArray(productInput.tags)) {
    input.tags = productInput.tags;
  }
  if (productInput.seo && typeof productInput.seo === "object") {
    const seoObj = productInput.seo as Record<string, unknown>;
    const seo: Record<string, unknown> = {};
    if (typeof seoObj.title === "string") seo.title = seoObj.title;
    if (typeof seoObj.description === "string") seo.description = seoObj.description;
    if (Object.keys(seo).length > 0) {
      input.seo = seo;
    }
  }

  if (Array.isArray(productInput.productOptions) && productInput.productOptions.length > 0) {
    input.productOptions = (productInput.productOptions as readonly { name: string; values?: unknown[] }[]).map((opt) => ({
      name: opt.name,
      values: Array.isArray(opt.values)
        ? opt.values.map((v) => (typeof v === "string" ? { name: v } : { name: (v as { name: string }).name }))
        : [],
    }));
  } else if (Array.isArray(productInput.variants) && productInput.variants.length > 0) {
    const optionMap = new Map<string, Set<string>>();
    for (const v of productInput.variants as readonly Record<string, unknown>[]) {
      if (Array.isArray(v.optionValues)) {
        for (const ov of v.optionValues as readonly Record<string, unknown>[]) {
          const optName =
            typeof ov.optionName === "string" && ov.optionName.trim() !== ""
              ? ov.optionName.trim()
              : "Title";
          const valName =
            typeof ov.name === "string" && ov.name.trim() !== ""
              ? ov.name.trim()
              : typeof ov.value === "string" && ov.value.trim() !== ""
              ? ov.value.trim()
              : undefined;
          if (valName) {
            if (!optionMap.has(optName)) {
              optionMap.set(optName, new Set());
            }
            optionMap.get(optName)!.add(valName);
          }
        }
      }
    }
    if (optionMap.size > 0 && !(optionMap.size === 1 && optionMap.has("Title"))) {
      input.productOptions = Array.from(optionMap.entries()).map(([name, valSet]) => ({
        name,
        values: Array.from(valSet).map((val) => ({ name: val })),
      }));
    }
  }

  interface ProductCreateResponse {
    readonly productCreate: {
      readonly product: RawProductNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const mediaList = extractMediaInputs(productInput.featuredImage, productInput.images, productInput.media);
  const createVariables: Record<string, unknown> = { product: input };
  if (mediaList.length > 0) {
    createVariables.media = mediaList;
  }

  const raw = await client.query<ProductCreateResponse>(
    store,
    PRODUCT_CREATE_MUTATION,
    createVariables,
    { isWrite: true, requestId },
  );

  if (raw.productCreate.userErrors && raw.productCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productCreate.userErrors);
  }

  if (!raw.productCreate.product) {
    throw new GatewayError("Failed to create product; missing product data", "SHOPIFY_USER_ERROR", 400);
  }

  const product = mapProductNode(raw.productCreate.product);

  // If public input contains variants (>= 1), create variants via productVariantsBulkCreate
  // with strategy: REMOVE_STANDALONE_VARIANT so the initial default standalone variant is deleted
  if (Array.isArray(productInput.variants) && productInput.variants.length >= 1) {
    const allVariants = productInput.variants as readonly Record<string, unknown>[];
    const variantsInput = allVariants.map((v) => {
      const vInput: Record<string, unknown> = {};
      if (v.price !== undefined) vInput.price = v.price;
      if (v.compareAtPrice !== undefined) vInput.compareAtPrice = v.compareAtPrice;
      if (v.barcode !== undefined) vInput.barcode = v.barcode;
      const isTracked = v.inventoryTracked === true;
      vInput.inventoryItem = {
        sku: typeof v.sku === "string" ? v.sku : undefined,
        tracked: isTracked,
      };
      vInput.inventoryPolicy = isTracked ? "DENY" : "CONTINUE";
      if (Array.isArray(v.optionValues)) {
        vInput.optionValues = (v.optionValues as readonly Record<string, unknown>[]).map((ov) => {
          const optVal: Record<string, unknown> = {};
          if (typeof ov.optionName === "string") optVal.optionName = ov.optionName;
          if (typeof ov.name === "string") {
            optVal.name = ov.name;
          } else if (typeof ov.value === "string") {
            optVal.name = ov.value;
          }
          if (typeof ov.optionId === "string") optVal.optionId = ov.optionId;
          if (typeof ov.id === "string") optVal.id = ov.id;
          return optVal;
        });
      } else if (typeof v.title === "string" && v.title.trim() !== "") {
        vInput.optionValues = [{ optionName: "Title", name: v.title.trim() }];
      }
      return vInput;
    });

    interface ProductVariantsBulkCreateResponse {
      readonly productVariantsBulkCreate: {
        readonly productVariants: readonly {
          readonly id: string;
          readonly title: string;
          readonly price: string;
          readonly compareAtPrice?: string | null;
          readonly barcode?: string | null;
          readonly inventoryQuantity?: number | null;
          readonly inventoryItem?: { readonly sku?: string | null } | null;
        }[] | null;
        readonly userErrors: readonly MutationUserErrorItem[];
      };
    }

    try {
      const extraRaw = await client.query<ProductVariantsBulkCreateResponse>(
        store,
        PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
        { productId: product.id, variants: variantsInput },
        { isWrite: true, requestId: requestId ? `${requestId}:variants` : undefined },
      );

      if (extraRaw.productVariantsBulkCreate.userErrors && extraRaw.productVariantsBulkCreate.userErrors.length > 0) {
        throw mapUserErrorsToGatewayError(extraRaw.productVariantsBulkCreate.userErrors);
      }

      if (extraRaw.productVariantsBulkCreate.productVariants) {
        const mappedVariants: ProductVariantSummary[] = extraRaw.productVariantsBulkCreate.productVariants.map((node) => ({
          id: node.id,
          productId: product.id,
          title: node.title,
          price: node.price,
          compareAtPrice: node.compareAtPrice ?? undefined,
          barcode: node.barcode ?? undefined,
          sku: node.inventoryItem?.sku ?? undefined,
          inventoryQuantity: node.inventoryQuantity ?? undefined,
        }));
        return {
          product: {
            ...product,
            variants: mappedVariants,
          },
        };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const fields = err instanceof GatewayError ? err.fields : undefined;
      throw new GatewayError(
        `Product created (${product.id}) but failed to create variants: ${errMsg}`,
        "SHOPIFY_PARTIAL_WRITE",
        409,
        undefined,
        err,
        fields,
        false,
        { createdProductId: product.id, reconciliationRequired: true },
        true,
      );
    }
  }

  return { product };
}

export async function executeProductsUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ product: ProductSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Product id is required", "SHOPIFY_USER_ERROR", 400);
  }

  const productPatch = (p.product && typeof p.product === "object" ? p.product : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!productPatch) {
    throw new GatewayError("Product patch object is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const previewProduct: ProductSummary = {
      id,
      title: typeof productPatch.title === "string" ? productPatch.title : "Preview Product",
      handle: typeof productPatch.handle === "string" ? productPatch.handle : "preview-product",
      description:
        typeof productPatch.description === "string" ? productPatch.description : undefined,
      descriptionHtml:
        typeof productPatch.descriptionHtml === "string" ? productPatch.descriptionHtml : undefined,
      status:
        productPatch.status === "ACTIVE" || productPatch.status === "ARCHIVED" || productPatch.status === "DRAFT"
          ? productPatch.status
          : "ACTIVE",
      vendor: typeof productPatch.vendor === "string" ? productPatch.vendor : undefined,
      productType: typeof productPatch.productType === "string" ? productPatch.productType : undefined,
      tags: Array.isArray(productPatch.tags) ? (productPatch.tags as string[]) : [],
      onlineStoreUrl:
        typeof productPatch.onlineStoreUrl === "string"
          ? productPatch.onlineStoreUrl
          : typeof productPatch.handle === "string" && productPatch.handle.trim() !== ""
          ? `https://${store.shopDomain}/products/${productPatch.handle.trim()}`
          : undefined,
      featuredImage:
        productPatch.featuredImage && typeof productPatch.featuredImage === "object"
          ? (() => {
              const feat = productPatch.featuredImage as Record<string, unknown>;
              const url = typeof feat.url === "string" ? feat.url.trim() : typeof feat.src === "string" ? feat.src.trim() : "";
              const rawId = typeof feat.id === "string" && feat.id.trim() !== "" ? feat.id.trim() : typeof feat.id === "number" ? String(feat.id) : undefined;
              if (!url && !rawId) return undefined;
              const alt = typeof feat.altText === "string" ? feat.altText : typeof feat.alt === "string" ? feat.alt : feat.altText === null || feat.alt === null ? "" : undefined;
              return {
                id: rawId,
                url: url || "",
                altText: alt,
                width: typeof feat.width === "number" ? feat.width : undefined,
                height: typeof feat.height === "number" ? feat.height : undefined,
              };
            })()
          : undefined,
      images: Array.isArray(productPatch.images)
        ? (productPatch.images as readonly unknown[])
            .map((img): ProductImageSummary | undefined => {
              if (typeof img === "string" && img.trim() !== "") {
                return { url: img.trim() };
              }
              if (img && typeof img === "object") {
                const imgObj = img as Record<string, unknown>;
                const url = typeof imgObj.url === "string" ? imgObj.url.trim() : typeof imgObj.src === "string" ? imgObj.src.trim() : "";
                const rawId = typeof imgObj.id === "string" && imgObj.id.trim() !== "" ? imgObj.id.trim() : typeof imgObj.id === "number" ? String(imgObj.id) : undefined;
                if (!url && !rawId) return undefined;
                const alt = typeof imgObj.altText === "string" ? imgObj.altText : typeof imgObj.alt === "string" ? imgObj.alt : imgObj.altText === null || imgObj.alt === null ? "" : undefined;
                return {
                  id: rawId,
                  url: url || "",
                  altText: alt,
                  width: typeof imgObj.width === "number" ? imgObj.width : undefined,
                  height: typeof imgObj.height === "number" ? imgObj.height : undefined,
                };
              }
              return undefined;
            })
            .filter((img): img is ProductImageSummary => img !== undefined)
        : undefined,
      variants: [],
      seo:
        productPatch.seo && typeof productPatch.seo === "object"
          ? {
              title: typeof (productPatch.seo as Record<string, unknown>).title === "string" ? (productPatch.seo as Record<string, unknown>).title as string : undefined,
              description: typeof (productPatch.seo as Record<string, unknown>).description === "string" ? (productPatch.seo as Record<string, unknown>).description as string : undefined,
            }
          : undefined,
      hasMoreVariants: false,
      hasMoreImages: false,
      createdAt: now,
      updatedAt: now,
    };
    return { product: previewProduct };
  }

  const input: Record<string, unknown> = { id };
  if (typeof productPatch.title === "string") {
    input.title = productPatch.title;
  }
  if (typeof productPatch.handle === "string") {
    input.handle = productPatch.handle;
  }
  if (typeof productPatch.descriptionHtml === "string") {
    input.descriptionHtml = productPatch.descriptionHtml;
  } else if (typeof productPatch.description === "string") {
    input.descriptionHtml = productPatch.description;
  }
  if (typeof productPatch.status === "string") {
    input.status = productPatch.status;
  }
  if (typeof productPatch.vendor === "string") {
    input.vendor = productPatch.vendor;
  }
  if (typeof productPatch.productType === "string") {
    input.productType = productPatch.productType;
  }
  if (Array.isArray(productPatch.tags)) {
    input.tags = productPatch.tags;
  }
  if (productPatch.seo && typeof productPatch.seo === "object") {
    const seoObj = productPatch.seo as Record<string, unknown>;
    const seo: Record<string, unknown> = {};
    if (typeof seoObj.title === "string") seo.title = seoObj.title;
    if (typeof seoObj.description === "string") seo.description = seoObj.description;
    if (Object.keys(seo).length > 0) {
      input.seo = seo;
    }
  }

  const fileUpdateList: FileUpdateItem[] = [];
  const mediaList: CreateMediaInputItem[] = [];
  const seenFileIds = new Set<string>();
  const seenMediaUrls = new Set<string>();

  const processImageEntry = (img: unknown) => {
    if (!img) return;
    if (typeof img === "string") {
      const url = img.trim();
      if (url && !seenMediaUrls.has(url)) {
        seenMediaUrls.add(url);
        mediaList.push({
          originalSource: url,
          mediaContentType: "IMAGE",
        });
      }
      return;
    }
    if (typeof img === "object") {
      const imgObj = img as Record<string, unknown>;
      const rawId =
        typeof imgObj.id === "string" && imgObj.id.trim() !== ""
          ? imgObj.id.trim()
          : typeof imgObj.id === "number"
          ? String(imgObj.id)
          : undefined;
      const rawUrl =
        typeof imgObj.originalSource === "string" && imgObj.originalSource.trim() !== ""
          ? imgObj.originalSource.trim()
          : typeof imgObj.url === "string" && imgObj.url.trim() !== ""
          ? imgObj.url.trim()
          : typeof imgObj.src === "string" && imgObj.src.trim() !== ""
          ? imgObj.src.trim()
          : undefined;
      const rawAlt =
        typeof imgObj.altText === "string"
          ? imgObj.altText
          : typeof imgObj.alt === "string"
          ? imgObj.alt
          : imgObj.altText === null || imgObj.alt === null
          ? ""
          : undefined;

      if (rawId) {
        // a) Existing images with id: Update alt text using fileUpdate mutation
        if (!seenFileIds.has(rawId)) {
          seenFileIds.add(rawId);
          if (rawAlt !== undefined) {
            fileUpdateList.push({ id: rawId, alt: rawAlt });
          }
        }
      } else if (rawUrl) {
        // b) New images (having url but no existing id): Append as new media in productUpdate
        if (!seenMediaUrls.has(rawUrl)) {
          seenMediaUrls.add(rawUrl);
          const rawContentType =
            imgObj.mediaContentType === "VIDEO" || imgObj.mediaContentType === "IMAGE"
              ? imgObj.mediaContentType
              : "IMAGE";
          mediaList.push({
            originalSource: rawUrl,
            mediaContentType: rawContentType,
            ...(rawAlt !== undefined && rawAlt.trim() ? { alt: rawAlt.trim() } : {}),
          });
        }
      }
    }
  };

  processImageEntry(productPatch.featuredImage);
  if (Array.isArray(productPatch.images)) {
    for (const img of productPatch.images) {
      processImageEntry(img);
    }
  }
  if (Array.isArray(productPatch.media)) {
    for (const item of productPatch.media) {
      processImageEntry(item);
    }
  }

  interface ProductUpdateResponse {
    readonly productUpdate: {
      readonly product: RawProductNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const updateVariables: Record<string, unknown> = { product: input };
  if (mediaList.length > 0) {
    updateVariables.media = mediaList;
  }

  const raw = await client.query<ProductUpdateResponse>(
    store,
    PRODUCT_UPDATE_MUTATION,
    updateVariables,
    { isWrite: true, requestId },
  );

  if (raw.productUpdate.userErrors && raw.productUpdate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productUpdate.userErrors);
  }

  if (!raw.productUpdate.product) {
    throw new GatewayError(`Failed to update product ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  if (fileUpdateList.length > 0) {
    interface FileUpdateResponse {
      readonly fileUpdate: {
        readonly files: readonly { readonly id: string; readonly alt?: string | null }[] | null;
        readonly userErrors: readonly MutationUserErrorItem[];
      } | null;
    }

    try {
      const rawFileUpdate = await client.query<FileUpdateResponse>(
        store,
        FILE_UPDATE_MUTATION,
        { files: fileUpdateList },
        { isWrite: true, requestId: requestId ? `${requestId}:file-update` : undefined },
      );

      if (!rawFileUpdate || !rawFileUpdate.fileUpdate || (rawFileUpdate.fileUpdate.userErrors && rawFileUpdate.fileUpdate.userErrors.length > 0)) {
        const userErrors = rawFileUpdate?.fileUpdate?.userErrors ?? [];
        const errMsg = userErrors.length > 0 ? userErrors.map((e) => e.message).join("; ") : "fileUpdate returned no data";
        const fields = userErrors.flatMap((e) => (e.field ? [...e.field] : []));
        throw new GatewayError(
          `Product updated (${id}) but failed to update image files: ${errMsg}`,
          "SHOPIFY_PARTIAL_WRITE",
          409,
          undefined,
          undefined,
          fields.length > 0 ? fields : undefined,
          false,
          { updatedProductId: id, reconciliationRequired: true },
          true,
        );
      }
    } catch (err: unknown) {
      if (err instanceof GatewayError && err.code === "SHOPIFY_PARTIAL_WRITE") {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      const fields = err instanceof GatewayError ? err.fields : undefined;
      throw new GatewayError(
        `Product updated (${id}) but failed to update image files: ${errMsg}`,
        "SHOPIFY_PARTIAL_WRITE",
        409,
        undefined,
        err,
        fields,
        false,
        { updatedProductId: id, reconciliationRequired: true },
        true,
      );
    }
  }

  const mapped = mapProductNode(raw.productUpdate.product);
  let updatedImages = mapped.images ? [...mapped.images] : [];
  let updatedFeaturedImage = mapped.featuredImage;

  if (fileUpdateList.length > 0) {
    const altById = new Map<string, string | undefined>();
    for (const item of fileUpdateList) {
      altById.set(item.id, item.alt);
      const parts = item.id.split("/");
      const last = parts[parts.length - 1];
      if (last && last !== item.id) {
        altById.set(last, item.alt);
      }
    }

    const resolveAlt = (targetId?: string, fallback?: string): string | undefined => {
      if (!targetId) return fallback;
      if (altById.has(targetId)) return altById.get(targetId);
      const parts = targetId.split("/");
      const last = parts[parts.length - 1];
      if (last && altById.has(last)) return altById.get(last);
      return fallback;
    };

    if (updatedFeaturedImage) {
      updatedFeaturedImage = {
        ...updatedFeaturedImage,
        altText: resolveAlt(updatedFeaturedImage.id, updatedFeaturedImage.altText),
      };
    }

    updatedImages = updatedImages.map((img) => ({
      ...img,
      altText: resolveAlt(img.id, img.altText),
    }));
  }

  if (mediaList.length > 0 && updatedImages.length === 0) {
    updatedImages = mediaList.map((m) => ({
      url: m.originalSource,
      altText: m.alt,
    }));
  }

  return {
    product: {
      ...mapped,
      featuredImage: updatedFeaturedImage,
      images: updatedImages.length > 0 || mapped.images ? updatedImages : undefined,
    },
  };
}

export interface ProductBulkUpdateItemResult {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly errorCode?: GatewayErrorCode;
  readonly reconciliationRequired?: boolean;
}

export interface ProductsBulkUpdateResult {
  readonly successCount: number;
  readonly failedCount: number;
  readonly updatedProductIds: readonly string[];
  readonly count: number;
  readonly reconciliationRequired?: boolean;
  readonly items: readonly ProductBulkUpdateItemResult[];
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function executeProductsBulkUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<ProductsBulkUpdateResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const products = p.products;
  if (!Array.isArray(products)) {
    throw new GatewayError("Products array is required", "SHOPIFY_USER_ERROR", 400);
  }

  for (const item of products) {
    if (!item || typeof item !== "object") {
      throw new GatewayError("Each product item must be an object", "SHOPIFY_USER_ERROR", 400);
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      throw new GatewayError("Each product item must have a valid id", "SHOPIFY_USER_ERROR", 400);
    }
    if (!item.product || typeof item.product !== "object") {
      throw new GatewayError(`Product payload missing for item ${id}`, "SHOPIFY_USER_ERROR", 400);
    }
  }

  if (mode === "preview") {
    const items = products.map((item) => ({ id: String(item.id), ok: true }));
    return {
      successCount: items.length,
      failedCount: 0,
      updatedProductIds: items.map((i) => i.id),
      count: items.length,
      items,
    };
  }

  const results = await runWithConcurrency(
    products,
    3,
    async (item, index): Promise<ProductBulkUpdateItemResult & { readonly updatedId?: string }> => {
      const childRequestId = requestId ? `${requestId}:item-${index}` : undefined;
      try {
        const result = await executeProductsUpdate(store, client, item, "apply", childRequestId);
        return {
          id: result.product.id,
          ok: true,
          updatedId: result.product.id,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const isGatewayErr = err instanceof GatewayError;
        const isUnknownWriteState = isGatewayErr && err.code === "SHOPIFY_UNKNOWN_WRITE_STATE";
        const isPartialWrite = isGatewayErr && (err.code === "SHOPIFY_PARTIAL_WRITE" || err.reconciliationRequired);
        const recRequired = isUnknownWriteState || isPartialWrite || (isGatewayErr && Boolean(err.details?.reconciliationRequired));
        const errorCode = isGatewayErr ? err.code : undefined;

        return {
          id: String(item.id),
          ok: false,
          error: errorMsg,
          errorCode,
          reconciliationRequired: recRequired ? true : undefined,
        };
      }
    },
  );

  const updatedProductIds: string[] = [];
  const items: ProductBulkUpdateItemResult[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const res of results) {
    items.push({
      id: res.id,
      ok: res.ok,
      error: res.error,
      errorCode: res.errorCode,
      reconciliationRequired: res.reconciliationRequired,
    });
    if (res.ok && res.updatedId) {
      updatedProductIds.push(res.updatedId);
      successCount += 1;
    } else {
      failedCount += 1;
    }
  }

  const hasReconciliationRequired = items.some((it) => it.reconciliationRequired === true);

  return {
    successCount,
    failedCount,
    updatedProductIds,
    count: updatedProductIds.length,
    reconciliationRequired: hasReconciliationRequired ? true : undefined,
    items,
  };
}

export async function executeProductsDelete(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ deletedProductId: string }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Product id is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    return { deletedProductId: id };
  }

  interface ProductDeleteResponse {
    readonly productDelete: {
      readonly deletedProductId: string | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<ProductDeleteResponse>(
    store,
    PRODUCT_DELETE_MUTATION,
    { input: { id } },
    { isWrite: true, requestId },
  );

  if (raw.productDelete.userErrors && raw.productDelete.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productDelete.userErrors);
  }

  return {
    deletedProductId: raw.productDelete.deletedProductId ?? id,
  };
}
