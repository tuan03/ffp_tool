/** Store-scoped MCP bridge for an isolated research CLI workspace. */
import { readFile, appendFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod/v4";

import { appendSpyEvent, spyPhaseLabel, spyToolLabel } from "./spy-events";

import { captureSpyAdSources, preserveSpyAdSources } from "./spy-ad-sources";

import { competitorResearchSchema } from "./competitor-research";
import { spyStartSchema, writeSpyJson } from "./spy-jobs";

const allowed = new Set(["ads_list_stores", "ads_get_store_overview", "ads_get_competitor_research", "ads_discover_advertisers", "ads_fetch_competitor_page", "ads_search_live_library", "ads_search_competitor_ads", "ads_get_competitor_ad", "ads_publish_competitor_research"]);
const requestSchema = spyStartSchema.extend({ id: z.string().uuid(), shopDomain: z.string(), startedAt: z.string() });

export async function runSpyTool(directory: string, operation: string, name?: string, args: unknown = {}): Promise<unknown> {
  const request = requestSchema.parse(JSON.parse(await readFile(join(directory, "request.json"), "utf8")));
  const input = z.record(z.string(), z.unknown()).parse(args);
  if (operation !== "list" && operation !== "call") throw new Error("SPY_TOOL_INVALID");
  if (operation === "call" && name === "ads_spy_progress") {
    const progress = z.object({ phase: z.enum(["profile", "discovery", "ads", "media", "analysis", "publish"]) }).parse(input);
    await writeSpyJson(join(directory, "progress.json"), progress);
    await appendSpyEvent(directory, { level: "info", message: `Bước nghiên cứu: ${spyPhaseLabel(progress.phase)}.` }); return progress;
  }
  if (operation === "call" && (!name || !allowed.has(name))) throw new Error("SPY_TOOL_NOT_ALLOWED");
  if (operation === "list" || (name && allowed.has(name))) await appendSpyEvent(directory, { level: "info", message: operation === "list" ? "Đang tải danh sách công cụ MCP." : `MCP bắt đầu: ${spyToolLabel(name ?? "")}.` });
  if (operation === "call" && name === "ads_publish_competitor_research") {
    const research = competitorResearchSchema.parse(await preserveSpyAdSources(directory, competitorResearchSchema.parse(input.research)));
    if (research.storeId !== request.storeId || research.shopDomain !== request.shopDomain || Date.parse(research.observedAt) < Date.parse(request.startedAt)) throw new Error("SPY_STORE_MISMATCH");
    await writeSpyJson(join(directory, "candidate.json"), research);
    await writeSpyJson(join(directory, "progress.json"), { phase: "publish" });
    await appendSpyEvent(directory, { level: "success", message: "Đã nhận dữ liệu nghiên cứu để backend kiểm tra; chưa công bố." });
    return { staged: true, research };
  }
  if (operation === "call" && name === "ads_list_stores") return { stores: [{ storeId: request.storeId, shopDomain: request.shopDomain }] };
  if (operation === "call" && input.storeId !== request.storeId) throw new Error("SPY_STORE_MISMATCH");
  if (name === "ads_get_competitor_research") {
    try { return { research: JSON.parse(await readFile(join(directory, "candidate.json"), "utf8")) }; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const client = new Client({ name: "ffp-store-spy", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(root, "gateway/ads-intelligence/mcp-stdio.ts")], cwd: root, stderr: "pipe" });
  try {
    await client.connect(transport);
    if (operation === "list") {
      const listing = await client.listTools();
      return { store: { storeId: request.storeId, shopDomain: request.shopDomain }, tools: [...listing.tools.filter(tool => allowed.has(tool.name)), { name: "ads_spy_progress", inputSchema: { type: "object", properties: { phase: { enum: ["profile", "discovery", "ads", "media", "analysis", "publish"] } }, required: ["phase"] } }] };
    }
    if (!name) throw new Error("SPY_TOOL_INVALID");
    const response = await client.callTool({ name, arguments: input });
    if (response.isError !== true) await captureSpyAdSources(directory, response);
    await appendFile(join(directory, "calls.jsonl"), JSON.stringify({ tool: name, at: new Date().toISOString(), isError: response.isError === true }) + "\n");
    await appendSpyEvent(directory, { level: response.isError === true ? "error" : "success", message: `MCP ${response.isError === true ? "báo lỗi" : "thành công"}: ${spyToolLabel(name)}.` });
    return response;
  } finally { await client.close(); }
}

export async function runSpyToolCommand(input: { directory: string; operation: string; name?: string; serialized?: string }): Promise<{ resultFile: string; isError: boolean }> {
  const { directory, operation, name, serialized } = input;
  const resultFile = join(directory, operation === "list" ? "mcp-tools.json" : "mcp-result.json");
  try {
    let text = serialized;
    if (operation === "call-file") {
      if (!serialized || !/^[a-zA-Z0-9_-]+\.json$/.test(serialized)) throw new Error("SPY_INPUT_FILE_INVALID");
      text = await readFile(join(directory, serialized), "utf8");
    }
    const output = await runSpyTool(directory, operation === "call-file" ? "call" : operation, name, text ? JSON.parse(text) : {});
    await writeSpyJson(resultFile, output);
    const isError = Boolean(output && typeof output === "object" && "isError" in output && output.isError === true);
    return { resultFile, isError };
  } catch (error) {
    const code = error instanceof z.ZodError ? "SPY_INPUT_INVALID" : error instanceof SyntaxError ? "SPY_JSON_INVALID" : error instanceof Error && /^SPY_[A-Z_]+$/.test(error.message) ? error.message : "SPY_TOOL_FAILED";
    const issues = error instanceof z.ZodError ? error.issues.slice(0, 20).map(issue => ({
      path: issue.path.map(part => typeof part === "number" ? part : String(part).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60)).join(".") || "research",
      code: issue.code, message: issue.message.slice(0, 300),
    })) : [];
    const failure = { isError: true, error: { code, issues, instruction: "Correct the listed fields using the live tool schema and retry. Publication is successful only when the response contains staged: true. Do not replace verified evidence with invented values." } };
    await writeSpyJson(resultFile, failure);
    await appendSpyEvent(directory, { level: "error", message: `Công cụ từ chối dữ liệu: ${code}${issues.length ? ` · Trường cần kiểm tra: ${issues.slice(0, 4).map(issue => issue.path).join(", ")}` : ""}.`.slice(0, 400) });
    return { resultFile, isError: true };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , directory, operation, name, serialized] = process.argv;
  if (!directory || !operation) process.exitCode = 1;
  else runSpyToolCommand({ directory, operation, name, serialized }).then(output => {
    process.stdout.write(JSON.stringify({ ...output, instruction: "Read resultFile with the native file viewer. If isError, fix the reported fields and retry before ending the run." }));
    if (output.isError) process.exitCode = 1;
  }).catch(() => { process.stderr.write("SPY_RESULT_WRITE_FAILED\n"); process.exitCode = 1; });
}
