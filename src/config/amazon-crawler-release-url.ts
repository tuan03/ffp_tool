const DEFAULT_AMAZON_CRAWLER_RELEASE_API_URL =
  "/api/v1/agent-release";

export function resolveAmazonCrawlerReleaseApiUrl(configuredUrl: string | undefined): string {
  const candidate = configuredUrl?.trim() || DEFAULT_AMAZON_CRAWLER_RELEASE_API_URL;
  if (candidate === DEFAULT_AMAZON_CRAWLER_RELEASE_API_URL) return candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new Error("VITE_AMAZON_CRAWLER_RELEASE_API_URL must be a valid HTTPS URL.");
  }
}
