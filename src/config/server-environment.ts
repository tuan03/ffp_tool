import fs from "node:fs";
import path from "node:path";

let hasLoadedServerEnvironment = false;

/** Loads server-only root .env.local values without exposing them to Vite clients. */
export function loadServerEnvironment(): void {
  if (hasLoadedServerEnvironment) return;
  hasLoadedServerEnvironment = true;
  if (
    process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.some((argument) => argument.endsWith(".test.ts") || argument.endsWith(".test.js"))
  ) {
    return;
  }

  const environmentPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(environmentPath)) return;

  for (const line of fs.readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, "$2");
  }
}
