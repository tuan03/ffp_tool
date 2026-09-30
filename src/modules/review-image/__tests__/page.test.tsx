import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReviewImagePage } from "../ui/ReviewImagePage";
import { createReviewImageClient } from "../service";

test("review image page exposes multi-image, store template and Shopify approval controls", () => {
  const client = createReviewImageClient(async () => { throw new Error("No network during render"); });
  const html = renderToStaticMarkup(<ReviewImagePage client={client} />);
  assert.match(html, /Tạo ảnh review/);
  assert.match(html, /type="file"/);
  assert.match(html, /Ctrl\+V để dán ảnh sản phẩm/);
  assert.match(html, /Template của preaureum/);
  assert.match(html, /Chọn file template/);
  assert.match(html, /dán một hoặc nhiều template/);
  assert.match(html, /Xóa đã chọn/);
  assert.match(html, /Chỉ túi chính/);
  assert.match(html, /Cả túi và ví/);
  assert.match(html, /Image 1/);
  assert.match(html, /Image 2/);
  assert.match(html, /Chọn nhiều ảnh sản phẩm/);
  assert.match(html, /Duyệt &amp; upload tất cả/);
});

test("template upload accepts several image files in one selection", () => {
  const client = createReviewImageClient(async () => { throw new Error("No network during render"); });
  const html = renderToStaticMarkup(<ReviewImagePage client={client} />);
  const templateInput = html.match(/Chọn file template<input[^>]+>/)?.[0];
  assert.ok(templateInput);
  assert.match(templateInput, /multiple=""/);
});
