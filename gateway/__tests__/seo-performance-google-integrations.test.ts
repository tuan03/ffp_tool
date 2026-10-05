import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import type { SeoPerformanceConfig } from "../../src/config/seo-performance-environment";
import { decryptSecret } from "../seo-performance/credentials";
import { GoogleSearchClient } from "../seo-performance/google-client";
import { applyPerformanceMigrations } from "../seo-performance/migrations";
import type { PerformanceConnection, PerformanceDatabase } from "../seo-performance/repository";

async function databaseFixture(): Promise<{ readonly database: PGlite; readonly adapter: PerformanceDatabase }> {
  const database = await PGlite.create();
  const connection = (): PerformanceConnection => ({
    query: async <Row,>(sql: string, values?: unknown[]) => {
      const result = await database.query<Row>(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
    release: () => {},
  });
  const adapter: PerformanceDatabase = {
    query: connection().query,
    connect: async () => connection(),
    end: async () => {},
  };
  await applyPerformanceMigrations(adapter);
  return { database, adapter };
}

const config: SeoPerformanceConfig = {
  enabled: true,
  databaseUrl: "postgres://test",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://ffp.example/api/seo-performance/oauth/callback",
  encryptionKey: "11".repeat(32),
};

test("store OAuth binds sources and session, encrypts grants and preserves an existing refresh token", async () => {
  const fixture = await databaseFixture();
  let state = "";
  let tokenResponse: { readonly refresh_token?: string; readonly scope: string } = {
    refresh_token: "refresh-secret",
    scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly",
  };
  const client = new GoogleSearchClient(fixture.adapter, config, fetch, () => ({
    generateAuthUrl: input => { state = input.state; return `https://accounts.example/consent?state=${input.state}`; },
    getToken: async () => ({ tokens: tokenResponse }),
  }));
  const first = await client.connectStore({ session: "admin-session", storeId: "jeminise", sources: ["GSC", "GA4"] });
  await assert.rejects(
    client.callback({ state, code: "code", session: "other-session", cookie: first.cookie }),
    /INVALID_OAUTH_STATE/,
  );
  await client.callback({ state, code: "code", session: "admin-session", cookie: first.cookie });

  const connection = (await fixture.database.query<{
    id: string; encrypted_refresh_token: string; granted_scopes: string[]; status: string;
  }>("SELECT id,encrypted_refresh_token,granted_scopes,status FROM sp_google_connections")).rows[0];
  assert.notEqual(connection.encrypted_refresh_token, "refresh-secret");
  assert.equal(decryptSecret(connection.encrypted_refresh_token, Buffer.from(config.encryptionKey, "hex")), "refresh-secret");
  assert.equal(connection.status, "CONNECTED");
  assert.equal(connection.granted_scopes.length, 2);

  tokenResponse = { scope: tokenResponse.scope };
  const second = await client.connectStore({ session: "admin-session", storeId: "jeminise", sources: ["GSC", "GA4"], connectionId: connection.id });
  await client.callback({ state, code: "code-2", session: "admin-session", cookie: second.cookie });
  const preserved = (await fixture.database.query<{ encrypted_refresh_token: string }>(
    "SELECT encrypted_refresh_token FROM sp_google_connections WHERE id=$1",
    [connection.id],
  )).rows[0];
  assert.equal(decryptSecret(preserved.encrypted_refresh_token, Buffer.from(config.encryptionKey, "hex")), "refresh-secret");
});

test("GA4 consent fails closed when analytics.readonly is not granted", async () => {
  const fixture = await databaseFixture();
  let state = "";
  const client = new GoogleSearchClient(fixture.adapter, config, fetch, () => ({
    generateAuthUrl: input => { state = input.state; return `https://accounts.example/consent?state=${input.state}`; },
    getToken: async () => ({ tokens: { refresh_token: "refresh-secret", scope: "https://www.googleapis.com/auth/webmasters.readonly" } }),
  }));
  const start = await client.connectStore({ session: "admin-session", storeId: "jeminise", sources: ["GSC", "GA4"] });
  await assert.rejects(
    client.callback({ state, code: "code", session: "admin-session", cookie: start.cookie }),
    /GOOGLE_RECONSENT_REQUIRED/,
  );
  const count = await fixture.database.query<{ count: number }>("SELECT count(*)::int AS count FROM sp_google_connections");
  assert.equal(count.rows[0].count, 0);
});
