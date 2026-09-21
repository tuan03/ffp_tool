import { AppError } from "../../shared/errors/app-error";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  AutoSeoProductCandidate,
  AutoSeoSelectionInput,
  SeoContentInputPayload,
  ShopifyProductForAutoSeoUi,
} from "./types";

export async function runAutoSeo(
  input: AutoSeoSelectionInput,
): Promise<AutoSeoOutput> {
  const warnings: string[] = [];

  if (input.products.length === 0) {
    warnings.push("Product list is empty.");
  }

  const hasSelectedIds =
    Array.isArray(input.selectedProductIds) && input.selectedProductIds.length > 0;
  const hasSelectedHandles =
    Array.isArray(input.selectedHandles) && input.selectedHandles.length > 0;

  const selectedIdSet = new Set(input.selectedProductIds ?? []);
  const selectedHandleSet = new Set(input.selectedHandles ?? []);

  if (hasSelectedIds) {
    for (const id of selectedIdSet) {
      const exists = input.products.some((product) => product.productId === id);
      if (!exists) {
        warnings.push(`Selected product ID not found: ${id}`);
      }
    }
  }

  if (hasSelectedHandles) {
    for (const handle of selectedHandleSet) {
      const exists = input.products.some((product) => product.handle === handle);
      if (!exists) {
        warnings.push(`Selected product handle not found: ${handle}`);
      }
    }
  }

  const isSelectAll = !hasSelectedIds && !hasSelectedHandles;
  const selectedProducts: AutoSeoProductCandidate[] = [];
  const seenProductIds = new Set<string>();

  for (const product of input.products) {
    const isMatched =
      isSelectAll ||
      selectedIdSet.has(product.productId) ||
      selectedHandleSet.has(product.handle);

    if (isMatched && !seenProductIds.has(product.productId)) {
      seenProductIds.add(product.productId);
      selectedProducts.push(product);
    }
  }

  const seoContentInputs: SeoContentInputPayload[] = selectedProducts.map(
    (product) => {
      validateProduct(product, warnings);

      return {
        productId: product.productId,
        handle: product.handle.trim(),
        sourceTitle: product.title.trim(),
        sourceDescriptionHtml: product.descriptionHtml,
        sourceSeoTitle: product.seoTitle ?? null,
        sourceSeoDescription: product.seoDescription ?? null,
        images: product.images,
      };
    },
  );

  return {
    workflowId: input.workflowId,
    selectedCount: seoContentInputs.length,
    seoContentInputs,
    warnings,
  };
}

