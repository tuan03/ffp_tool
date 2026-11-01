export type EtsyListingStatus = "available" | "existing" | "processing" | "queue_cleared" | "crawled_pending_sync" | "reconciliation_required";

export interface EtsyPreflightResult {
  readonly ready: boolean;
  readonly listings: readonly { readonly listingId: string; readonly status: EtsyListingStatus }[];
  readonly matches: readonly { readonly listingId: string; readonly productId: string; readonly title: string; readonly adminUrl: string }[];
  readonly allowedListingIds: readonly string[];
}

export interface EtsyConnectionStatus {
  readonly configured: boolean;
  readonly hasAccessToken: boolean;
  readonly hasRefreshToken: boolean;
  readonly refreshEnabled: boolean;
  readonly environmentOwner: string;
}

export interface EtsyCredentialsInput {
  readonly keystring: string;
  readonly sharedSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshEnabled: boolean;
}

export interface EtsyCrawlerClient {
  check(storeId: string, listingIds: readonly string[], signal?: AbortSignal): Promise<EtsyPreflightResult>;
  status(): Promise<EtsyConnectionStatus>;
  save(credentials: EtsyCredentialsInput): Promise<EtsyConnectionStatus>;
  test(): Promise<boolean>;
}
