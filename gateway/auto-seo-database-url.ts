import { loadLocalEnv } from "./store-config-loader";

function normalizePostgresUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (url.protocol === "postgresql+psycopg:" || url.protocol === "postgresql+asyncpg:") {
    url.protocol = "postgresql:";
  }
  return url.toString();
}

/**
 * Auto SEO prefers its dedicated connection string, but shares DATABASE_URL with
 * the unified production container while that deployment is being migrated.
 */
export function getAutoSeoDatabaseUrl(env: Readonly<Record<string, string>> = loadLocalEnv()): string | undefined {
  const databaseUrl = env.AUTO_SEO_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!databaseUrl) return undefined;
  return normalizePostgresUrl(databaseUrl);
}
