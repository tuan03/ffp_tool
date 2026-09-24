import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GatewayError } from "./errors";
import { normalizeShopDomain } from "./store-registry";
import type { StoreAuthConfig, StoreConfig, StoreProxyConfig } from "./types";

export interface StoreBootstrapOptions {
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly configFile?: string;
}
/**
 * Loads key-value pairs from .env.local if present, merged onto process.env.
 */
export function loadLocalEnv(cwd: string = process.cwd()): Record<string, string> {
  const env: Record<string, string> = {};
  const envPath = resolve(cwd, ".env.local");

  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          let key = trimmed.slice(0, eqIdx).trim();
          if (key.startsWith("export ")) {
            key = key.slice(7).trim();
          }
          let val = trimmed.slice(eqIdx + 1).trim();
          if (val.startsWith('"')) {
            const nextQuoteIdx = val.indexOf('"', 1);
            if (nextQuoteIdx >= 1) {
              val = val.slice(1, nextQuoteIdx);
            }
          } else if (val.startsWith("'")) {
            const nextQuoteIdx = val.indexOf("'", 1);
            if (nextQuoteIdx >= 1) {
              val = val.slice(1, nextQuoteIdx);
            }
          } else {
            const commentIdx = val.search(/\s+#/);
            if (commentIdx >= 0) {
              val = val.slice(0, commentIdx).trim();
            }
          }
          env[key] = val;
        }
      }
    } catch {
      // Ignore unreadable .env.local
    }
  }

  // Runtime/container environment variables take precedence over .env.local
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

function parseStoreRawItem(item: unknown): StoreConfig | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const obj = item as Record<string, unknown>;

  const rawStoreId = obj.storeId ?? obj.id;
  if (typeof rawStoreId !== "string" || !rawStoreId.trim()) {
    return undefined;
  }
  const storeId = rawStoreId.trim();

  const rawDomain = obj.shopDomain ?? obj.domain;
  if (typeof rawDomain !== "string" || !rawDomain.trim()) {
    return undefined;
  }
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(rawDomain);
  } catch {
    return undefined;
  }

  const apiVersion = typeof obj.apiVersion === "string" && obj.apiVersion.trim()
    ? obj.apiVersion.trim()
    : "2026-07";

  // Parse Auth
  let auth: StoreAuthConfig | undefined;
  if (obj.auth && typeof obj.auth === "object") {
    const authObj = obj.auth as Record<string, unknown>;
    const authType = String(authObj.type || "").toLowerCase();
    if (authType === "client_credentials") {
      const clientId = String(authObj.clientId || authObj.client_id || "").trim();
      const clientSecret = String(authObj.clientSecret || authObj.client_secret || "").trim();
      if (clientId && clientSecret) {
        auth = { type: "client_credentials", clientId, clientSecret };
      }
    } else if (authType === "static" || authType === "static_access_token") {
      const staticToken = String(authObj.staticToken || authObj.accessToken || authObj.access_token || "").trim();
      if (staticToken) {
        auth = { type: "static", staticToken };
      }
    }
  }

  // Shorthand auth properties on top-level object
  if (!auth) {
    const clientId = String(obj.clientId || obj.client_id || "").trim();
    const clientSecret = String(obj.clientSecret || obj.client_secret || "").trim();
    const staticToken = String(obj.staticToken || obj.accessToken || obj.access_token || "").trim();

    if (clientId && clientSecret) {
      auth = { type: "client_credentials", clientId, clientSecret };
    } else if (staticToken) {
      auth = { type: "static", staticToken };
    }
  }

  if (!auth) {
    return undefined;
  }

  // Parse Proxy
  let proxy: StoreProxyConfig | undefined;
  if (obj.proxy && typeof obj.proxy === "object") {
    const proxyObj = obj.proxy as Record<string, unknown>;
    const proxyUrl = String(proxyObj.url || "").trim();
    if (proxyUrl) {
      proxy = {
        url: proxyUrl,
        username: typeof proxyObj.username === "string" && proxyObj.username.trim() ? proxyObj.username.trim() : undefined,
        password: typeof proxyObj.password === "string" && proxyObj.password.trim() ? proxyObj.password.trim() : undefined,
        failClosed: proxyObj.failClosed !== false,
      };
    }
  }

  // Shorthand proxy properties on top-level object
  if (!proxy) {
    const proxyUrl = String(obj.proxyUrl || obj.proxy_url || "").trim();
    if (proxyUrl) {
      const username = String(obj.proxyUsername || obj.proxy_username || "").trim();
      const password = String(obj.proxyPassword || obj.proxy_password || "").trim();
      proxy = {
        url: proxyUrl,
        username: username || undefined,
        password: password || undefined,
        failClosed: obj.proxyFailClosed !== false,
      };
    }
  }

  const rawProductTypes = obj.productTypes ?? obj.product_types;
  const productTypes = Array.isArray(rawProductTypes)
    ? rawProductTypes.map((t) => String(t).trim()).filter(Boolean)
    : typeof rawProductTypes === "string"
    ? rawProductTypes.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const rawDefaultType = obj.defaultProductType ?? obj.default_product_type;
  const defaultProductType =
    typeof rawDefaultType === "string" && rawDefaultType.trim()
      ? rawDefaultType.trim()
      : undefined;

  return {
    storeId,
    shopDomain,
    apiVersion,
    auth,
    proxy,
    productTypes: productTypes && productTypes.length > 0 ? productTypes : undefined,
    defaultProductType,
  };
}

