interface AmazonCoordinatorUrlInput {
  configuredUrl: string | undefined;
  browserHostname: string;
  browserProtocol: string;
}

export function resolveAmazonCoordinatorUrl({
  configuredUrl,
  browserHostname,
  browserProtocol,
}: AmazonCoordinatorUrlInput): string {
  const protocol = browserProtocol === "https:" ? "https:" : "http:";
  const candidate = configuredUrl?.trim() || `${protocol}//${browserHostname}:8766`;
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
