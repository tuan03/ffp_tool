export interface CustomGptEnvironment {
  readonly databasePath: string;
  readonly actionKey?: string;
  readonly adminKey?: string;
  readonly storeId: string;
  readonly publicUrl?: string;
}
export function parseCustomGptEnvironment(env: Readonly<Record<string, string | undefined>>): CustomGptEnvironment {
  const storeId = env.GPT_SEO_STORE_ID || env.GATEWAY_STORE_ID || "capozen";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(storeId)) throw new Error("Invalid GPT_SEO_STORE_ID");
  const publicUrl = env.GPT_SEO_PUBLIC_URL;
  if (publicUrl && new URL(publicUrl).protocol !== "https:") throw new Error("GPT_SEO_PUBLIC_URL must use HTTPS");
  return { databasePath: env.GPT_SEO_DB_PATH || ".local-data/custom-gpt-seo.sqlite3", actionKey: env.GPT_SEO_ACTION_KEY, adminKey: env.GATEWAY_AUTH_TOKEN, storeId, publicUrl };
}
