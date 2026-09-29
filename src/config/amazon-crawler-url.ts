export interface AmazonCoordinatorUrlInput {
  configuredUrl?: string | undefined;
  browserHostname?: string;
  browserProtocol?: string;
  browserPort?: string;
}

export function resolveAmazonCoordinatorUrl({
  configuredUrl,
  browserHostname,
  browserProtocol,
  browserPort,
}: AmazonCoordinatorUrlInput): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed !== undefined && trimmed !== "") {
    if (trimmed.startsWith("/")) {
      return trimmed.replace(/\/+$/, "");
    }
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      return url.toString().replace(/\/+$/, "");
    } catch {
      throw new Error("VITE_AMAZON_COORDINATOR_URL must be a valid HTTP(S) URL or relative path.");
    }
  }

  // Fallback: do not hardcode internal port 8766 on browser; use same-origin
  const protocol = browserProtocol === "https:" ? "https:" : "http:";
  const hostname = browserHostname || "127.0.0.1";
  const portSuffix = browserPort ? `:${browserPort}` : "";
  return `${protocol}//${hostname}${portSuffix}`.replace(/\/+$/, "");
}
