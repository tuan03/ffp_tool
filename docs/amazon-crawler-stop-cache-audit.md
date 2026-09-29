# Báo cáo audit 2: vòng đời cache và thao tác hủy job Amazon Crawler

Tài liệu này mô tả thay đổi của audit thứ hai. [Audit thứ nhất](amazon-crawler-negative-cache-audit.md) mô tả negative cache và dữ liệu crawl partial.

## Trước và sau khi sửa

| Thao tác | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Hủy job | Stop tăng `cacheGeneration` toàn cục. Mọi agent đang kết nối xóa toàn bộ family, negative và partial cache; agent offline xóa khi kết nối lại. Coordinator cũng xóa negative cache và image cache chưa được bảo vệ. | Chỉ dừng job được chọn và dọn lease, spool của job đó. Cache family hoàn chỉnh, partial, negative và ảnh đã xử lý vẫn còn. | Dừng job B không làm mất cache sản phẩm hợp lệ do job A tạo ra. |
| Dọn dữ liệu tạm | Gắn với Stop. | Có thao tác riêng để xóa file ghi cache tạm bị bỏ dở và lease/spool của job đã không còn trên coordinator. Giữ dữ liệu của job còn tồn tại và giữ cache sản phẩm. Agent offline thực hiện khi kết nối lại. | Người vận hành dọn dữ liệu thừa mà không làm mất kết quả crawl. |
| Xóa cache ASIN | Chưa có thao tác riêng. | Chỉ xóa family, negative và partial cache của một ASIN trong ZIP Amazon hiện tại. Coordinator cũng xóa negative record tương ứng và lưu lệnh để agent offline thực hiện khi kết nối lại. | Có thể làm mới một sản phẩm mà không xóa cache các ASIN khác. |
| Xóa toàn bộ cache | Có nút riêng, nhưng agent offline không chắc chắn xóa khi kết nối lại. | Nút riêng có xác nhận. Lệnh tăng `cacheGeneration` bền vững, xóa cache trên các agent đang kết nối, negative cache tại coordinator và image cache chưa được bảo vệ. Agent offline xóa khi kết nối lại. | Chỉ xóa toàn bộ cache khi người vận hành chủ động yêu cầu. |

Ba thao tác bảo trì cache yêu cầu không có job đang chạy hoặc đang hủy. Nút trên UI cũng bị khóa khi có job active; coordinator kiểm tra lại và trả HTTP 409 nếu có yêu cầu đến đồng thời.

Cache của một ASIN được phân theo ASIN, ZIP và phiên bản schema. Vì vậy, xóa cache ASIN tại ZIP hiện tại không xóa cùng ASIN ở ZIP khác. Mục này dành cho ASIN dùng làm khóa family cache; một child ASIN nằm trong family khác có thể cần làm mới qua ASIN parent.

## Kiểm tra

Test tập trung xác nhận Stop giữ family/partial cache, negative và image cache; dọn dữ liệu tạm giữ job còn tồn tại; vô hiệu hóa ASIN chỉ tác động đúng ASIN và ZIP; agent offline nhận cả ba lệnh bảo trì khi kết nối lại; và coordinator từ chối bảo trì cache khi job active.

- `npm run test:web`: 666 test qua.
- `npm run test:engine`: 209 test qua; 1 test PostgreSQL được bỏ qua vì môi trường không cấu hình test database.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.
- `npm test`: tooling 6/6 và web 666/666 qua; gateway 250/251. Test gateway về symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`; đây là lỗi có sẵn ngoài phần Amazon Crawler, nên lệnh tổng dừng trước khi chạy engine.
- Chưa chạy crawl Amazon trực tiếp để đo số request thực tế.

## Giới hạn vận hành

- Nếu agent đang kết nối không phản hồi lệnh bảo trì trước thời gian chờ, API trả số agent đã phản hồi và số lỗi. Lệnh vô hiệu hóa ASIN hoặc xóa toàn bộ vẫn được lưu để agent áp dụng khi kết nối lại.
- Nếu lệnh bảo trì gặp lỗi I/O trên agent, agent sẽ kết nối lại để nhận và thử lại lệnh còn thiếu trước khi nhận job mới.
- Hủy job sẽ bỏ lease/spool của chính job đó; các dữ liệu này không dùng để tiếp tục job đã hủy. Cache sản phẩm crawl thành công vẫn dùng được cho job sau.
