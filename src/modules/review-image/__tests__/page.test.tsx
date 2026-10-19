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
  assert.match(html, /1\. Chọn store và loại sản phẩm/);
  assert.match(html, /Preaureum · Túi và ví/);
  assert.match(html, /Chuẩn bị ảnh nền review/);
  assert.match(html, /Hướng dẫn/);
  assert.match(html, /Chọn ảnh nền từ kho/);
  assert.match(html, /Xem kho template/);
  assert.match(html, /Chọn từ kho template/);
  assert.match(html, /Tải ảnh nền mới/);
  assert.match(html, /2\. Chuẩn bị kho ảnh nền/);
  assert.match(html, /Tất cả template trong kho sẽ được xoay vòng ngẫu nhiên/);
  assert.match(html, /Checkbox chỉ dùng để đánh dấu template cần xóa/);
  assert.match(html, /Thêm ảnh nền mới vào kho/);
  assert.match(html, /Xóa template đã đánh dấu/);
  assert.match(html, /Thêm ảnh sản phẩm cần tạo review/);
  assert.match(html, /Kéo thả ảnh sản phẩm vào đây/);
  assert.match(html, /Chọn file ảnh/);
  assert.match(html, /Đã chọn 0 ảnh sản phẩm/);
  assert.match(html, /Xóa tất cả/);
  assert.match(html, /Danh sách ảnh \(0\)/);
  assert.match(html, /Sắp xếp/);
  assert.match(html, /Sử dụng prompt mặc định/);
  assert.match(html, /Mỗi ảnh đầu vào sẽ tạo một ảnh review riêng/);
  assert.match(html, /Ctrl\+V để dán ảnh sản phẩm; có thể dán thêm nhiều lần/);
  assert.match(html, /Chỉ túi chính/);
  assert.match(html, /Cả túi và ví/);
  assert.match(html, /Image 1/);
  assert.match(html, /Image 2/);
  assert.match(html, /Dừng tạo ảnh/);
  assert.match(html, /Duyệt &amp; upload tất cả/);
});

test("template upload accepts several image files in one selection", () => {
  const client = createReviewImageClient(async () => { throw new Error("No network during render"); });
  const html = renderToStaticMarkup(<ReviewImagePage client={client} />);
  const templateInput = html.match(/Thêm ảnh nền mới vào kho<input[^>]+>/)?.[0];
  assert.ok(templateInput);
  assert.match(templateInput, /multiple=""/);
});

