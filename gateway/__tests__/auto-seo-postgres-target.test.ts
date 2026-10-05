import assert from "node:assert/strict";
import { test } from "node:test";

import { Pool } from "pg";

import { AutoSeoPostgresRepository } from "../auto-seo-postgres-repository";

function targetQueryResult(serverPort: number) {
  return {
    command: "SELECT",
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [{ database_name: "ffp_tool", user_name: "ffp_tool", server_port: serverPort }],
  };
}

test("Auto SEO target verification accepts the PostgreSQL port from its configured URL", async context => {
  context.mock.method(Pool.prototype, "query", async () => targetQueryResult(6432));
  context.mock.method(Pool.prototype, "end", async () => undefined);
  const repository = new AutoSeoPostgresRepository({
    databaseUrl: "postgresql://ffp_tool:secret@database.example:6432/ffp_tool",
  });
  try {
    await repository.verifyLocalTarget();
  } finally {
    await repository.close();
  }
});

test("Auto SEO target verification still rejects an unexpected PostgreSQL port", async context => {
  context.mock.method(Pool.prototype, "query", async () => targetQueryResult(5432));
  context.mock.method(Pool.prototype, "end", async () => undefined);
  const repository = new AutoSeoPostgresRepository({
    databaseUrl: "postgresql://ffp_tool:secret@database.example:6432/ffp_tool",
  });
  try {
    await assert.rejects(repository.verifyLocalTarget(), /not the expected local database/);
  } finally {
    await repository.close();
  }
});
