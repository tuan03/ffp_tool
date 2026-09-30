import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewImagePage } from "../ui/ReviewImagePage";
import { createReviewImageClient } from "../service";

test("review image page exposes upload, scope, editable prompt and approval controls", () => {
  const client = createReviewImageClient(async () => { throw new Error("No network during render"); });
  const html = renderToStaticMarkup(<ReviewImagePage client={client} />);
  assert.match(html, /Tạo ảnh review/);
  assert.match(html, /type="file"/);
  assert.match(html, /Ctrl\+V để dán ảnh sản phẩm/);
  assert.match(html, /Xem thư mục template/);
  assert.match(html, /Tải ảnh template lên/);
  assert.match(html, /Xóa template đang chọn/);
  assert.match(html, /Chỉ túi chính/);
  assert.match(html, /Cả túi và ví/);
  assert.match(html, /Image 1/);
  assert.match(html, /Image 2/);
  assert.match(html, /Tạo lại cùng nền/);
  assert.match(html, /Đổi nền/);
  assert.match(html, /Chỉ duyệt khi sản phẩm và bối cảnh đều đúng/);
});

test("template upload accepts several image files in one selection", () => {
  const client = createReviewImageClient(async () => { throw new Error("No network during render"); });
  const html = renderToStaticMarkup(<ReviewImagePage client={client} />);
  const templateInput = html.match(/Tải ảnh template lên<input[^>]+>/)?.[0];
  assert.ok(templateInput);
  assert.match(templateInput, /multiple=""/);
});
