import assert from "node:assert/strict";
import test from "node:test";

import { getAutoSeoDatabaseUrl } from "../auto-seo-database-url";

test("Auto SEO uses its dedicated PostgreSQL URL when configured", () => {
  assert.equal(
    getAutoSeoDatabaseUrl({
      AUTO_SEO_DATABASE_URL: "postgresql://auto-seo:password@database:5432/auto_seo",
      DATABASE_URL: "postgresql+psycopg://shared:password@database:5432/ffp_tool",
    }),
    "postgresql://auto-seo:password@database:5432/auto_seo",
  );
});

test("Auto SEO trims and normalizes its dedicated PostgreSQL URL for Node runtimes", () => {
  assert.equal(
    getAutoSeoDatabaseUrl({
      AUTO_SEO_DATABASE_URL: "  postgresql+psycopg://auto-seo:password@database:5432/auto_seo  ",
    }),
    "postgresql://auto-seo:password@database:5432/auto_seo",
  );
});

test("Auto SEO reuses and normalizes the unified Python PostgreSQL URL", () => {
  assert.equal(
    getAutoSeoDatabaseUrl({ DATABASE_URL: "postgresql+psycopg://shared:password@database:5432/ffp_tool" }),
    "postgresql://shared:password@database:5432/ffp_tool",
  );
});

test("Auto SEO has no database URL when neither production setting is configured", () => {
  assert.equal(getAutoSeoDatabaseUrl({}), undefined);
});
