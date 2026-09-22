import { createShopifyClient, type ShopifyClient } from "./client";
import type {
  GraphqlUserError,
  ShopifyCustomizationAssetInput,
  ShopifyMediaInput,
  ShopifySyncBatchInput,
  ShopifySyncBatchOutput,
  ShopifySyncOptions,
  ShopifySyncProductInput,
  ShopifySyncProductResult,
  ShopifyVariantInput,
} from "./types";

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

export async function createShopifyProduct(
  client: ShopifyClient,
  product: ShopifySyncProductInput,
  dryRun = false,
): Promise<{ readonly id: string; readonly handle: string }> {
  if (dryRun) {
    return {
      id: "gid://shopify/Product/dry-run-preview-id",
      handle: "dry-run-preview-handle",
    };
  }

  const mediaInputs = (product.media || []).map((m: ShopifyMediaInput) => ({
    originalSource: m.originalSource,
    alt: m.alt || product.title,
    mediaContentType: m.mediaContentType || "IMAGE",
  }));

  const productInput: Record<string, unknown> = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor || "Default Vendor",
    productType: product.productType || "Customized Item",
    tags: product.tags || [],
  };

  const response = await client.request<{
    productCreate: {
      product: { id: string; handle: string; title: string } | null;
      userErrors: GraphqlUserError[];
    };
  }>(CREATE_PRODUCT_MUTATION, {
    product: productInput,
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
    id: payload.product.id,
    handle: payload.product.handle,
  };
}

export async function createShopifyVariants(
  client: ShopifyClient,
  productId: string,
  variants: readonly ShopifyVariantInput[],
  dryRun = false,
): Promise<number> {
  if (!variants || variants.length === 0) {
    return 0;
  }

  if (dryRun) {
    return variants.length;
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

  return payload.productVariants?.length ?? 0;
}

export async function uploadShopifyAsset(
  client: ShopifyClient,
  asset: ShopifyCustomizationAssetInput,
  dryRun = false,
): Promise<{ readonly source: string; readonly newUrl: string }> {
  if (dryRun) {
    const fallbackName = asset.friendlyFileName || "asset.png";
    return {
      source: asset.url,
      newUrl: `https://cdn.shopify.com/s/files/dry-run/${fallbackName}`,
    };
  }

  const filename = asset.friendlyFileName || "amzcustom-asset.png";
  const alt = asset.alt || "Customization Asset";

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
        originalSource: asset.url,
        filename,
        alt,
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
    throw new Error(`fileCreate failed: No file created for ${asset.url}`);
  }

  const immediateUrl = createdFile.image?.url || createdFile.url;
  if (immediateUrl && createdFile.fileStatus === "READY") {
    return { source: asset.url, newUrl: immediateUrl };
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
      return { source: asset.url, newUrl: finalUrl };
    }
    if (node && node.fileStatus === "FAILED") {
      throw new Error(`Shopify file processing failed for ${asset.url}`);
    }
  }

  // Fallback if still processing
  const fallbackUrl = createdFile.image?.url || createdFile.url || asset.url;
  return { source: asset.url, newUrl: fallbackUrl };
}

export function replaceUrlsInObject(
  target: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof target === "string") {
    return replacements.get(target) || target;
  }
  if (Array.isArray(target)) {
    return target.map((item) => replaceUrlsInObject(item, replacements));
  }
  if (target && typeof target === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      output[key] = replaceUrlsInObject(value, replacements);
    }
    return output;
  }
  return target;
}

export async function setProductCustomizerMetafield(
  client: ShopifyClient,
  productId: string,
  config: Record<string, unknown>,
  dryRun = false,
): Promise<boolean> {
  if (dryRun) {
    return true;
  }

  const jsonValue = JSON.stringify(config);
  const response = await client.request<{
    metafieldsSet: {
      metafields: Array<{ id: string; namespace: string; key: string }> | null;
      userErrors: GraphqlUserError[];
    };
  }>(SET_METAFIELDS_MUTATION, {
    metafields: [
      {
        ownerId: productId,
        namespace: "custom",
        key: "amazon_customizer",
        type: "json",
        value: jsonValue,
      },
    ],
  });

  const payload = response.metafieldsSet;
  if (payload.userErrors && payload.userErrors.length > 0) {
    const errorMsg = payload.userErrors.map((u) => u.message).join("; ");
    throw new Error(`metafieldsSet user errors: ${errorMsg}`);
  }

  return Boolean(payload.metafields && payload.metafields.length > 0);
}

