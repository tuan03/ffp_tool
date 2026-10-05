import { randomUUID } from "node:crypto";
import { appendFile, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

const eventSchema = z.object({ id: z.string(), at: z.string(), level: z.enum(["info", "success", "error"]), message: z.string().max(400) });
export type SpyEvent = z.infer<typeof eventSchema>;
export type SpyEventInput = Pick<SpyEvent, "level" | "message">;
const phases: Readonly<Record<string, string>> = { profile: "Xác minh store", discovery: "Tìm đối thủ", ads: "Thu thập quảng cáo", media: "Kiểm tra ảnh/video", analysis: "Phân tích", publish: "Chuẩn bị lưu kết quả" };
const tools: Readonly<Record<string, string>> = { ads_list_stores: "Đọc store đang chọn", ads_get_store_overview: "Đọc tổng quan store", ads_get_competitor_research: "Đọc nghiên cứu đã lưu", ads_discover_advertisers: "Tìm Page đối thủ", ads_fetch_competitor_page: "Lấy quảng cáo từ Page", ads_search_live_library: "Tìm quảng cáo trong thư viện", ads_search_competitor_ads: "Tìm quảng cáo đối thủ", ads_get_competitor_ad: "Đọc chi tiết quảng cáo", ads_publish_competitor_research: "Kiểm tra dữ liệu trước khi lưu", ads_spy_progress: "Cập nhật bước nghiên cứu", run_command: "Chạy lệnh", view_file: "Đọc tệp", read_url_content: "Đọc website", search_web: "Tìm trên web", write_to_file: "Ghi tệp nghiên cứu", command_status: "Kiểm tra lệnh đang chạy", browser_subagent: "Kiểm tra nội dung trong trình duyệt" };
export function spyToolLabel(name: string): string { return tools[name] ?? "Thực hiện công cụ"; }
export function spyPhaseLabel(phase: string): string { return phases[phase] ?? "Nghiên cứu"; }
export async function appendSpyEvent(directory: string, input: SpyEventInput): Promise<void> {
  const entry = eventSchema.parse({ ...input, id: randomUUID(), at: new Date().toISOString() });
  await appendFile(join(directory, "events.jsonl"), JSON.stringify(entry) + "\n", { mode: 0o600 });
}
async function readTail(path: string): Promise<string[]> {
  let file;
  try { file = await open(path, "r"); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - 128_000);
    const buffer = Buffer.alloc(size - start);
    await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start) lines.shift();
    return lines;
  } finally { await file.close(); }
}
export async function readSpyEvents(directory: string): Promise<SpyEvent[]> {
  const entries: SpyEvent[] = [];
  for (const line of await readTail(join(directory, "events.jsonl"))) {
    try { const parsed = eventSchema.safeParse(JSON.parse(line)); if (parsed.success) entries.push(parsed.data); } catch { /* Ignore an incomplete concurrent append. */ }
  }
  if (entries.length) return entries.slice(-200);
  // Older versions kept MCP completion records only. Preserve their provenance
  // instead of inventing missing CLI steps or reconstructing reasoning.
  const legacySchema = z.object({ at: z.string().datetime(), tool: z.string(), isError: z.boolean() });
  for (const [index, line] of (await readTail(join(directory, "calls.jsonl"))).entries()) {
    try {
      const parsed = legacySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push({ id: `legacy-${index}`, at: parsed.data.at, level: parsed.data.isError ? "error" : "success", message: `MCP ${parsed.data.isError ? "báo lỗi" : "thành công"} (nhật ký cũ): ${spyToolLabel(parsed.data.tool)}.` });
    } catch { /* Ignore incomplete or unrecognized legacy entries. */ }
  }
  return entries.slice(-200);
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function commandLabel(value: unknown): string {
  if (typeof value !== "string") return "lệnh hệ thống";
  const command = value.trim();
  const tool = command.match(/\bffp-tools\.mjs\s+call\s+(ads_[a-z_]+)/)?.[1];
  if (tool) return spyToolLabel(tool);
  if (/\bffp-tools\.mjs\s+list\b/.test(command)) return "Đọc danh sách công cụ MCP";
  const executable = command.split(/\s/)[0]?.split(/[\\/]/).pop();
  return executable && ["node", "python", "python3", "ls", "cp", "curl", "ffmpeg", "git"].includes(executable) ? `Lệnh ${executable}` : "lệnh hệ thống";
}
function websiteLabel(value: unknown): string {
  if (typeof value !== "string") return "Đọc website";
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && /^[a-z0-9.-]{1,180}$/i.test(url.hostname)) return `Đọc website ${url.hostname}`;
  } catch { /* Do not echo malformed URLs or credential-bearing input. */ }
  return "Đọc website";
}
/** Allowlisted operational metadata only: never relay reasoning, raw commands, URLs or tool bodies. */
export function createSpyStreamObserver(emit: (event: SpyEventInput) => void, result: (serialized: string) => void): { push(chunk: string): void; finish(): void } {
  let pending = "";
  let discard = false;
  let lastTool = "công cụ";
  const seen = new Set<string>();
  const parse = (line: string) => {
    let packet: Record<string, unknown>;
    try { packet = record(JSON.parse(line)); } catch { return; }
    if (packet.event === "result") {
      const outcome = record(packet.result);
      result(JSON.stringify(outcome));
      if (Array.isArray(outcome.denied_actions)) for (const denied of outcome.denied_actions) {
        const action = record(denied).action;
        const kind = action === "command" ? "chạy lệnh" : action === "read_file" ? "đọc tệp" : action === "read_url" ? "đọc website" : "dùng công cụ";
        emit({ level: "error", message: `CLI từ chối quyền ${kind}. Thao tác gần nhất: ${lastTool}.` });
      }
    } else if (packet.event === "step_update") {
      const step = record(packet.step_update);
      if (step.step_type !== "tool" || !["ACTIVE", "DONE"].includes(String(step.state))) return;
      const key = `${String(step.step_index)}:${String(step.state)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const info = record(step.tool_info);
      const name = typeof step.tool_name === "string" ? step.tool_name : "";
      lastTool = name === "run_command" ? commandLabel(record(info.parameters).CommandLine) : name === "read_url_content" ? websiteLabel(record(info.parameters).Url) : spyToolLabel(name);
      emit({ level: "info", message: `${step.state === "ACTIVE" ? "Đang thực hiện" : "Đã nhận phản hồi công cụ"}: ${lastTool}.` });
    } else if (["item.started", "item.completed"].includes(String(packet.type))) {
      const item = record(packet.item);
      if (item.type === "command_execution") {
        lastTool = commandLabel(item.command);
        const failed = packet.type === "item.completed" && typeof item.exit_code === "number" && item.exit_code !== 0;
        emit({ level: failed ? "error" : "info", message: `${packet.type === "item.started" ? "Đang thực hiện" : failed ? "Lệnh thất bại" : "Lệnh đã kết thúc"}: ${lastTool}.` });
      } else if (item.type === "mcp_tool_call") {
        emit({ level: "info", message: `${packet.type === "item.started" ? "Đang gọi MCP" : "MCP đã trả phản hồi"}: ${spyToolLabel(typeof item.tool === "string" ? item.tool : "")}.` });
      } else if (item.type === "web_search") {
        emit({ level: "info", message: packet.type === "item.started" ? "Đang tìm bằng chứng trên web." : "Đã nhận kết quả tìm trên web." });
      }
    } else if (packet.type === "turn.failed" || packet.type === "error") emit({ level: "error", message: "CLI báo lỗi trong lượt thực thi." });
  };
  return {
    push(chunk) {
      for (const part of chunk.split(/(?<=\n)/)) {
        if (!discard) pending += part;
        if (pending.length > 2_000_000) { pending = ""; discard = true; }
        if (part.endsWith("\n")) { if (!discard) parse(pending); pending = ""; discard = false; }
      }
    },
    finish() { if (pending && !discard) parse(pending); pending = ""; },
  };
}
