import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SeoPerformanceConfig } from "../../src/config/seo-performance-environment";
import { decryptSecret, encryptSecret } from "./credentials";
import type { PerformanceDatabase } from "./repository";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional(), refresh_token: z.string().optional(), scope: z.string().optional() });
export const searchRowSchema = z.object({ keys: z.array(z.string()).optional(), clicks: z.number().nonnegative(), impressions: z.number().nonnegative(), position: z.number().nonnegative() });
export type SearchRow = z.infer<typeof searchRowSchema>;
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export class GoogleSearchClient {
  private cachedToken?: { value: string; expiresAt: number; generation: string };
  constructor(private readonly pool: PerformanceDatabase, private readonly config: SeoPerformanceConfig, private readonly fetcher: typeof fetch = fetch) {}
  get configured(): boolean {
    try { return Boolean(this.config.clientId && this.config.clientSecret && new URL(this.config.redirectUri).protocol === "https:" && /^[a-f0-9]{64}$/i.test(this.config.encryptionKey)); } catch { return false; }
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
  async callback(input: { state: string; code: string; session: string; cookie: string }): Promise<void> {
    const consumed = await this.pool.query("DELETE FROM sp_oauth_states WHERE digest=$1 AND session_digest=$2 AND expires_at>now() RETURNING digest", [digest(input.state), digest(`${input.session}:${input.cookie}`)]);
    if (!consumed.rowCount) throw new Error("INVALID_OAUTH_STATE");
    const token = await this.tokenRequest({ code: input.code, grant_type: "authorization_code", redirect_uri: this.config.redirectUri });
    if (!token.refresh_token || !token.scope?.split(" ").includes(SCOPE)) throw new Error("GSC_CONSENT_REQUIRED");
    await this.pool.query("INSERT INTO sp_connection(id,encrypted_token,generation) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET encrypted_token=excluded.encrypted_token,generation=excluded.generation,reconnect=false", [encryptSecret(token.refresh_token, this.key()), randomUUID()]);
    this.cachedToken = undefined;
  }
  private async tokenRequest(values: Record<string, string>): Promise<z.infer<typeof tokenSchema>> {
    const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ ...values, client_id: this.config.clientId, client_secret: this.config.clientSecret }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) { await this.pool.query("UPDATE sp_connection SET reconnect=true WHERE id=1"); throw new Error("GSC_RECONNECT_REQUIRED"); }
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
  async request(url: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) {
      if (response.status === 401) { this.cachedToken = undefined; await this.pool.query("UPDATE sp_connection SET reconnect=true WHERE id=1"); }
      throw new Error(response.status === 401 ? "GSC_RECONNECT_REQUIRED" : response.status === 403 ? "GSC_PERMISSION_OR_QUOTA" : response.status === 429 ? "GSC_QUOTA_EXCEEDED" : "GSC_TEMPORARILY_UNAVAILABLE");
    }
    return response.json();
  }
  async properties(): Promise<readonly { siteUrl: string; permissionLevel: string }[]> {
    return z.object({ siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).default([]) }).parse(await this.request("https://www.googleapis.com/webmasters/v3/sites")).siteEntry.filter(site => site.permissionLevel !== "siteUnverifiedUser");
  }
  async analytics(property: string, day: string, dataset: "property" | "page" | "query", startRow: number): Promise<SearchRow[]> {
    const dimensions = dataset === "property" ? ["date"] : dataset === "page" ? ["page"] : ["page", "query"];
    return z.object({ rows: z.array(searchRowSchema).default([]) }).parse(await this.request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { startDate: day, endDate: day, dimensions, type: "web", dataState: "final", aggregationType: dataset === "property" ? "byProperty" : "byPage", rowLimit: 25000, startRow })).rows;
  }
  inspect(property: string, url: string): Promise<unknown> { return this.request("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: property, languageCode: "en-US" }); }
}
