# Báo cáo sửa lỗi cache thất bại của Amazon Crawler

Phạm vi: thay đổi trong commit `68c42bb` trên nhánh `fix-bug-audit`. Tài liệu này mô tả hành vi trước và sau khi sửa; các con số thời gian là cấu hình trong code, không phải số đo hiệu năng thực tế.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Crawl thất bại hoàn toàn | Không ghi thành product cache, nhưng cũng không lưu lý do và thời điểm được thử lại. Job sau có thể gọi Amazon lần nữa. | Lưu **negative cache** riêng theo ASIN và ZIP, gồm `status`, `reason`, `retryAfter`. Coordinator cũng giữ trạng thái này để các agent cùng tuân theo. | Giảm các lần gọi lặp đối với cùng một lỗi, kể cả khi job được giao cho agent khác. |
| CAPTCHA | Tuyến HTTP có thời gian nghỉ riêng, nhưng task lỗi vẫn có thể được đưa lại vào hàng đợi ngay; các ASIN khác tiếp tục được giao. | CAPTCHA có thời gian chờ 2 phút. Coordinator tạm dừng giao thêm task Amazon trong thời gian đó. | Hạn chế việc cả loạt link tiếp tục đập vào Amazon sau khi đã phát hiện chặn truy cập. |
| Lỗi khác nhau bị gom chung | Phần lớn lỗi crawl được trả về dưới mã `CRAWL_FAILED`, `retryable: true`. | Phân loại `not_found`, `temporarily_blocked`, `network_error`, `parser_error`, `invalid_asin` và `partial`; giữ mã lỗi và thời gian chờ trong kết quả job. | Dễ biết khi nào cần đợi, khi nào cần kiểm tra HTML, và khi nào không nên retry. |
| Family crawl dở | Family chưa đủ dữ liệu không được dùng lại như cache thành công; lượt sau có thể tải lại cả parent và các child đã thành công. | Lưu dữ liệu partial trên agent trong 24 giờ. Lượt retry ưu tiên agent đó, dùng lại parent và child đã hoàn chỉnh, rồi lấy phần còn thiếu. Nếu agent offline, task được giao cho agent khác để job không bị kẹt. | Giữ dữ liệu đã lấy và giảm số lần tải lại trong luồng retry thông thường. |
| Gallery lỗi | Một family có thể đạt điều kiện ghi product cache dù bước lấy đủ gallery thất bại; sản phẩm có warning gallery vẫn có thể được gửi tiếp. | Cache thành công từ chối variant có gallery lỗi; sản phẩm thiếu gallery bị chặn trước khi gửi đi và được xử lý như partial. | Tránh tái sử dụng hoặc đồng bộ sản phẩm thiếu ảnh do lỗi crawl. |
| Xóa cache | Chỉ xóa family cache trên agent. | Xóa family, negative và partial cache trên agent; thao tác xóa cache hoặc Stop cũng xóa negative cache tại coordinator. | Lần chạy sau có thể thử lại từ đầu khi người vận hành chủ động xóa cache. |

## Quy tắc xử lý từng trạng thái

| Trạng thái | Thời gian lưu/chờ | Tự retry? | Cách xử lý |
| --- | --- | --- | --- |
| `not_found` | 24 giờ | Không | Dùng khi phản hồi có HTTP 404 hoặc thông báo `product not found`; tránh gọi lại ASIN đó trong thời gian lưu lỗi. |
| `temporarily_blocked` với `reason: captcha` | 2 phút | Có, sau thời gian chờ | Tạm dừng cả việc giao thêm task Amazon tại coordinator. |
| `network_error` | 30 giây | Có, sau thời gian chờ | Cho phép thử lại lỗi mạng hoặc lỗi thiếu giá bán có thể chỉ là tạm thời. |
| `invalid_asin` | Không ghi negative cache | Không | Từ chối ngay tại bước chuẩn hóa đầu vào; không gọi Amazon. |
| `parser_error` | 10 phút | Không | Trả mã lỗi để người vận hành kiểm tra HTML hoặc logic parser. |
| `partial` | Dữ liệu đã lấy được giữ 24 giờ trên agent | Có nếu phần thiếu có thể phục hồi | Ưu tiên retry trên agent đang giữ dữ liệu; không tự retry nếu nguyên nhân là `not_found`, `parser_error` hoặc chạm giới hạn số variant. |

Ví dụ một negative cache record:

```json
{
  "asin": "B012345678",
  "status": "temporarily_blocked",
  "retryAfter": "2026-09-28T04:00:00+00:00",
  "reason": "captcha"
}
```

`retryAfter` trong ví dụ chỉ minh họa định dạng UTC; thời điểm thực được tính lúc phát sinh lỗi. Coordinator giới hạn tối đa 3 lần crawl thất bại cho một task trong một job. Với lỗi không cho tự retry, task dừng ngay.

## Kết quả kiểm tra

- `npm run test:engine`: 195 test qua; 1 test PostgreSQL được bỏ qua vì môi trường không cấu hình test database.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.
- `npm test`: tooling 6/6 và web 665/665 qua; gateway 250/251. Test gateway về symlink `/etc/hosts` trên Windows trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`. Lỗi này nằm ngoài phần Amazon Crawler và đã tái hiện khi chạy riêng.
- Chưa chạy crawl trực tiếp tới Amazon, nên hiệu quả giảm số request trong môi trường thật chưa được đo.

## Giới hạn cần biết

- Những request đã được giao hoặc đang chạy trước khi coordinator nhận lỗi CAPTCHA vẫn có thể hoàn tất hoặc thất bại. Thời gian chờ ngăn các lượt giao **tiếp theo**; nó không thu hồi request đang chạy.
- Partial cache là file trên agent. Khi agent đó offline, agent thay thế vẫn xử lý được job nhưng có thể phải tải lại các variant mà agent cũ đã lấy.
- Phân loại `not_found` dựa trên dấu hiệu HTTP 404 hoặc thông báo `product not found`. Một trang Amazon không hiển thị sản phẩm nhưng không có các dấu hiệu đó có thể được phân loại thành lỗi parser hoặc lỗi mạng và cần kiểm tra kết quả thực tế.

## Vị trí thay đổi chính

- `src/modules/amazon-crawler/engine/cache.py`: cache thành công, negative cache và partial cache.
- `src/modules/amazon-crawler/engine/crawler_core.py`: phân loại lỗi, điều kiện ghi cache, khôi phục partial và chặn sản phẩm thiếu dữ liệu.
- `src/modules/amazon-crawler/engine/distributed/coordinator_store.py`: chia sẻ trạng thái lỗi, lịch retry, thời gian chờ CAPTCHA và ưu tiên agent giữ partial cache.
- `src/modules/amazon-crawler/engine/distributed/coordinator_server.py`: xóa negative cache khi xóa cache hoặc Stop.
- `src/modules/amazon-crawler/types.ts`: bổ sung trường lỗi tùy chọn `status`, `reason`, `retryAfter` cho dữ liệu trả về giao diện.
