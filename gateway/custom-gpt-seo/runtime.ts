import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseCustomGptEnvironment } from "../../src/config/custom-gpt-environment";
import { processCustomGptJob } from "./finalizer";
import { loadLocalEnv } from "../store-config-loader";
import { createCustomGptHandler } from "./handler";
import { CustomGptQueue } from "./queue";
import { getAutoSeoDb } from "../auto-seo-db";
import { recoverAutoSeoHandoffs } from "./auto-seo-outbox";
import { createCodexSeoMcpHandler } from "./mcp-handler";
import { createExternalSeoWorkflow } from "./workflow";

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const config = parseCustomGptEnvironment({ ...loadLocalEnv(), ...process.env });
  fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({ queue, ...config });
  const workflow = createExternalSeoWorkflow({ queue });
  const mcpHandler = createCodexSeoMcpHandler({ workflow, mcpKeys: config.mcpKeys });
  let isRunning = false;
  async function tick(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    try {
      recoverAutoSeoHandoffs(getAutoSeoDb(), queue);
      await processCustomGptJob(queue);
    } finally { isRunning = false; }
  }
  const timer = setInterval(() => { void tick().catch(() => { console.error("[GPT SEO] Background storage operation failed; inspect database health before retrying."); }); }, 1000);
  timer.unref();
  return { queue, handler, mcpHandler, tick, close: () => { clearInterval(timer); db.close(); } };
}
export function getCustomGptRuntime(): ReturnType<typeof createRuntime> { return runtime ??= createRuntime(); }
