import assert from "node:assert/strict";
import test from "node:test";
import { DefaultCompetitorClient } from "../ads-intelligence/competitor-client";

test("live competitor client rejects missing credentials instead of generating benchmark ads", async () => {
  const keys = ["SCRAPE_CREATORS_API_KEY", "SCRAPECREATORS_API_KEY", "SEARCHAPI_API_KEY", "SEARCH_API_KEY"];
  const saved = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => delete process.env[key]);
    await assert.rejects(new DefaultCompetitorClient().listAds("test-page"), /COMPETITOR_NOT_CONFIGURED/);
  } finally {
    keys.forEach((key, index) => { const value = saved[index]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  }
});
