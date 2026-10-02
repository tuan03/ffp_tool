import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseCustomGptEnvironment } from "../src/config/custom-gpt-environment";
import type { ExternalSeoProvider } from "../src/modules/custom-gpt-seo";

import { CustomGptQueue } from "../gateway/custom-gpt-seo/queue";
import { loadLocalEnv } from "../gateway/store-config-loader";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const storeId = argument("store");
const rawProvider = argument("provider") ?? "codex_mcp";
const shouldApply = process.argv.includes("--apply");

if (!storeId || !/^[a-zA-Z0-9_-]{1,100}$/.test(storeId)) {
  throw new Error("Provide a valid --store=<store-id>");
}
if (rawProvider !== "custom_gpt" && rawProvider !== "codex_mcp") {
  throw new Error("--provider must be custom_gpt or codex_mcp");
}
const provider: ExternalSeoProvider = rawProvider;
const config = parseCustomGptEnvironment(loadLocalEnv());
const databasePath = path.resolve(config.databasePath);
if (!existsSync(databasePath)) throw new Error(`GPT SEO database does not exist: ${databasePath}`);

const db = new DatabaseSync(databasePath);
try {
  const queue = new CustomGptQueue(db);
  const readyCount = queue.counts(storeId, provider).REVIEW_READY ?? 0;
  if (!shouldApply) {
    console.log(JSON.stringify({ mode: "dry-run", storeId, provider, readyCount }));
  } else {
    const result = queue.resetReviewReadyForAeoBackfill(storeId, provider);
    console.log(JSON.stringify({ mode: "applied", storeId, provider, ...result }));
  }
} finally {
  db.close();
}