function parseStoresFromJson(content: string, sourceName: string): StoreConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    throw new GatewayError(
      `Failed to parse store configuration JSON from ${sourceName}: ${err instanceof Error ? err.message : String(err)}`,
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  const items: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).stores)
    ? ((parsed as Record<string, unknown>).stores as unknown[])
    : [];

  const result: StoreConfig[] = [];
  for (const item of items) {
    const config = parseStoreRawItem(item);
    if (config) {
      result.push(config);
    }
  }

  return result;
}

/**
 * Parses per-store environment variables matching pattern:
 * STORE_<ID>_DOMAIN (or SHOP_DOMAIN)
 * STORE_<ID>_ACCESS_TOKEN (or STATIC_TOKEN)
 * STORE_<ID>_CLIENT_ID & STORE_<ID>_CLIENT_SECRET
 * STORE_<ID>_PROXY_URL
 * STORE_<ID>_PROXY_USERNAME
 * STORE_<ID>_PROXY_PASSWORD
 */
function parseStoresFromPrefixedEnv(env: Record<string, string>): StoreConfig[] {
  const storeMap = new Map<string, Record<string, string>>();

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("STORE_") || !value) {
      continue;
    }
    const suffixIndex = key.lastIndexOf("_");
    if (suffixIndex <= 6) {
      continue;
    }

    // Match STORE_<ID>_<FIELD> using longest-match-first suffix check
    const KNOWN_FIELDS = [
      "CLIENT_SECRET",
      "PROXY_USERNAME",
      "PROXY_PASSWORD",
      "ACCESS_TOKEN",
      "STATIC_TOKEN",
      "SHOP_DOMAIN",
      "FAIL_CLOSED",
      "API_VERSION",
      "PROXY_URL",
      "CLIENT_ID",
      "STORE_ID",
      "DOMAIN",
    ];

    let matchedRawId: string | undefined;
    let matchedField: string | undefined;

    for (const field of KNOWN_FIELDS) {
      if (key.endsWith(`_${field}`)) {
        const rawId = key.slice(6, key.length - field.length - 1);
        if (rawId.length > 0) {
          matchedRawId = rawId;
          matchedField = field;
          break;
        }
      }
    }

    if (!matchedRawId || !matchedField) {
      continue;
    }

    const rawId = matchedRawId;
    const field = matchedField;
    if (!storeMap.has(rawId)) {
      storeMap.set(rawId, {});
    }
    storeMap.get(rawId)![field] = value.trim();
  }

  const result: StoreConfig[] = [];
  for (const [rawId, fields] of storeMap.entries()) {
    const storeId = fields.STORE_ID || rawId.toLowerCase().replace(/_/g, "-");
    const domain = fields.DOMAIN || fields.SHOP_DOMAIN;
    if (!domain) {
      continue;
    }

    let shopDomain: string;
    try {
      shopDomain = normalizeShopDomain(domain);
    } catch {
      continue;
    }

    const apiVersion = fields.API_VERSION || "2026-07";

    let auth: StoreAuthConfig | undefined;
    if (fields.CLIENT_ID && fields.CLIENT_SECRET) {
      auth = {
        type: "client_credentials",
        clientId: fields.CLIENT_ID,
        clientSecret: fields.CLIENT_SECRET,
      };
    } else if (fields.ACCESS_TOKEN || fields.STATIC_TOKEN) {
      auth = {
        type: "static",
        staticToken: fields.ACCESS_TOKEN || fields.STATIC_TOKEN,
      };
    }

    if (!auth) {
      continue;
    }

    let proxy: StoreProxyConfig | undefined;
    if (fields.PROXY_URL) {
      proxy = {
        url: fields.PROXY_URL,
        username: fields.PROXY_USERNAME || undefined,
        password: fields.PROXY_PASSWORD || undefined,
        failClosed: fields.FAIL_CLOSED !== "false",
      };
    }

    result.push({
      storeId,
      shopDomain,
      apiVersion,
      auth,
      proxy,
    });
  }

  return result;
}

