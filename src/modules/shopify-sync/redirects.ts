export interface UrlRedirectResult {
  readonly success: boolean;
  readonly redirectId?: string;
  readonly action: "created" | "already_exists" | "updated" | "skipped";
  readonly warning?: string;
}

export interface UrlRedirectClient {
  ensureUrlRedirect?: (
    fromPath: string,
    toPath: string,
  ) => Promise<UrlRedirectResult>;
}

export async function safeEnsureUrlRedirect(
  client: UrlRedirectClient | undefined,
  fromPath: string,
  toPath: string,
): Promise<UrlRedirectResult> {
  if (!client?.ensureUrlRedirect) {
    return {
      success: true,
      action: "skipped",
      warning: "Redirect client not configured; redirect skipped.",
    };
  }
  try {
    return await client.ensureUrlRedirect(fromPath, toPath);
  } catch (err) {
    return {
      success: false,
      action: "skipped",
      warning: `Failed to ensure URL redirect: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export const ensureUrlRedirect = safeEnsureUrlRedirect;