function validateProduct(
  product: AutoSeoProductCandidate,
  warnings: string[],
): void {
  if (product.productId.trim().length === 0) {
    warnings.push("Selected product has empty productId.");
  }
  if (product.handle.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty handle.`);
  }
  if (product.title.trim().length === 0) {
    warnings.push(`Selected product ${product.productId} has empty title.`);
  }
  if (product.descriptionHtml.trim().length === 0) {
    warnings.push(
      `Selected product ${product.productId} has empty descriptionHtml.`,
    );
  }
  if (product.images.length === 0) {
    warnings.push(`Selected product ${product.productId} has no images.`);
  }
}

export class RealAutoSeoClient implements AutoSeoClient {
  public constructor(
    private readonly baseUrl = "",
    private readonly customFetch?: typeof fetch,
  ) {}

  public async loadProducts(): Promise<readonly ShopifyProductForAutoSeoUi[]> {
    const fetchFn = this.customFetch ?? fetch;

    try {
      const storesResponse = await fetchFn(`${this.baseUrl}/api/shopify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "stores.list",
          payload: {},
        }),
      });

      if (!storesResponse.ok) {
        throw new AppError(
          `Failed to load Shopify stores: HTTP ${storesResponse.status}`,
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      const storesPayload = (await storesResponse.json()) as {
        readonly success?: boolean;
        readonly error?: { readonly message?: string };
        readonly data?: {
          readonly stores?: readonly { readonly storeId?: string }[];
        };
        readonly stores?: readonly { readonly storeId?: string }[];
      };

      if (storesPayload && typeof storesPayload === "object" && storesPayload.success === false) {
        throw new AppError(
          storesPayload.error?.message ?? "Failed to load Shopify stores",
          "AUTO_SEO_LOAD_FAILED",
        );
      }

      // TODO: Multi-store selection must be explicit in a future phase.
      const storeId =
        storesPayload?.data?.stores?.[0]?.storeId ??
        storesPayload?.stores?.[0]?.storeId;

      if (!storeId || typeof storeId !== "string" || storeId.trim() === "") {
        throw new AppError("No available Shopify store found", "AUTO_SEO_LOAD_FAILED");
      }

      const products: ShopifyProductForAutoSeoUi[] = [];
      const seenProductIds = new Set<string>();
      const seenCursors = new Set<string>();
      let currentCursor: string | undefined = undefined;
      let hasNextPage = true;

      while (hasNextPage) {
        const productsResponse = await fetchFn(`${this.baseUrl}/api/shopify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            storeId,
            operation: "products.list",
            payload: {
              limit: 250,
              ...(currentCursor ? { cursor: currentCursor } : {}),
            },
          }),
        });

        if (!productsResponse.ok) {
          throw new AppError(
            `Failed to load Shopify products: HTTP ${productsResponse.status}`,
            "AUTO_SEO_LOAD_FAILED",
          );
        }

        const productsPayload = (await productsResponse.json()) as {
          readonly success?: boolean;
          readonly error?: { readonly message?: string };
          readonly data?: {
            readonly products?: readonly ShopifyProductForAutoSeoUi[];
            readonly pageInfo?: {
              readonly hasNextPage?: boolean;
              readonly endCursor?: string | null;
            };
          };
          readonly products?: readonly ShopifyProductForAutoSeoUi[];
          readonly pageInfo?: {
            readonly hasNextPage?: boolean;
            readonly endCursor?: string | null;
          };
        };

        if (productsPayload && typeof productsPayload === "object" && productsPayload.success === false) {
          throw new AppError(
            productsPayload.error?.message ?? "Failed to load Shopify products",
            "AUTO_SEO_LOAD_FAILED",
          );
        }

        let pageProducts: readonly ShopifyProductForAutoSeoUi[] = [];
        if (Array.isArray(productsPayload?.data?.products)) {
          pageProducts = productsPayload.data.products;
        } else if (Array.isArray(productsPayload?.products)) {
          pageProducts = productsPayload.products;
        } else if (Array.isArray(productsPayload)) {
          pageProducts = productsPayload as unknown as readonly ShopifyProductForAutoSeoUi[];
        }

        for (const product of pageProducts) {
          if (
            product &&
            typeof product.id === "string" &&
            product.id.trim() !== "" &&
            !seenProductIds.has(product.id)
          ) {
            seenProductIds.add(product.id);
            products.push(product);
          }
        }

        const pageInfo =
          productsPayload?.data?.pageInfo ?? productsPayload?.pageInfo;

        if (pageInfo?.hasNextPage === true) {
          if (
            !pageInfo.endCursor ||
            typeof pageInfo.endCursor !== "string" ||
            pageInfo.endCursor.trim() === ""
          ) {
            throw new AppError(
              "Shopify pagination indicates more products but endCursor is missing",
              "AUTO_SEO_LOAD_FAILED",
            );
          }

          const trimmedCursor = pageInfo.endCursor.trim();
          if (seenCursors.has(trimmedCursor)) {
            throw new AppError(
              "Shopify pagination returned a repeated cursor: infinite loop detected",
              "AUTO_SEO_LOAD_FAILED",
            );
          }

          seenCursors.add(trimmedCursor);
          currentCursor = trimmedCursor;
        } else {
          hasNextPage = false;
        }
      }

      return products;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Failed to load products from Shopify API.",
        "AUTO_SEO_LOAD_FAILED",
        error,
      );
    }
  }

  public async runAutoSeo(input: AutoSeoSelectionInput): Promise<AutoSeoOutput> {
    try {
      return await runAutoSeo(input);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        error instanceof Error ? error.message : "Auto SEO execution failed.",
        "AUTO_SEO_RUN_FAILED",
        error,
      );
    }
  }
}

export const realAutoSeoClient = new RealAutoSeoClient();
