# Báo cáo audit 7: retry theo loại lỗi của Amazon Crawler

Audit này tiếp nối [negative cache](amazon-crawler-negative-cache-audit.md), [partial family](amazon-crawler-partial-family-audit.md) và [timeout ở các tầng](amazon-crawler-timeout-audit.md).

Thực hiện trên nhánh `fix-bug-audit` theo yêu cầu của người dùng, thay cho quy tắc tạo nhánh riêng của `AGENTS.md`. Phạm vi là module Amazon Crawler và tài liệu này; không thêm dependency, biến môi trường, route API hoặc migration database.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| HTTP 429/503 | Gom thành lỗi mạng, retry sau 0,25 và 0,5 giây; bỏ qua `Retry-After`. | Giữ HTTP status và loại lỗi; đọc `Retry-After` dạng số giây hoặc ngày HTTP, backoff tăng dần có jitter, đưa route vào cooldown và sử dụng route khác nếu còn. | Giảm việc gọi dồn vào route đang bị giới hạn. |
| Cooldown bị bỏ qua | Browser có thể được gọi ngay sau khi HTTP bị rate limit; ASIN khác hoặc worker mới có thể tiếp tục dùng route đó. | Không chuyển sang browser để vượt lịch chờ của lỗi 429/503 cuối cùng. Trong cùng worker, ASIN khác nhận lại nguyên nhân rate limit. Coordinator lưu cooldown của client để worker mới cũng phải chờ; client khác vẫn được giao việc. | Giữ thời gian chờ qua vòng đời worker. |
| CAPTCHA bị phân loại sai | Body CAPTCHA của response 503 không được đọc; selector sản phẩm có thể timeout trước khi kiểm tra challenge. | Đọc body lỗi có giới hạn để nhận diện CAPTCHA; Playwright kiểm tra challenge trước selector sản phẩm. | Challenge được xử lý theo cooldown hoặc luồng giải CAPTCHA thay vì retry như lỗi selector. |
| CAPTCHA hoặc 429/503 ở child | Partial family thường chỉ báo `reason: incomplete`, làm coordinator mất nguyên nhân chặn truy cập. | Family giữ lý do CAPTCHA hoặc rate limit khi child có lỗi tương ứng. Coordinator áp dụng cooldown cả với partial family. | CAPTCHA ở child vẫn tạm dừng giao thêm task; rate limit vẫn chặn client bị lỗi. |
| HTTP 404 và browser lỗi mạng | Có thể ghi `not_found` 24 giờ chỉ vì thông báo lỗi tổng hợp chứa HTTP 404. | HTTP 404 được coi là chưa xác minh. Chỉ ghi `not_found` khi browser đọc được thông báo trang không tồn tại đã nhận diện, không có CAPTCHA và không có tài liệu sản phẩm hợp lệ. | Tránh khóa ASIN 24 giờ khi browser chưa xác minh thành công. |
| Selector/parser | Thiếu title và thiếu selector đi qua hai chính sách retry khác nhau. | HTML đã render nhưng thiếu selector cần thiết là lỗi parser, không tự retry. Trang trống hoặc deadline thực sự hết vẫn là timeout. HTTP thiếu dữ liệu có thể được xác minh bằng browser; lỗi parser ở lượt xác minh kết thúc sớm. | Không xoay nhiều profile chỉ vì parser không còn khớp HTML. |
| Cache corrupt | JSON hỏng bị bỏ qua nhưng còn nguyên; JSON đúng cú pháp nhưng thiếu trường có thể thành `PARSER_ERROR` và negative cache. | Kiểm tra cấu trúc family, partial và failure cache; file hỏng được quarantine rồi xem như cache miss. Crawler phục hồi từ checkpoint hợp lệ hoặc crawl lại. | Lỗi đĩa/cache không bị xem là bằng chứng Amazon thay đổi HTML. |
| Các worker retry đồng thời | Chờ cố định; jitter chỉ có ở reconnect coordinator. | Retry HTTP/browser và lịch retry task có jitter. Coordinator tăng backoff theo số lần thất bại; vẫn giữ giới hạn 3 lượt crawl thất bại. | Giảm các đợt retry cùng thời điểm. |

