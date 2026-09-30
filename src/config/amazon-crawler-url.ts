interface AmazonCoordinatorUrlInput {
  configuredUrl: string | undefined;
  browserHostname: string;
  browserProtocol: string;
  environment?: string;
}

export function resolveAmazonCoordinatorUrl({
  configuredUrl,
  browserHostname,
  browserProtocol,
  environment,
}: AmazonCoordinatorUrlInput): string {
  if (configuredUrl !== undefined && configuredUrl.trim() === "") {
    return "";
  }
  if (environment === "production") {
    if (!configuredUrl?.trim()) {
      return "";
    }
    const trimmed = configuredUrl.trim();
    if (
      trimmed.includes(":8766") ||
      trimmed.includes(":3001") ||
      trimmed.includes(":8768") ||
      trimmed.includes("localhost") ||
      trimmed.includes("127.0.0.1")
    ) {
      return "";
    }
  }
  const protocol = browserProtocol === "https:" ? "https:" : "http:";
  const candidate = configuredUrl?.trim() || `${protocol}//${browserHostname}:8766`;
  if (candidate === "" || candidate.startsWith("/")) {
    return candidate.replace(/\/+$/, "");
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("VITE_AMAZON_COORDINATOR_URL must be a valid HTTP(S) URL.");
  }
}

