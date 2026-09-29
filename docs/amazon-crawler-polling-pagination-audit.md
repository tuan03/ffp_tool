# Báo cáo audit 5: polling gọn và phân trang dữ liệu Amazon Crawler

Thay đổi được thực hiện trên nhánh `fix-bug-audit`. [Audit 4](amazon-crawler-partial-family-audit.md) mô tả partial family có cấu trúc.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Poll tiến độ | Client gọi snapshot mỗi 700 ms. Coordinator duyệt tất cả task, result và sự kiện progress của job để dựng danh sách từng ASIN. | Client gọi `/api/v1/crawl-jobs/{jobId}/summary`; coordinator lấy số đếm từ SQL, chỉ đọc sự kiện progress mới nhất và trả `completed`, `total`, `currentAsin`, `status`, `errors` cùng phase/message ngắn. | Chi phí poll không còn phụ thuộc vào kích thước toàn bộ result hoặc lịch sử progress. |
| Live product | Mỗi vòng poll có thể gọi `/products` và tải lại toàn bộ product, gồm media, source variants và final variants. | `/products` chỉ trả danh sách ID, source key, trạng thái và cursor, tối đa 100 mục mỗi trang. Runner kiểm tra danh sách tối đa mỗi 5 giây và chỉ tải chi tiết product mới hoặc có trạng thái pipeline thay đổi. | Product hoàn chỉnh không bị gửi lại theo từng nhịp progress. |
| Chi tiết và variants | Chưa có API riêng; `/products` trả tất cả. | `/products/{itemId}` trả chi tiết một product và `variantCount`, không chứa `variants`; `/products/{itemId}/variants?cursor=...` trả tối đa 100 variant mỗi trang. | UI có thể lấy phần cần xem; một response variants có giới hạn rõ ràng. |
| Danh sách job | UI tải snapshot chi tiết của tối đa 25 job mỗi 3 giây. | Danh sách job dùng summary gọn; job đang hủy vẫn giữ thông tin xác nhận Stop nhưng không đọc result hay product payload. | Giảm việc đọc result và sự kiện progress của các job cũ. |

Raw HTML của **cả trang Amazon** vốn không được trả trong progress. Lỗi chính là việc poll lặp lại product lớn và dựng snapshot tốn tài nguyên. `descriptionHtml` và `sourceVariants` vẫn có thể nằm trong endpoint chi tiết product vì đó là thao tác lấy dữ liệu product có chủ đích. `/results` và `/export` vẫn trả toàn bộ kết quả khi người dùng cần kết quả cuối hoặc tải file; chúng không còn được dùng để cập nhật progress đang chạy.

Coordinator giới hạn các trường và độ dài của progress do agent gửi trước khi ghi sự kiện. Trường ngoài danh sách như `html` hoặc `customizationRaw` bị bỏ, kể cả khi agent gửi nhầm. UI progress chính hiển thị số link hoàn tất, ASIN đang xử lý và số lỗi; danh sách thẻ progress của **mọi** ASIN không còn nằm trong response summary.

## API và giới hạn

| Endpoint | Dữ liệu trả về |
| --- | --- |
| `GET /api/v1/crawl-jobs/{jobId}/summary` | Trạng thái, số đếm và tiến độ ngắn; không có product. |
| `GET /api/v1/crawl-jobs/{jobId}/metadata` | Cấu hình job; loader lấy một lần để khôi phục đúng ZIP, giá và các tùy chọn sau F5. |
| `GET /api/v1/crawl-jobs/{jobId}/products?cursor=...&limit=...` | Danh sách product ngắn; mặc định 50, tối đa 100. Cursor là ID của mục cuối trang trước. |
| `GET /api/v1/crawl-jobs/{jobId}/products/{itemId}` | Chi tiết một product, trừ mảng final `variants`. `itemId` lấy từ trang danh sách và là khóa duy nhất của product trong job. |
| `GET /api/v1/crawl-jobs/{jobId}/products/{itemId}/variants?cursor=...&limit=...` | Mảng variants theo offset cursor; mặc định 50, tối đa 100. |

Client quét các trang danh sách ngắn ở mỗi lần làm mới product để phát hiện ID mới, vì ID hiện tại không được cấp theo thứ tự thời gian. Nó chỉ tải payload chi tiết cho product mới hoặc product đổi trạng thái. Đây là phân trang response, chưa phải luồng thay đổi tăng dần theo thời gian.

**Thay đổi contract:** `/products` trước đây trả product đầy đủ; giờ trả các mục tóm tắt và `nextCursor`. Client trong repository đã được cập nhật cùng API. Khi triển khai cần cập nhật coordinator và web cùng phiên bản. Không có dependency hoặc biến môi trường mới. Nhánh `fix-bug-audit` được giữ theo chỉ dẫn của người dùng, thay cho quy tắc tạo nhánh riêng trong `AGENTS.md`.

## Kiểm tra

- Test engine kiểm tra cả response và SQL: summary, trang danh sách và polling job đang hủy không đọc `task_results`, `raw_payload` hoặc `normalized_payload`. Endpoint detail tách variants; cursor, giới hạn trang và HTTP 404/422 hoạt động; progress loại bỏ HTML/customization raw.
- Test web xác nhận runner dùng `/summary`, loader ghép nhiều trang product/variants, giữ cấu hình job khi khôi phục, dùng lại chi tiết không đổi và tải lại khi trạng thái thay đổi.
- `npm run test:engine`: 221 test được chạy, 220 qua; 1 test PostgreSQL bỏ qua vì không có test database.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.
- `npm test`: tooling 6/6 và web 667/667 qua; gateway 250/251. Test symlink `/etc/hosts` trên Windows trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR` như các audit trước, nên lệnh tổng dừng trước engine; engine được chạy riêng.

### Chạy ASIN thật: `B0FY3HS8JT` (28/09/2026)

Crawl headless với ZIP `90001` trên cache tách biệt, không export hoặc đồng bộ Shopify: hoàn tất 12 sản phẩm và 12 source variants. Đưa các product vừa crawl vào coordinator SQLite thử nghiệm để gọi API mới:

- `/summary`: 346 byte; không có `descriptionHtml`, `sourceVariants`, `customizationRaw` hoặc `variants`.
- Trang đầu `/products?limit=5`: 557 byte cho 5 mục; có cursor sang trang kế tiếp và không có các trường product lớn trên.
- Endpoint detail trả `variantCount: 6` nhưng không chứa mảng final `variants`; trang variants `limit=5` trả 5 mục và cursor để lấy tiếp.

Đây là phép thử crawl Amazon thật rồi nạp kết quả vào coordinator thử nghiệm; nó chưa chạy đầy đủ đường agent WebSocket, pipeline SEO hoặc Shopify. Kích thước response là số đo của một lần thử này, không phải giới hạn byte cố định.

## Giới hạn còn lại

- Endpoint chi tiết vẫn có thể lớn nếu một product có nhiều source variants, media hoặc customization. Final variants đã được tách trang; các trường chi tiết khác chưa phân trang.
- Dữ liệu variants hiện lưu trong JSON của product; mỗi request trang variants vẫn đọc JSON của **một product** trong database rồi cắt response. Poll summary không đọc JSON đó. Nếu một product có hàng nghìn variants và cần tối ưu sâu hơn, cần tách variants thành bảng riêng.
- `/results` là response đầy đủ khi job kết thúc. UI hiện cần toàn bộ sản phẩm cho kết quả và thao tác bàn giao SEO; việc phân trang hoàn toàn trong UI là một thay đổi riêng.
