export type SeoPerformanceConfigurationIssue =
  | "DATABASE_URL_REQUIRED"
  | "GOOGLE_OAUTH_CLIENT_ID_REQUIRED"
  | "GOOGLE_OAUTH_CLIENT_SECRET_REQUIRED"
  | "GOOGLE_OAUTH_REDIRECT_URI_REQUIRED"
  | "GOOGLE_OAUTH_REDIRECT_URI_INVALID"
  | "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_REQUIRED"
  | "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_INVALID";

export type GoogleOAuthVariableSource = "google_oauth" | "legacy_gsc" | "mixed" | "none";

export interface SeoPerformanceConfig {
  readonly enabled: boolean;
  readonly databaseUrl: string;
  /** Server-only values retained at the top level for gateway compatibility. */
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly encryptionKey: string;
}

export interface ParsedSeoPerformanceConfig extends SeoPerformanceConfig {
  /** True only when the feature was requested and all required server configuration is valid. */
  readonly requestedEnabled: boolean;
  readonly configured: boolean;
  readonly valid: boolean;
  readonly issues: readonly SeoPerformanceConfigurationIssue[];
  readonly oauthVariableSource: GoogleOAuthVariableSource;
}

function value(env: Readonly<Record<string, string | undefined>>, primary: string, legacy: string): {
  readonly value: string;
  readonly source: GoogleOAuthVariableSource;
} {
  const primaryValue = env[primary]?.trim() ?? "";
  if (primaryValue) return { value: primaryValue, source: "google_oauth" };
  const legacyValue = env[legacy]?.trim() ?? "";
  return legacyValue ? { value: legacyValue, source: "legacy_gsc" } : { value: "", source: "none" };
}

function isValidRedirectUri(valueToValidate: string): boolean {
  try {
    const url = new URL(valueToValidate);
    const isHttps = url.protocol === "https:";
    const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (isHttps || isLocalHttp) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function parseSeoPerformanceEnvironment(env: Readonly<Record<string, string | undefined>>): ParsedSeoPerformanceConfig {
  const requestedEnabled = env.SEO_PERFORMANCE_ENABLED === "true";
  const databaseUrl = (env.AUTO_SEO_DATABASE_URL || env.DATABASE_URL || "").trim();
  const clientId = value(env, "GOOGLE_OAUTH_CLIENT_ID", "GSC_CLIENT_ID");
  const clientSecret = value(env, "GOOGLE_OAUTH_CLIENT_SECRET", "GSC_CLIENT_SECRET");
  const redirectUri = value(env, "GOOGLE_OAUTH_REDIRECT_URI", "GSC_REDIRECT_URI");
  const encryptionKey = value(env, "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY", "GSC_TOKEN_ENCRYPTION_KEY");
  const configured = Boolean(clientId.value && clientSecret.value && redirectUri.value && encryptionKey.value);
  const issues: SeoPerformanceConfigurationIssue[] = [];

  if (requestedEnabled && !databaseUrl) issues.push("DATABASE_URL_REQUIRED");
  if (requestedEnabled && !clientId.value) issues.push("GOOGLE_OAUTH_CLIENT_ID_REQUIRED");
  if (requestedEnabled && !clientSecret.value) issues.push("GOOGLE_OAUTH_CLIENT_SECRET_REQUIRED");
  if (requestedEnabled && !redirectUri.value) issues.push("GOOGLE_OAUTH_REDIRECT_URI_REQUIRED");
  else if (redirectUri.value && !isValidRedirectUri(redirectUri.value)) issues.push("GOOGLE_OAUTH_REDIRECT_URI_INVALID");
  if (requestedEnabled && !encryptionKey.value) issues.push("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_REQUIRED");
  else if (encryptionKey.value && !/^[a-f0-9]{64}$/i.test(encryptionKey.value)) issues.push("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_INVALID");

  const valid = issues.length === 0;
  const sources = new Set([clientId.source, clientSecret.source, redirectUri.source, encryptionKey.source]);
  const oauthVariableSource: GoogleOAuthVariableSource = sources.size === 1
    ? clientId.source
    : sources.has("google_oauth") && sources.has("legacy_gsc") ? "mixed"
      : sources.has("google_oauth") ? "google_oauth" : sources.has("legacy_gsc") ? "legacy_gsc" : "none";

  return {
    enabled: requestedEnabled && configured && valid,
    requestedEnabled,
    configured,
    valid,
    issues,
    oauthVariableSource,
    databaseUrl,
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    redirectUri: redirectUri.value,
    encryptionKey: encryptionKey.value,
  };
}
