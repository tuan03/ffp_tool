import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseCustomGptEnvironment } from "../../src/config/custom-gpt-environment";
import { processCustomGptJob } from "./finalizer";
import { loadLocalEnv } from "../store-config-loader";
import { createCustomGptHandler } from "./handler";
import { CustomGptQueue } from "./queue";
import { getAutoSeoBackupRepository } from "../auto-seo-postgres-repository";
import { recoverAutoSeoHandoffs } from "./auto-seo-outbox";
import { createCodexSeoMcpHandler } from "./mcp-handler";
import { createExternalSeoWorkflow } from "./workflow";

interface CustomGptTickDependencies {
  readonly recoverAutoSeoHandoffs: () => Promise<void>;
  readonly processCustomGptJob: () => Promise<void>;
  readonly logAutoSeoRecoveryFailure: (error: unknown) => void;
}

export async function runCustomGptTick(dependencies: CustomGptTickDependencies): Promise<void> {
  try {
    await dependencies.recoverAutoSeoHandoffs();
  } catch (error) {
    dependencies.logAutoSeoRecoveryFailure(error);
  }
  await dependencies.processCustomGptJob();
}

function logAutoSeoRecoveryFailure(error: unknown): void {
  const code = typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
  console.error(`[GPT SEO] Auto SEO handoff recovery failed (${code}); Custom GPT queue processing continues.`);
}

let runtime: ReturnType<typeof createRuntime> | undefined;
function createRuntime() {
  const config = parseCustomGptEnvironment({ ...loadLocalEnv(), ...process.env });
  fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({ queue, ...config });
  const workflow = createExternalSeoWorkflow({ queue });
  const mcpHandler = createCodexSeoMcpHandler({ workflow, mcpCredentials: config.mcpCredentials });
  let isRunning = false;
  async function tick(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    try {
      await runCustomGptTick({
        recoverAutoSeoHandoffs: () => recoverAutoSeoHandoffs(getAutoSeoBackupRepository(), queue),
        processCustomGptJob: () => processCustomGptJob(queue),
        logAutoSeoRecoveryFailure,
      });
    } finally { isRunning = false; }
  }
  const timer = setInterval(() => { void tick().catch(() => { console.error("[GPT SEO] Background storage operation failed; inspect database health before retrying."); }); }, 1000);
  timer.unref();
  return { queue, handler, mcpHandler, tick, close: () => { clearInterval(timer); db.close(); } };
}
export function getCustomGptRuntime(): ReturnType<typeof createRuntime> { return runtime ??= createRuntime(); }