/**
 * Loads all configured stores from:
 * 1. Explicit config file (GATEWAY_STORES_FILE or stores.local.json or stores.config.json)
 * 2. Inline JSON in env (GATEWAY_STORES)
 * 3. Prefixed env variables (STORE_<ID>_*)
 * 4. Default single-store env variables (GATEWAY_STORE_ID, etc.)
 *
 * Merges stores by storeId (later sources do not overwrite earlier sources unless specified).
 */
export function loadBootstrappedStores(options?: StoreBootstrapOptions): StoreConfig[] {
  const cwd = options?.cwd || process.cwd();
  const env = options?.env || loadLocalEnv(cwd);
  const storesByStoreId = new Map<string, StoreConfig>();

  const registerStore = (store: StoreConfig): void => {
    if (!storesByStoreId.has(store.storeId)) {
      storesByStoreId.set(store.storeId, store);
    }
  };

  // 1. Check stores JSON file
  const candidateFiles: string[] = [];
  if (options?.configFile) {
    candidateFiles.push(resolve(cwd, options.configFile));
  }
  if (env.GATEWAY_STORES_FILE) {
    candidateFiles.push(resolve(cwd, env.GATEWAY_STORES_FILE));
  }
  candidateFiles.push(resolve(cwd, "stores.local.json"));
  candidateFiles.push(resolve(cwd, "stores.config.json"));

  for (const filePath of candidateFiles) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const stores = parseStoresFromJson(content, filePath);
        for (const store of stores) {
          registerStore(store);
        }
        break; // Stop after first existing config file
      } catch (err: unknown) {
        if (err instanceof GatewayError) {
          throw err;
        }
        // If file cannot be read, continue
      }
    }
  }

  // 2. Inline JSON in env: GATEWAY_STORES
  if (env.GATEWAY_STORES) {
    const stores = parseStoresFromJson(env.GATEWAY_STORES, "GATEWAY_STORES");
    for (const store of stores) {
      registerStore(store);
    }
  }

  // 3. Prefixed env variables: STORE_<ID>_*
  const prefixedStores = parseStoresFromPrefixedEnv(env);
  for (const store of prefixedStores) {
    registerStore(store);
  }

  // 4. Backward-compatible single-store env variables
  const singleClientId = env.GATEWAY_CLIENT_ID?.trim();
  const singleClientSecret = env.GATEWAY_CLIENT_SECRET?.trim();
  const singleStaticToken = (env.GATEWAY_STATIC_TOKEN || env.GATEWAY_ACCESS_TOKEN)?.trim();
  const singleStoreId = env.GATEWAY_STORE_ID?.trim();
  const singleShopDomainRaw = env.GATEWAY_SHOP_DOMAIN?.trim();

  const hasAuth = Boolean((singleClientId && singleClientSecret) || singleStaticToken);
  if (hasAuth && singleStoreId && singleShopDomainRaw) {
    let singleShopDomain: string | undefined;
    try {
      singleShopDomain = normalizeShopDomain(singleShopDomainRaw);
    } catch {
      singleShopDomain = undefined;
    }

    if (singleShopDomain) {
      const singleProxyUrl = env.GATEWAY_PROXY_URL?.trim();
      const singleProxy: StoreProxyConfig | undefined = singleProxyUrl
        ? {
            url: singleProxyUrl,
            username: env.GATEWAY_PROXY_USERNAME?.trim() || undefined,
            password: env.GATEWAY_PROXY_PASSWORD?.trim() || undefined,
            failClosed: true,
          }
        : undefined;

      const singleAuth: StoreAuthConfig = singleClientId && singleClientSecret
        ? {
            type: "client_credentials",
            clientId: singleClientId,
            clientSecret: singleClientSecret,
          }
        : {
            type: "static",
            staticToken: singleStaticToken!,
          };

      registerStore({
        storeId: singleStoreId,
        shopDomain: singleShopDomain,
        apiVersion: "2026-07",
        auth: singleAuth,
        proxy: singleProxy,
      });
    }
  }

  const baseStores = Array.from(storesByStoreId.values());
  const rawProxyConfigPath = env.SHOPIFY_PROXY_CONFIG || env.AMAZON_CRAWLER_PROXY_CONFIG;
  const proxyConfigPath = rawProxyConfigPath ? resolve(cwd, rawProxyConfigPath) : undefined;
  if (proxyConfigPath && existsSync(proxyConfigPath)) {
    try {
      const parsed = JSON.parse(readFileSync(proxyConfigPath, "utf-8")) as unknown;
      const profiles = parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).profiles)
        ? (parsed as Record<string, unknown>).profiles as readonly unknown[]
        : [];
      for (const profile of profiles) {
        if (!profile || typeof profile !== "object") continue;
        const profileRecord = profile as Record<string, unknown>;
        if (profileRecord.enabled === false || typeof profileRecord.name !== "string") continue;
        const proxyRecord = profileRecord.proxy && typeof profileRecord.proxy === "object"
          ? profileRecord.proxy as Record<string, unknown>
          : undefined;
        const server = typeof proxyRecord?.server === "string" ? proxyRecord.server.trim() : "";
        if (!server) continue;
        const safeProfileName = profileRecord.name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
        if (!safeProfileName) continue;
        for (const store of baseStores) {
          registerStore({
            ...store,
            storeId: `${store.storeId}--${safeProfileName}`,
            throttleGroupId: store.throttleGroupId ?? store.storeId,
            proxy: {
              url: server,
              username: typeof proxyRecord?.username === "string" ? proxyRecord.username : undefined,
              password: typeof proxyRecord?.password === "string" ? proxyRecord.password : undefined,
              failClosed: true,
            },
          });
        }
      }
    } catch {
      // Invalid local proxy configuration is surfaced by the pipeline worker,
      // while the base gateway store remains available for explicit non-pipeline use.
    }
  }

  return Array.from(storesByStoreId.values());
}

