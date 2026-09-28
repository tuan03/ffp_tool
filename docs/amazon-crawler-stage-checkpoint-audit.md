# Báo cáo audit 3: checkpoint theo giai đoạn của Amazon Crawler

Tài liệu này mô tả thay đổi tiếp theo trên nhánh `fix-bug-audit`. [Audit 1](amazon-crawler-negative-cache-audit.md) xử lý negative/partial cache; [audit 2](amazon-crawler-stop-cache-audit.md) tách việc hủy job khỏi việc xóa cache sản phẩm.

## Trước và sau khi sửa

| Tình huống | Trước khi sửa | Sau khi sửa |
| --- | --- | --- |
| Agent crash sau khi lấy parent hoặc quét matrix | Chưa có bản lưu của các bước này; lần chạy lại có thể tải parent và quét matrix từ đầu. | Ghi `parent_complete` ngay sau khi lấy parent; ghi `matrix_complete` khi matrix đủ hoặc `matrix_snapshot` khi còn thiếu. Restart dùng lại phần đã lưu; matrix thiếu vẫn được quét tiếp. |
| Agent crash khi đang lấy child cuối | Kết quả các child trước chỉ nằm trong bộ nhớ. Partial cache chỉ được ghi sau khi vòng xử lý tất cả child kết thúc, nên có thể phải crawl lại gần hết family. | Ghi riêng theo ASIN khi lấy xong trang child (`child_page_complete`), gallery (`media_complete`), customization (`customization_complete`) và child đủ dữ liệu (`child_complete`). Restart bỏ qua child hoàn chỉnh và tiếp tục bước còn thiếu của child dở dang. |
| Agent crash ngay trước khi ghi family cache | Chưa có family cache hoặc partial cache. | Các child hoàn chỉnh đã nằm trong checkpoint. Restart lắp lại family từ dữ liệu đó mà không gọi lại Amazon cho chúng. Family cache hoàn chỉnh là checkpoint cuối cùng; khi ghi thành công, journal được xóa. |
| Crash đang ghi checkpoint | File đang ghi có thể dở dang. | Mỗi bản ghi được flush và `fsync`; khi đọc lại, dòng cuối lỗi hoặc bị cắt được bỏ qua, các bản ghi hợp lệ trước đó vẫn dùng được. |
| Vô hiệu hóa ASIN hoặc xóa toàn bộ cache | Chưa có journal checkpoint để xóa. | Xóa journal tương ứng cùng family, negative và partial cache. Dọn file tạm vẫn giữ checkpoint hợp lệ. |

Checkpoint lưu dạng journal cục bộ trong `.runtime/cache/checkpoint-*.jsonl`, theo khóa ASIN, ZIP và phiên bản schema. Mỗi child được nhận diện bằng ASIN thay vì số thứ tự, vì các child có thể hoàn thành song song; tiến độ `3/10` được suy ra từ số child hoàn chỉnh và matrix đã lưu. Journal hết hạn sau 24 giờ kể từ lần ghi cuối.

## Kiểm tra

- Test mô phỏng crash ở child tiếp theo: parent và child đã hoàn chỉnh được dùng lại sau khi tạo crawler mới.
- Test mô phỏng crash sau child cuối, trước khi ghi family: lần chạy lại không gọi lại Amazon.
- Test xác nhận gallery và customization đã hoàn tất được dùng lại; matrix chưa đủ tiếp tục quét; dòng checkpoint bị cắt không làm mất các bước trước; vô hiệu hóa ASIN xóa journal.
- `npm run test:engine`: 216 test qua, 1 test PostgreSQL được bỏ qua do chưa cấu hình test database.
- `npm run typecheck`, `npm run build` và `npm run build:mock`: qua.
- `npm test`: tooling 6/6 và web 666/666 qua; gateway 250/251. Test gateway về symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`. Đây là lỗi có sẵn ngoài Amazon Crawler; lệnh tổng dừng trước khi chạy engine, nên engine được chạy riêng ở trên.

## Giới hạn vận hành

- Checkpoint nằm trên đĩa của agent. Sau khi **chính agent đó** khởi động lại với cùng `project_root`, nó có thể tiếp tục từ bước còn thiếu. Nếu coordinator chuyển task sang agent khác, agent mới không có journal cũ và có thể phải crawl lại family.
- Nếu crash trước khi một bước được ghi và `fsync` xong, riêng bước đang chạy phải làm lại. Checkpoint không khôi phục trạng thái giữa một request Amazon đang dở.
- Chưa chạy crawl trực tiếp tới Amazon để đo mức giảm request trong môi trường thật.