## Chính sách hiện tại

| Lỗi | Xử lý |
| --- | --- |
| `http_429`, `http_503` | Tối thiểu 30 giây cho negative cache; tôn trọng `Retry-After` và cộng jitter. HTTP/browser có thể đổi route sau lịch chờ. Nếu vẫn thất bại, coordinator lưu cooldown của client trong database. |
| `captcha` | Negative cache tối thiểu 120 giây; profile bị chặn thường nghỉ 300 giây. Coordinator có thể kéo dài lịch retry theo backoff/jitter và tạm ngừng giao thêm task Amazon. |
| Timeout/lỗi mạng có thể phục hồi | Chờ có jitter; coordinator dùng backoff cơ sở 30 giây, tăng theo số lần thất bại. Deadline child/ASIN/job của audit 6 vẫn giới hạn việc chờ và retry. |
| `parser_error` | Không tự retry ở coordinator; negative cache 10 phút để kiểm tra parser/HTML. |
| `invalid_asin` | Reject trước khi gọi Amazon; không retry. |
| `not_found_unverified` | Có thể retry có giới hạn; không ghi negative cache 24 giờ. |
| `not_found` đã xác minh | Không tự retry; negative cache 24 giờ, có `notFoundConfirmed: true`. |
| Child lỗi | Giữ partial/checkpoint; chỉ lấy lại phần thiếu sau thời gian chờ. |
| Cache corrupt | Quarantine file lỗi, tiếp tục từ dữ liệu hợp lệ còn lại hoặc crawl lại. |

Backoff tự tính có trần 300 giây; `Retry-After` dài hơn trần này vẫn là thời gian tối thiểu cho lịch chờ. Jitter không rút ngắn thời gian được server yêu cầu. Header không hợp lệ dùng thời gian mặc định. Tổng thời gian chờ vẫn bị deadline bao ngoài giới hạn; đây không phải quyền kéo dài một job vô hạn.

Cooldown client ở coordinator áp dụng khi task báo lỗi cuối cùng là 429/503, gồm partial family giữ lý do đó. Đây là chính sách thận trọng cho client, không phải hệ thống xác định IP/proxy dùng chung giữa mọi máy. Các task đã được giao trước đó vẫn có thể chạy.

## Cache và tính tương thích

- Family cache giữ nguyên phiên bản schema, nên family hợp lệ từ audit trước vẫn dùng được.
- Negative record `not_found` cũ không có xác nhận được bỏ qua khi đọc trên agent/coordinator để có thể xác minh lại. Job cũ đã kết thúc không tự được chạy lại.
- Các trường lỗi TypeScript mới `httpStatus` và `notFoundConfirmed` là tùy chọn. Contract cũ vẫn đọc được; cần cập nhật coordinator và agent để áp dụng đầy đủ chính sách mới.
- Quarantine nằm trong `.runtime/cache/quarantine/`, giữ tối đa 20 file và 50 MiB. File vượt giới hạn giữ lại có thể bị loại bỏ. Xóa toàn bộ cache xóa cả quarantine; vô hiệu hóa ASIN chỉ xóa các bản tương ứng với khóa ASIN/ZIP đó.
- Journal checkpoint bị cắt ở dòng cuối vẫn phục hồi các bước hợp lệ theo audit 3. Không bỏ cả journal chỉ vì dòng cuối bị lỗi.

## Kiểm chứng

Test tập trung vào: header `Retry-After`; đổi route; cooldown giữa các ASIN và qua worker/coordinator mới; HTTP session/ZIP bootstrap bị rate limit; CAPTCHA trong body lỗi; xác minh 404 thất bại hoặc thành công; selector và customization; partial child giữ nguyên nhân; backoff theo số lần thất bại; và quarantine/khôi phục cache.