let configMutex = Promise.resolve();

async function withConfigMutex<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = configMutex.then(async () => fn());
  configMutex = next.then(() => {}, () => {});
  return next;
}

function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore unlink error
      }
    }
    throw err;
  }
}

/**
 * Persists a StoreConfig safely into stores.local.json.
 */
export function persistStoreToConfigFile(
  store: StoreConfig,
  options?: { configFile?: string; cwd?: string },
): Promise<void> {
  return withConfigMutex(() => {
    const cwd = options?.cwd || process.cwd();
    const targetFile = options?.configFile || "stores.local.json";
    const filePath = resolve(cwd, targetFile);

    let storesList: unknown[] = [];
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          storesList = parsed;
        } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).stores)) {
          storesList = (parsed as Record<string, unknown>).stores as unknown[];
        } else {
          const backupPath = `${filePath}.${Date.now()}.corrupt.bak`;
          try {
            copyFileSync(filePath, backupPath);
            console.warn(`[StoreConfigLoader] Non-array store config detected. Created backup at: ${backupPath}`);
          } catch {}
          storesList = [];
        }
      } catch (parseErr) {
        const backupPath = `${filePath}.${Date.now()}.corrupt.bak`;
        try {
          copyFileSync(filePath, backupPath);
          console.warn(`[StoreConfigLoader] Corrupted store config detected. Created backup at: ${backupPath}`, parseErr);
        } catch {}
        storesList = [];
      }
    }

    const storeEntry: Record<string, unknown> = {
      storeId: store.storeId,
      shopDomain: store.shopDomain,
      apiVersion: store.apiVersion || "2026-07",
      auth: { ...store.auth },
    };

    if (store.proxy && store.proxy.url) {
      storeEntry.proxy = {
        url: store.proxy.url,
        ...(store.proxy.username ? { username: store.proxy.username } : {}),
        ...(store.proxy.password ? { password: store.proxy.password } : {}),
        ...(store.proxy.failClosed !== undefined ? { failClosed: store.proxy.failClosed } : { failClosed: true }),
      };
    }

    if (store.productTypes && store.productTypes.length > 0) {
      storeEntry.productTypes = [...store.productTypes];
    }
    if (store.defaultProductType) {
      storeEntry.defaultProductType = store.defaultProductType;
    }

    const existingIndex = storesList.findIndex(
      (item) => item && typeof item === "object" && (item as Record<string, unknown>).storeId === store.storeId,
    );

    if (existingIndex >= 0) {
      storesList[existingIndex] = storeEntry;
    } else {
      storesList.push(storeEntry);
    }

    atomicWriteFileSync(filePath, JSON.stringify(storesList, null, 2) + "\n");
  });
}

/**
 * Removes a StoreConfig by storeId from stores.local.json.
 */
export function removeStoreFromConfigFile(
  storeId: string,
  options?: { configFile?: string; cwd?: string },
): Promise<boolean> {
  return withConfigMutex(() => {
    const cwd = options?.cwd || process.cwd();
    const targetFile = options?.configFile || "stores.local.json";
    const filePath = resolve(cwd, targetFile);

    if (!existsSync(filePath)) {
      return false;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(
          (item) => item && typeof item === "object" && (item as Record<string, unknown>).storeId !== storeId,
        );
        if (filtered.length !== parsed.length) {
          atomicWriteFileSync(filePath, JSON.stringify(filtered, null, 2) + "\n");
          return true;
        }
      } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).stores)) {
        const stores = (parsed as Record<string, unknown>).stores as unknown[];
        const filtered = stores.filter(
          (item) => item && typeof item === "object" && (item as Record<string, unknown>).storeId !== storeId,
        );
        if (filtered.length !== stores.length) {
          atomicWriteFileSync(filePath, JSON.stringify({ ...parsed, stores: filtered }, null, 2) + "\n");
          return true;
        }
      }
    } catch {
      // Ignore read/write error on disconnect
    }
    return false;
  });
}

