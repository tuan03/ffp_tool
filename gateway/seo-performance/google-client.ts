import { createHash, randomBytes, randomUUID } from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { z } from "zod";

import type { SeoPerformanceConfig } from "../../src/config/seo-performance-environment";
import { decryptSecret, encryptSecret } from "./credentials";
import type { PerformanceDatabase } from "./repository";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export type GooglePerformanceSource = "GSC" | "GA4";
interface StoreOAuthState {
  readonly store_id: string;
  readonly connection_id: string | null;
  readonly requested_sources: GooglePerformanceSource[];
  readonly requested_scopes: string[];
}
interface OAuthClientLike {
  generateAuthUrl(input: { readonly access_type: "offline"; readonly prompt: "consent"; readonly scope: string[]; readonly state: string; readonly include_granted_scopes: true }): string;
  getToken(code: string): Promise<{ readonly tokens: { readonly refresh_token?: string | null; readonly scope?: string | null } }>;
}
type OAuthFactory = () => OAuthClientLike;
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional(), refresh_token: z.string().optional(), scope: z.string().optional() });
export const searchRowSchema = z.object({ keys: z.array(z.string()).optional(), clicks: z.number().nonnegative(), impressions: z.number().nonnegative(), position: z.number().nonnegative() });
export type SearchRow = z.infer<typeof searchRowSchema>;
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export class GoogleSearchClient {
  private cachedToken?: { value: string; expiresAt: number; generation: string };
  private readonly connectionTokens = new Map<string, { value: string; expiresAt: number; generation: string }>();
  constructor(
    private readonly pool: PerformanceDatabase,
    private readonly config: SeoPerformanceConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly oauthFactory: OAuthFactory = () => new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri),
  ) {}
  get configured(): boolean {
    try {
      const url = new URL(this.config.redirectUri);
      const isHttps = url.protocol === "https:";
      const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      return Boolean(this.config.clientId && this.config.clientSecret && (isHttps || isLocalHttp) && /^[a-f0-9]{64}$/i.test(this.config.encryptionKey));
    } catch { return false; }
  }
  private key(): Buffer { if (!this.configured) throw new Error("GSC_CONFIGURATION_REQUIRED"); return Buffer.from(this.config.encryptionKey, "hex"); }
  async connect(session: string): Promise<{ url: string; cookie: string }> {
    this.key();
    const state = randomBytes(32).toString("base64url");
    const cookie = randomBytes(32).toString("base64url");
    await this.pool.query("DELETE FROM sp_oauth_states WHERE expires_at < now()");
    await this.pool.query("INSERT INTO sp_oauth_states(digest,session_digest,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [digest(state), digest(`${session}:${cookie}`)]);
    const query = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope: SCOPE, state });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, cookie };
  }
  async connectStore(input: { readonly session: string; readonly storeId: string; readonly sources: readonly GooglePerformanceSource[]; readonly connectionId?: string }): Promise<{ readonly url: string; readonly cookie: string }> {
    this.key();
    if (!input.sources.length) throw new Error("GOOGLE_SOURCE_REQUIRED");
    const sources = [...new Set(input.sources)];
    const scopes = [SCOPE, ...(sources.includes("GA4") ? [GA4_SCOPE] : [])];
    const state = randomBytes(32).toString("base64url");
    const cookie = randomBytes(32).toString("base64url");
    await this.pool.query("DELETE FROM sp_oauth_states_v2 WHERE expires_at < now() OR consumed_at IS NOT NULL");
    await this.pool.query(
      "INSERT INTO sp_oauth_states_v2(state_digest,session_digest,store_id,connection_id,requested_sources,requested_scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
      [digest(state), digest(`${input.session}:${cookie}`), input.storeId, input.connectionId ?? null, sources, scopes],
    );
    const url = this.oauthFactory().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: scopes, state, include_granted_scopes: true });
    return { url, cookie };
  }
  async callback(input: { state: string; code: string; session: string; cookie: string }): Promise<void> {
    const storeState = (await this.pool.query<StoreOAuthState>(
      "UPDATE sp_oauth_states_v2 SET consumed_at=now() WHERE state_digest=$1 AND session_digest=$2 AND expires_at>now() AND consumed_at IS NULL RETURNING store_id,connection_id,requested_sources,requested_scopes",
      [digest(input.state), digest(`${input.session}:${input.cookie}`)],
    )).rows[0];
    if (storeState) {
      await this.completeStoreCallback(storeState, input.code, digest(input.state));
      return;
    }
    const consumed = await this.pool.query("DELETE FROM sp_oauth_states WHERE digest=$1 AND session_digest=$2 AND expires_at>now() RETURNING digest", [digest(input.state), digest(`${input.session}:${input.cookie}`)]);
    if (!consumed.rowCount) throw new Error("INVALID_OAUTH_STATE");
    const token = await this.tokenRequest({ code: input.code, grant_type: "authorization_code", redirect_uri: this.config.redirectUri });
    if (!token.refresh_token || !token.scope?.split(" ").includes(SCOPE)) throw new Error("GSC_CONSENT_REQUIRED");
    await this.pool.query("INSERT INTO sp_connection(id,encrypted_token,generation) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET encrypted_token=excluded.encrypted_token,generation=excluded.generation,reconnect=false", [encryptSecret(token.refresh_token, this.key()), randomUUID()]);
    this.cachedToken = undefined;
  }
  private async completeStoreCallback(state: StoreOAuthState, code: string, stateDigest: string): Promise<void> {
    const { tokens } = await this.oauthFactory().getToken(code);
    const grantedScopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
    const missingScope = state.requested_scopes.find(scope => !grantedScopes.includes(scope));
    if (missingScope) throw new Error("GOOGLE_RECONSENT_REQUIRED");
    const connectionId = state.connection_id ?? randomUUID();
    const existing = (await this.pool.query<{ encrypted_refresh_token: string }>(
      "SELECT encrypted_refresh_token FROM sp_google_connections WHERE id=$1",
      [connectionId],
    )).rows[0];
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token, this.key())
      : existing?.encrypted_refresh_token;
    if (!encryptedRefreshToken) throw new Error("GOOGLE_RECONSENT_REQUIRED");
    await this.pool.query(
      `INSERT INTO sp_google_connections(id,encrypted_refresh_token,granted_scopes,status,generation,updated_at,disconnected_at)
       VALUES($1,$2,$3,'CONNECTED',$4,now(),NULL)
       ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token,
         granted_scopes=excluded.granted_scopes,status='CONNECTED',generation=excluded.generation,
         last_error_code=NULL,updated_at=now(),disconnected_at=NULL`,
      [connectionId, encryptedRefreshToken, grantedScopes, randomUUID()],
    );
    await this.pool.query(
      "UPDATE sp_oauth_states_v2 SET connection_id=$2 WHERE state_digest=$1",
      [stateDigest, connectionId],
    );
    for (const source of state.requested_sources) {
      await this.pool.query(
        "UPDATE sp_store_integrations SET connection_id=$3,status='NOT_CONFIGURED' WHERE store_id=$1 AND source=$2 AND is_current",
        [state.store_id, source, connectionId],
      );
    }
  }
  private async tokenRequest(values: Record<string, string>, markLegacyReconnect = true): Promise<z.infer<typeof tokenSchema>> {
    const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ ...values, client_id: this.config.clientId, client_secret: this.config.clientSecret }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        if (markLegacyReconnect) await this.pool.query("UPDATE sp_connection SET reconnect=true WHERE id=1");
        throw new Error("GSC_RECONNECT_REQUIRED");
      }
      throw new Error("GSC_TEMPORARILY_UNAVAILABLE");
    }
    return tokenSchema.parse(await response.json());
  }
  async token(): Promise<string> {
    const row = (await this.pool.query<{ encrypted_token: string; reconnect: boolean; generation: string }>("SELECT * FROM sp_connection WHERE id=1")).rows[0];
    if (!row || row.reconnect) throw new Error("GSC_RECONNECT_REQUIRED");
    if (this.cachedToken && this.cachedToken.generation === row.generation && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value;
    const token = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(row.encrypted_token, this.key()) });
    // Do not revive a connection disconnected or replaced while refresh was running.
    const stillConnected = await this.pool.query("SELECT 1 FROM sp_connection WHERE id=1 AND generation=$1", [row.generation]);
    if (!stillConnected.rowCount) throw new Error("GSC_RECONNECT_REQUIRED");
    this.cachedToken = { value: token.access_token, expiresAt: Date.now() + Math.max(0, (token.expires_in ?? 3600) - 60) * 1000, generation: row.generation };
    return token.access_token;
  }
  async tokenForConnection(connectionId: string): Promise<string> {
    const row = (await this.pool.query<{ encrypted_refresh_token: string; status: string; generation: string }>(
      "SELECT encrypted_refresh_token,status,generation FROM sp_google_connections WHERE id=$1",
      [connectionId],
    )).rows[0];
    if (!row || row.status !== "CONNECTED") throw new Error("GOOGLE_RECONNECT_REQUIRED");
    const cached = this.connectionTokens.get(connectionId);
    if (cached && cached.generation === row.generation && cached.expiresAt > Date.now()) return cached.value;
    let token: z.infer<typeof tokenSchema>;
    try {
      token = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(row.encrypted_refresh_token, this.key()) }, false);
    } catch (error) {
      if (error instanceof Error && error.message === "GSC_RECONNECT_REQUIRED") {
        await this.pool.query("UPDATE sp_google_connections SET status='RECONNECT_REQUIRED',last_error_code='INVALID_GRANT',updated_at=now() WHERE id=$1", [connectionId]);
        throw new Error("GOOGLE_RECONNECT_REQUIRED");
      }
      throw error;
    }
    const current = await this.pool.query("SELECT 1 FROM sp_google_connections WHERE id=$1 AND generation=$2 AND status='CONNECTED'", [connectionId, row.generation]);
    if (!current.rowCount) throw new Error("GOOGLE_RECONNECT_REQUIRED");
    this.connectionTokens.set(connectionId, { value: token.access_token, expiresAt: Date.now() + Math.max(0, (token.expires_in ?? 3600) - 60) * 1000, generation: row.generation });
    return token.access_token;
  }
  async disconnect(): Promise<void> {
    const row = (await this.pool.query<{ encrypted_token: string }>("SELECT encrypted_token FROM sp_connection WHERE id=1")).rows[0];
    if (row) {
      const response = await this.fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: decryptSecret(row.encrypted_token, this.key()) }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok && response.status !== 400) throw new Error("GSC_REVOCATION_FAILED");
    }
    await this.pool.query("DELETE FROM sp_connection WHERE id=1");
    await this.pool.query("DELETE FROM sp_oauth_states");
    this.cachedToken = undefined;
  }
  async disconnectConnection(connectionId: string): Promise<void> {
    const row = (await this.pool.query<{ encrypted_refresh_token: string }>("SELECT encrypted_refresh_token FROM sp_google_connections WHERE id=$1", [connectionId])).rows[0];
    if (row) {
      const response = await this.fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: decryptSecret(row.encrypted_refresh_token, this.key()) }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok && response.status !== 400) throw new Error("GOOGLE_REVOCATION_FAILED");
    }
    await this.pool.query("UPDATE sp_google_connections SET status='DISCONNECTED',disconnected_at=now(),updated_at=now() WHERE id=$1", [connectionId]);
    await this.pool.query("UPDATE sp_store_integrations SET status='DISCONNECTED' WHERE connection_id=$1 AND is_current", [connectionId]);
    this.connectionTokens.delete(connectionId);
  }
  async request(url: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) {
      if (response.status === 401) { this.cachedToken = undefined; await this.pool.query("UPDATE sp_connection SET reconnect=true WHERE id=1"); }
      throw new Error(response.status === 401 ? "GSC_RECONNECT_REQUIRED" : response.status === 403 ? "GSC_PERMISSION_OR_QUOTA" : response.status === 429 ? "GSC_QUOTA_EXCEEDED" : "GSC_TEMPORARILY_UNAVAILABLE");
    }
    return response.json();
  }
  async requestForConnection(connectionId: string, url: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${await this.tokenForConnection(connectionId)}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) {
      if (response.status === 401) {
        this.connectionTokens.delete(connectionId);
        await this.pool.query("UPDATE sp_google_connections SET status='RECONNECT_REQUIRED',last_error_code='HTTP_401',updated_at=now() WHERE id=$1", [connectionId]);
      }
      throw new Error(response.status === 401 ? "GOOGLE_RECONNECT_REQUIRED" : response.status === 403 ? "GOOGLE_PERMISSION_OR_QUOTA" : response.status === 429 ? "GOOGLE_QUOTA_EXCEEDED" : "GOOGLE_TEMPORARILY_UNAVAILABLE");
    }
    return response.json();
  }
  async properties(connectionId?: string): Promise<readonly { siteUrl: string; permissionLevel: string }[]> {
    const response = connectionId
      ? await this.requestForConnection(connectionId, "https://www.googleapis.com/webmasters/v3/sites")
      : await this.request("https://www.googleapis.com/webmasters/v3/sites");
    return z.object({ siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).default([]) }).parse(response).siteEntry.filter(site => site.permissionLevel !== "siteUnverifiedUser");
  }
  async analytics(property: string, day: string, dataset: "property" | "page" | "query", startRow: number, connectionId?: string): Promise<SearchRow[]> {
    const dimensions = dataset === "property" ? ["date"] : dataset === "page" ? ["page"] : ["page", "query"];
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    const body = { startDate: day, endDate: day, dimensions, type: "web", dataState: "final", aggregationType: dataset === "property" ? "byProperty" : "byPage", rowLimit: 25000, startRow };
    const response = connectionId ? await this.requestForConnection(connectionId, url, body) : await this.request(url, body);
    return z.object({ rows: z.array(searchRowSchema).default([]) }).parse(response).rows;
  }
  inspect(property: string, url: string, connectionId?: string): Promise<unknown> {
    const endpoint = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
    const body = { inspectionUrl: url, siteUrl: property, languageCode: "en-US" };
    return connectionId ? this.requestForConnection(connectionId, endpoint, body) : this.request(endpoint, body);
  }
}
