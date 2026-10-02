export interface McpCredential {
  readonly storeId: string;
  readonly workerId: string;
  readonly secret: string;
}

export interface CustomGptEnvironment {
  readonly databasePath: string;
  readonly actionKeys: Readonly<Record<string, string>>;
  readonly mcpCredentials: readonly McpCredential[];
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

function parseMcpCredentials(env: Readonly<Record<string, string | undefined>>, actionKeys: Readonly<Record<string, string>>): readonly McpCredential[] {
  const serializedMcpKeys = env.GPT_SEO_MCP_KEYS_JSON;
  if (!serializedMcpKeys) return [];
  let rawMcpKeys: unknown;
  try {
    rawMcpKeys = JSON.parse(serializedMcpKeys);
  } catch {
    throw new Error("GPT_SEO_MCP_KEYS_JSON must be a JSON object");
  }
  if (!rawMcpKeys || typeof rawMcpKeys !== "object" || Array.isArray(rawMcpKeys)) throw new Error("GPT_SEO_MCP_KEYS_JSON must be a JSON object");
  const actionSecrets = new Set(Object.values(actionKeys));
  const mcpSecrets = new Set<string>();
  const credentials: McpCredential[] = [];

  function addCredential(storeId: string, workerId: string, rawMcpKey: unknown): void {
    if (!STORE_ID_PATTERN.test(workerId)) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an invalid worker ID");
    if (typeof rawMcpKey !== "string" || !rawMcpKey.trim()) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an empty MCP key");
    const secret = rawMcpKey.trim();
    if (mcpSecrets.has(secret)) throw new Error("GPT_SEO_MCP_KEYS_JSON MCP keys must be unique per worker");
    if (actionSecrets.has(secret)) throw new Error("MCP keys must differ from Custom GPT Action keys");
    if (secret === env.GATEWAY_AUTH_TOKEN) throw new Error("GPT_SEO_MCP_KEYS_JSON keys must differ from GATEWAY_AUTH_TOKEN");
    mcpSecrets.add(secret);
    credentials.push({ storeId, workerId, secret });
  }

  for (const [storeId, rawStoreCredentials] of Object.entries(rawMcpKeys)) {
    if (!STORE_ID_PATTERN.test(storeId)) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an invalid store ID");
    if (typeof rawStoreCredentials === "string") {
      addCredential(storeId, "default", rawStoreCredentials);
      continue;
    }
    if (!rawStoreCredentials || typeof rawStoreCredentials !== "object" || Array.isArray(rawStoreCredentials)) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an invalid worker map");
    const workerEntries = Object.entries(rawStoreCredentials);
    if (workerEntries.length === 0) throw new Error("GPT_SEO_MCP_KEYS_JSON contains an empty worker map");
    for (const [workerId, rawMcpKey] of workerEntries) addCredential(storeId, workerId, rawMcpKey);
  }
  if (credentials.length === 0) throw new Error("GPT_SEO_MCP_KEYS_JSON must configure at least one worker");
  return credentials;
}

export function parseCustomGptEnvironment(env: Readonly<Record<string, string | undefined>>): CustomGptEnvironment {
  const storeId = env.GPT_SEO_STORE_ID || env.GATEWAY_STORE_ID || "capozen";
  if (!STORE_ID_PATTERN.test(storeId)) throw new Error("Invalid GPT_SEO_STORE_ID");
  const publicUrl = env.GPT_SEO_PUBLIC_URL;
  if (publicUrl && new URL(publicUrl).protocol !== "https:") throw new Error("GPT_SEO_PUBLIC_URL must use HTTPS");
  const actionKeys = parseActionKeys(env, storeId);
  return { databasePath: env.GPT_SEO_DB_PATH || ".local-data/custom-gpt-seo.sqlite3", actionKeys, mcpCredentials: parseMcpCredentials(env, actionKeys), adminKey: env.GATEWAY_AUTH_TOKEN, storeId, publicUrl };
}
