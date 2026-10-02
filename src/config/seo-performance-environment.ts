export interface SeoPerformanceConfig {
  readonly enabled: boolean; readonly databaseUrl: string; readonly clientId: string; readonly clientSecret: string;
  readonly redirectUri: string; readonly encryptionKey: string;
}
export function parseSeoPerformanceEnvironment(env: Readonly<Record<string, string | undefined>>): SeoPerformanceConfig {
  return {
    enabled: env.SEO_PERFORMANCE_ENABLED === "true", databaseUrl: env.AUTO_SEO_DATABASE_URL || env.DATABASE_URL || "",
    clientId: env.GSC_CLIENT_ID || "", clientSecret: env.GSC_CLIENT_SECRET || "",
    redirectUri: env.GSC_REDIRECT_URI || "", encryptionKey: env.GSC_TOKEN_ENCRYPTION_KEY || "",
  };
}
