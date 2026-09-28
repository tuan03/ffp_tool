export interface CustomGptEnvironment {
  readonly databasePath: string;
  readonly actionKeys: Readonly<Record<string, string>>;
  readonly adminKey?: string;
  readonly storeId: string;
  readonly publicUrl?: string;
}

const STORE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

function parseActionKeys(env: Readonly<Record<string, string | undefined>>, legacyStoreId: string): Readonly<Record<string, string>> {
  const serializedActionKeys = env.GPT_SEO_ACTION_KEYS_JSON;
  if (!serializedActionKeys) {
    if (env.GPT_SEO_ACTION_KEY && env.GPT_SEO_ACTION_KEY === env.GATEWAY_AUTH_TOKEN) throw new Error("GPT_SEO_ACTION_KEY must differ from GATEWAY_AUTH_TOKEN");
    return env.GPT_SEO_ACTION_KEY ? { [legacyStoreId]: env.GPT_SEO_ACTION_KEY } : {};
  }

  let rawActionKeys: unknown;
  try {
    rawActionKeys = JSON.parse(serializedActionKeys);
  } catch {
    throw new Error("GPT_SEO_ACTION_KEYS_JSON must be a JSON object");
  }
  if (!rawActionKeys || typeof rawActionKeys !== "object" || Array.isArray(rawActionKeys)) throw new Error("GPT_SEO_ACTION_KEYS_JSON must be a JSON object");

  const actionKeyEntries: [string, string][] = [];
  const secrets = new Set<string>();
  for (const [storeId, rawActionKey] of Object.entries(rawActionKeys)) {
    if (!STORE_ID_PATTERN.test(storeId)) throw new Error("GPT_SEO_ACTION_KEYS_JSON contains an invalid store ID");
    if (typeof rawActionKey !== "string" || !rawActionKey.trim()) throw new Error("GPT_SEO_ACTION_KEYS_JSON contains an empty action key");
    const actionKey = rawActionKey.trim();
    if (secrets.has(actionKey)) throw new Error("GPT_SEO_ACTION_KEYS_JSON action keys must be unique per store");
    if (actionKey === env.GATEWAY_AUTH_TOKEN) throw new Error("GPT_SEO_ACTION_KEYS_JSON keys must differ from GATEWAY_AUTH_TOKEN");
    secrets.add(actionKey);
    actionKeyEntries.push([storeId, actionKey]);
  }
  if (actionKeyEntries.length === 0) throw new Error("GPT_SEO_ACTION_KEYS_JSON must configure at least one store");
  return Object.fromEntries(actionKeyEntries);
}

export function parseCustomGptEnvironment(env: Readonly<Record<string, string | undefined>>): CustomGptEnvironment {
  const storeId = env.GPT_SEO_STORE_ID || env.GATEWAY_STORE_ID || "capozen";
  if (!STORE_ID_PATTERN.test(storeId)) throw new Error("Invalid GPT_SEO_STORE_ID");
  const publicUrl = env.GPT_SEO_PUBLIC_URL;
  if (publicUrl && new URL(publicUrl).protocol !== "https:") throw new Error("GPT_SEO_PUBLIC_URL must use HTTPS");
  return { databasePath: env.GPT_SEO_DB_PATH || ".local-data/custom-gpt-seo.sqlite3", actionKeys: parseActionKeys(env, storeId), adminKey: env.GATEWAY_AUTH_TOKEN, storeId, publicUrl };
}
