import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export interface UrlRedirectResult {
  readonly success: boolean;
  readonly redirectId?: string;
  readonly action: "created" | "already_exists" | "updated" | "skipped";
  readonly warning?: string;
}

export const URL_REDIRECT_CREATE_MUTATION = `
  mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

export const URL_REDIRECTS_QUERY = `
  query UrlRedirectsLookup($query: String!) {
    urlRedirects(first: 1, query: $query) {
      edges {
        node {
          id
          path
          target
        }
      }
    }
  }
`;

export const URL_REDIRECT_UPDATE_MUTATION = `
  mutation UrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

/**
 * Ensures an idempotent 301 URL redirect from /products/${oldHandle} to /products/${newHandle}.
 *
 * Rules:
 * 1. If oldHandle === newHandle or either is missing: skip.
 * 2. Attempts urlRedirectCreate. If successful, returns action: "created".
 * 3. If userErrors contains TAKEN ("Path has already been taken"), queries existing redirect.
 * 4. If existing redirect already points to desired target, returns action: "already_exists" (idempotent success).
 * 5. If existing redirect points to a different target, updates it via urlRedirectUpdate and returns action: "updated".
 * 6. Non-fatal isolation: callers wrap redirect operations in try-catch to ensure product sync never fails.
 */
export async function ensureUrlRedirect(
  client: ShopifyGraphqlClient,
  storeConfig: StoreConfig,
  oldHandle: string,
  newHandle: string,
): Promise<UrlRedirectResult> {
  const cleanOld = oldHandle?.trim();
  const cleanNew = newHandle?.trim();

  // If oldHandle === newHandle or either is missing: skip.
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) {
    return { success: true, action: "skipped" };
  }

  const path = `/products/${cleanOld}`;
  const target = `/products/${cleanNew}`;

  interface UrlRedirectCreatePayload {
    readonly urlRedirectCreate: {
      readonly urlRedirect: {
        readonly id: string;
        readonly path: string;
        readonly target: string;
      } | null;
      readonly userErrors: readonly {
        readonly code?: string | null;
        readonly field?: readonly string[] | null;
        readonly message: string;
      }[];
    };
  }

  const createRes = await client.query<UrlRedirectCreatePayload>(
    storeConfig,
    URL_REDIRECT_CREATE_MUTATION,
    {
      urlRedirect: { path, target },
    },
    { isWrite: true },
  );

  const userErrors = createRes?.urlRedirectCreate?.userErrors ?? [];

  if (createRes?.urlRedirectCreate?.urlRedirect?.id && userErrors.length === 0) {
    return {
      success: true,
      redirectId: createRes.urlRedirectCreate.urlRedirect.id,
      action: "created",
    };
  }

  const isTaken = userErrors.some(
    (e) =>
      e.code === "TAKEN" ||
      e.message?.toLowerCase().includes("taken") ||
      e.message?.toLowerCase().includes("already exists"),
  );

  if (isTaken) {
    // Query existing redirect: urlRedirects(first: 1, query: "path:/products/${oldHandle}")
    interface UrlRedirectsQueryPayload {
      readonly urlRedirects: {
        readonly edges: readonly {
          readonly node: {
            readonly id: string;
            readonly path: string;
            readonly target: string;
          };
        }[];
      };
    }

    const lookupRes = await client.query<UrlRedirectsQueryPayload>(
      storeConfig,
      URL_REDIRECTS_QUERY,
      {
        query: `path:${path}`,
      },
      { isWrite: false },
    );

    const existing = lookupRes?.urlRedirects?.edges?.[0]?.node;
    if (existing) {
      if (existing.target === target) {
        // Idempotent success! Target already matches
        return {
          success: true,
          redirectId: existing.id,
          action: "already_exists",
        };
      }

      // Target differs: execute urlRedirectUpdate
      interface UrlRedirectUpdatePayload {
        readonly urlRedirectUpdate: {
          readonly urlRedirect: {
            readonly id: string;
            readonly path: string;
            readonly target: string;
          } | null;
          readonly userErrors: readonly {
            readonly code?: string | null;
            readonly field?: readonly string[] | null;
            readonly message: string;
          }[];
        };
      }

      const updateRes = await client.query<UrlRedirectUpdatePayload>(
        storeConfig,
        URL_REDIRECT_UPDATE_MUTATION,
        {
          id: existing.id,
          urlRedirect: { target },
        },
        { isWrite: true },
      );

      const updateErrors = updateRes?.urlRedirectUpdate?.userErrors ?? [];
      if (updateErrors.length === 0 && (updateRes?.urlRedirectUpdate?.urlRedirect?.id || existing.id)) {
        return {
          success: true,
          redirectId: updateRes?.urlRedirectUpdate?.urlRedirect?.id || existing.id,
          action: "updated",
        };
      }

      if (updateErrors.length > 0) {
        throw new Error(
          `Failed to update URL redirect: ${updateErrors.map((e) => e.message).join(", ")}`,
        );
      }
    }
  }

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to create URL redirect: ${userErrors.map((e) => e.message).join(", ")}`,
    );
  }

  return { success: true, action: "skipped" };
}

/**
 * Non-fatal safe wrapper around ensureUrlRedirect that catches any redirect error,
 * returning success: false with a warning message so the product sync itself does not fail.
 */
export async function safeEnsureUrlRedirect(
  client: ShopifyGraphqlClient,
  storeConfig: StoreConfig,
  oldHandle: string,
  newHandle: string,
): Promise<UrlRedirectResult> {
  try {
    return await ensureUrlRedirect(client, storeConfig, oldHandle, newHandle);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      action: "skipped",
      warning: `URL redirect from /products/${oldHandle} to /products/${newHandle} could not be created: ${msg}`,
    };
  }
}