export async function syncSingleProduct(
  product: ShopifySyncProductInput,
  options: ShopifySyncOptions = {},
): Promise<ShopifySyncProductResult> {
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];
  let client: ShopifyClient;

  try {
    client = createShopifyClient(options.credentials, options);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (dryRun) {
      warnings.push(`Credentials warning in dry-run mode: ${msg}`);
      client = {
        shop: "dry-run.myshopify.com",
        apiVersion: "2026-04",
        request: async <T>(): Promise<T> => ({} as T),
      };
    } else {
      return {
        success: false,
        sourceId: product.id,
        title: product.title,
        variantsCount: 0,
        mediaCount: product.media?.length || 0,
        assetsUploadedCount: 0,
        metafieldSet: false,
        dryRun,
        warnings,
        error: msg,
      };
    }
  }

  try {
    // 1. Create Product & Media Gallery
    const createdProduct = await createShopifyProduct(client, product, dryRun);

    // 2. Create Variants
    let variantsCount = 0;
    if (product.variants && product.variants.length > 0) {
      variantsCount = await createShopifyVariants(
        client,
        createdProduct.id,
        product.variants,
        dryRun,
      );
    }

    // 3. Process Customization if present
    let assetsUploadedCount = 0;
    let metafieldSet = false;

    if (product.customization && product.customization.hasCustomization) {
      const assets = product.customization.assets || [];
      const replacements = new Map<string, string>();

      for (const asset of assets) {
        if (asset.url) {
          try {
            const uploaded = await uploadShopifyAsset(client, asset, dryRun);
            replacements.set(uploaded.source, uploaded.newUrl);
            assetsUploadedCount += 1;
          } catch (uploadError: unknown) {
            const errDetail = uploadError instanceof Error ? uploadError.message : String(uploadError);
            warnings.push(`Failed to upload customization asset ${asset.url}: ${errDetail}`);
          }
        }
      }

      // Reconstruct customizer config replacing old Amazon URLs with CDN URLs
      const baseConfig: Record<string, unknown> = {
        hasCustomization: true,
        assets: product.customization.assets,
        optionGroups: product.customization.optionGroups,
        pricing: product.customization.pricing,
        textInputs: product.customization.textInputs,
        formUrl: product.customization.formUrl,
        ...product.customization.rawConfig,
      };

      const finalConfig = replaceUrlsInObject(baseConfig, replacements) as Record<string, unknown>;

      // 4. Set Metafield custom.amazon_customizer
      try {
        metafieldSet = await setProductCustomizerMetafield(
          client,
          createdProduct.id,
          finalConfig,
          dryRun,
        );
      } catch (metafieldError: unknown) {
        const errDetail = metafieldError instanceof Error ? metafieldError.message : String(metafieldError);
        warnings.push(`Failed to set custom.amazon_customizer metafield: ${errDetail}`);
      }
    }

    return {
      success: true,
      sourceId: product.id,
      productId: createdProduct.id,
      productHandle: createdProduct.handle,
      title: product.title,
      variantsCount,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount,
      metafieldSet,
      dryRun,
      warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sourceId: product.id,
      title: product.title,
      variantsCount: 0,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount: 0,
      metafieldSet: false,
      dryRun,
      warnings,
      error: msg,
    };
  }
}

export async function runShopifySync(
  input: ShopifySyncBatchInput | readonly ShopifySyncProductInput[],
  options: ShopifySyncOptions = {},
): Promise<ShopifySyncBatchOutput> {
  const products = Array.isArray(input)
    ? input
    : (input as ShopifySyncBatchInput).products;
  const jobId = Array.isArray(input)
    ? undefined
    : (input as ShopifySyncBatchInput).jobId;

  const results: ShopifySyncProductResult[] = [];
  let successfulProducts = 0;
  let failedProducts = 0;
  let totalAssetsUploaded = 0;

  for (const product of products) {
    const res = await syncSingleProduct(product, options);
    results.push(res);
    if (res.success) {
      successfulProducts += 1;
      totalAssetsUploaded += res.assetsUploadedCount;
    } else {
      failedProducts += 1;
    }
  }

  return {
    jobId,
    totalProducts: products.length,
    successfulProducts,
    failedProducts,
    totalAssetsUploaded,
    results,
  };
}
