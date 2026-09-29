const DEFAULT_AMAZON_CRAWLER_RELEASE_API_URL =
  "https://api.github.com/repos/tuan03/ffp_tool/releases/latest";

export function resolveAmazonCrawlerReleaseApiUrl(configuredUrl: string | undefined): string {
  const candidate = configuredUrl?.trim() || DEFAULT_AMAZON_CRAWLER_RELEASE_API_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new Error("VITE_AMAZON_CRAWLER_RELEASE_API_URL must be a valid HTTPS URL.");
  }
}
