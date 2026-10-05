import { createAmazonCrawlerClientsLoader } from "../service";

export async function resolveAmbientCrawlerOperatorFetch(
  engineUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<typeof fetch | null> {
  try {
    await createAmazonCrawlerClientsLoader({ engineUrl, fetchImplementation })();
    return fetchImplementation;
  } catch {
    return null;
  }
}
