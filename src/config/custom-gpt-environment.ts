export interface CustomGptEnvironment {
  readonly databasePath: string;
  readonly actionKeys: Readonly<Record<string, string>>;
  readonly mcpKeys: Readonly<Record<string, string>>;
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

function parseMcpKeys(env: Readonly<Record<string, string | undefined>>, actionKeys: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const serializedMcpKeys = env.GPT_SEO_MCP_KEYS_JSON;
  if (!serializedMcpKeys) return {};
  let rawMcpKeys: unknown;
  try {
    rawMcpKeys = JSON.parse(serializedMcpKeys);
  } catch {
    throw new Error("GPT_SEO_MCP_KEYS_JSON must be a JSON object");
  }
  if (!rawMcpKeys || typeof rawMcpKeys !== "object" || Array.isArray(rawMcpKeys)) throw new Error("GPT_SEO_MCP_KEYS_JSON must be a JSON object");
  const actionSecrets = new Set(Object.values(actionKeys));
  const mcpSecrets = new Set<string>();
  const entries: [string, string][] = [];
  for (const [storeId, rawMcpKey] of Object.entries(rawMcpKeys)) {
    if (!STORE_ID_PATTERN.test(storeId)) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an invalid store ID");
    if (typeof rawMcpKey !== "string" || !rawMcpKey.trim()) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an empty MCP key");
    const mcpKey = rawMcpKey.trim();
    if (mcpSecrets.has(mcpKey)) throw new Error("GPT_SEO_MCP_KEYS_JSON MCP keys must be unique per store");
    if (actionSecrets.has(mcpKey)) throw new Error("MCP keys must differ from Custom GPT Action keys");
    if (mcpKey === env.GATEWAY_AUTH_TOKEN) throw new Error("GPT_SEO_MCP_KEYS_JSON keys must differ from GATEWAY_AUTH_TOKEN");
    mcpSecrets.add(mcpKey);
    entries.push([storeId, mcpKey]);
  }
  if (entries.length === 0) throw new Error("GPT_SEO_MCP_KEYS_JSON must configure at least one store");
  return Object.fromEntries(entries);
}

export function parseCustomGptEnvironment(env: Readonly<Record<string, string | undefined>>): CustomGptEnvironment {
  const storeId = env.GPT_SEO_STORE_ID || env.GATEWAY_STORE_ID || "capozen";
  if (!STORE_ID_PATTERN.test(storeId)) throw new Error("Invalid GPT_SEO_STORE_ID");
  const publicUrl = env.GPT_SEO_PUBLIC_URL;
  if (publicUrl && new URL(publicUrl).protocol !== "https:") throw new Error("GPT_SEO_PUBLIC_URL must use HTTPS");
  const actionKeys = parseActionKeys(env, storeId);
  return { databasePath: env.GPT_SEO_DB_PATH || ".local-data/custom-gpt-seo.sqlite3", actionKeys, mcpKeys: parseMcpKeys(env, actionKeys), adminKey: env.GATEWAY_AUTH_TOKEN, storeId, publicUrl };
}
