import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createCustomGptClient } from "../service";
import { AgentAccessPanel } from "../ui/AgentAccessPanel";

test("Agent Access starts with a clear task navigation, not technical metrics or a token form", () => {
  const client = createCustomGptClient(async () => { throw new Error("Render must not fetch"); });
  const html = renderToStaticMarkup(createElement(AgentAccessPanel, { client, storeId: "demo" }));
  assert.match(html, /Kết nối máy/);
  assert.match(html, /Phiên chạy/);
  assert.match(html, /Hoạt động/);
  assert.match(html, /xử lý SEO \+ đánh giá GSC/);
  assert.match(html, /Không tự duyệt hoặc đồng bộ Shopify/);
  assert.doesNotMatch(html, /Sức khỏe SEO Worker|Tỷ lệ retry|Copy Start Prompt|Tạo token 24 giờ/);
});