- `npm run test:engine`: 262 test qua, 1 test PostgreSQL bỏ qua vì chưa cấu hình test database.
- `npm test`: tooling 6/6, web 668/668, gateway 250/251. Test gateway về symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`; đây là lỗi có sẵn ngoài Amazon Crawler. Lệnh tổng dừng trước engine, nên engine được chạy riêng.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.

### Chạy thử Amazon thật: `B0FY3HS8JT` — 28/09/2026

Chạy headless với ZIP `90001`, cache tách biệt, không tạo export hoặc đồng bộ Shopify.

| Lượt | Kết quả |
| --- | --- |
| Crawl mới | Hoàn tất 12 child và 12 sản phẩm, không có lỗi; 76,79 giây. |
| Dùng lại family cache | 12 sản phẩm đều cache hit; 0,46 giây. Không gọi lại hàm lấy trang parent/child. |
| Giả lập một child lỗi 503 | Trong lượt kiểm tra cuối, 11 child hoàn chỉnh, chỉ `B0FY3JFG53` còn thiếu; family báo `partial`, `reason: http_503`; 49,33 giây. Negative cache của child giữ HTTP status 503. |
| Chờ cooldown | Chờ đúng thời điểm được lưu trong `retryAfter`, thêm 0,1 giây để qua ranh giới hết hạn; lượt cuối chờ khoảng 30,87 giây. Không xóa negative cache để chạy tắt. |
| Retry phần thiếu | Hoàn tất 12 child và 12 sản phẩm, không có lỗi; 6,44 giây. Bộ đếm hàm lấy trang ghi nhận chỉ gọi `B0FY3JFG53`; parent và 11 child đã hoàn chỉnh được dùng lại. |

Lỗi 503 được **giả lập trước request của child đó** để kiểm tra luồng retry; nội dung các child thành công và child được retry lấy từ Amazon thật. Đây không phải bằng chứng Amazon đã trả 503. Số lần gọi hàm lấy trang không phải số đo tất cả request HTTP nội bộ, bootstrap hoặc media. Các thời gian là số đo của lần thử này, không phải cam kết hiệu năng.

## Giới hạn

- Xác minh trang không tồn tại dựa trên các dấu hiệu HTML được nhận diện trong profile tiếng Anh của crawler. Trang 404 chưa rõ nguyên nhân tiếp tục thuộc nhóm chưa xác minh; chưa kiểm chứng mọi mẫu trang chặn của Amazon trong thực tế.
- Cooldown theo client có thể làm giảm tốc độ client dù một route khác của nó còn tốt; client khác vẫn được giao task. Chưa có bảng sức khỏe proxy chia sẻ cho toàn cụm.
- Partial/checkpoint vẫn nằm trên agent. Khi chuyển sang agent khác, agent mới có thể phải lấy lại dữ liệu.
- Bộ test không cố tạo rate limit/CAPTCHA thật bằng cách gửi nhiều request Amazon. Các nhánh này được kiểm chứng bằng lỗi giả lập; lượt crawl thật xác nhận lấy dữ liệu, cache và tiếp tục child thiếu.
- Agent Windows đóng gói cần build lại; lượt này chưa build hoặc chạy installer/EXE mới.

## Vị trí thay đổi chính

- `engine/retry_policy.py`: loại lỗi trang, CAPTCHA, xác minh 404, `Retry-After` và jitter/backoff.
- `engine/crawler_core.py`: HTTP error body, route cooldown, fallback, nguyên nhân lỗi partial và retry customization theo child.
- `engine/playwright_pool.py`: nhận diện challenge/trang lỗi trước selector, phân loại HTML và retry route.
- `engine/cache.py`: validate, quarantine, đọc negative cache đã xác minh và jitter cho lỗi mạng.
- `engine/distributed/coordinator_store.py`: backoff, cooldown client bền vững và giữ metadata lỗi.
- `types.ts`: các trường metadata lỗi tùy chọn.
