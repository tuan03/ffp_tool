import assert from "node:assert/strict";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { appendSpyEvent, createSpyStreamObserver, readSpyEvents } from "../ads-intelligence/spy-events";
import type { SpyEventInput } from "../ads-intelligence/spy-events";

test("AGY streams operational events and the denied action without exposing commands or reasoning", () => {
  const entries: SpyEventInput[] = [];
  let result = "";
  const observer = createSpyStreamObserver(event => entries.push(event), value => { result = value; });
  const tool = { event: "step_update", step_update: { step_index: 7, step_type: "tool", state: "ACTIVE", tool_name: "run_command", tool_info: { parameters: { CommandLine: "python3 /private/secret/prepare_publish.py --token SECRET" }, output: "PRIVATE DATA" } } };
  const stream = [JSON.stringify({ event: "step_update", step_update: { step_type: "agent_response", text: "PRIVATE REASONING" } }), JSON.stringify(tool), JSON.stringify(tool), JSON.stringify({ event: "result", result: { status: "SUCCESS", denied_actions: [{ action: "command" }] } })].join("\n");
  for (let offset = 0; offset < stream.length; offset += 13) observer.push(stream.slice(offset, offset + 13));
  observer.finish();
  assert.equal(entries.length, 2);
  assert.match(entries[1]?.message ?? "", /từ chối quyền chạy lệnh.*Lệnh python3/);
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|PRIVATE|prepare_publish|\/private/);
  assert.equal(JSON.parse(result).denied_actions[0].action, "command");
});

test("Codex command failures and MCP events are observable without raw tool output", () => {
  const entries: SpyEventInput[] = [];
  const observer = createSpyStreamObserver(event => entries.push(event), () => {});
  observer.push(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "node ffp-tools.mjs call ads_fetch_competitor_page '{secret}'", exit_code: 1, aggregated_output: "SECRET" } }) + "\n");
  observer.push(JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "ads_get_competitor_ad", result: "SECRET" } }) + "\n");
  assert.equal(entries[0]?.level, "error");
  assert.match(entries[0]?.message ?? "", /Lấy quảng cáo từ Page/);
  assert.doesNotMatch(JSON.stringify(entries), /SECRET|secret/);
});

test("Spy logs survive reload, are isolated by job, and tolerate partial writes", async () => {
  const first = await mkdtemp(join(tmpdir(), "spy-events-"));
  const second = await mkdtemp(join(tmpdir(), "spy-events-"));
  try {
    for (let index = 0; index < 205; index++) await appendSpyEvent(first, { level: "info", message: `Event ${index}` });
    await appendFile(join(first, "events.jsonl"), '{"partial":');
    const entries = await readSpyEvents(first);
    assert.equal(entries.length, 200);
    assert.equal(entries[0]?.message, "Event 5");
    assert.equal(entries.at(-1)?.message, "Event 204");
    assert.deepEqual(await readSpyEvents(second), []);
    await appendFile(join(second, "calls.jsonl"), JSON.stringify({ tool: "ads_get_store_overview", at: "2026-10-05T08:42:51.000Z", isError: false }) + "\n");
    assert.match((await readSpyEvents(second))[0]?.message ?? "", /nhật ký cũ.*Đọc tổng quan store/);
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});
