import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentPrompt } from "../ui/agent-prompt";

test("Vietnamese prompt reflects the requested store and target without publication rights", () => {
  const prompt = createAgentPrompt({ storeId: "demo", target: 10 });
  assert.match(prompt, /10 sản phẩm/);
  assert.match(prompt, /"demo"/);
  assert.match(prompt, /\$ffp-seo/);
  assert.match(prompt, /Không phê duyệt hoặc đồng bộ lên Shopify/);
  assert.match(createAgentPrompt({ storeId: "second", target: 50 }), /50 sản phẩm.*"second"/);
  for (const target of [0, -1, 1.5, NaN, Infinity]) assert.equal(createAgentPrompt({ storeId: "demo", target }), "");
});

test("resume prompt identifies the existing run instead of requesting a fresh target", () => {
  const prompt = createAgentPrompt({ storeId: "demo", target: 50, runId: "saved-run" });
  assert.match(prompt, /Tiếp tục phiên "saved-run"/);
  assert.match(prompt, /chỉ xử lý phần còn thiếu/);
  assert.doesNotMatch(prompt, /50 sản phẩm/);
});
