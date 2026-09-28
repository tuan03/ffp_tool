# Báo cáo audit 6: timeout ở các tầng của Amazon Crawler

Audit này tiếp nối [checkpoint](amazon-crawler-stage-checkpoint-audit.md), [partial family](amazon-crawler-partial-family-audit.md) và [polling có pagination](amazon-crawler-polling-pagination-audit.md).

Thực hiện trực tiếp trên nhánh `fix-bug-audit` theo yêu cầu của người dùng; đây là ngoại lệ đối với quy tắc tạo nhánh riêng cho từng task trong `AGENTS.md`. Phạm vi thay đổi là module Amazon Crawler và tài liệu này. Không thêm dependency hoặc biến môi trường.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| DNS và connect | HTTP dùng một giá trị timeout của `urllib`, chưa có ngân sách riêng cho DNS và kết nối. | HTTP transport tách DNS và TCP/TLS connect. Các bước vẫn bị giới hạn bởi deadline HTTP, child, family và job ở bên ngoài. | Không để việc phân giải địa chỉ hoặc kết nối kéo dài toàn lượt crawl. |
| HTTP trả dữ liệu nhỏ giọt | Có socket timeout 90 giây, nhưng chưa giới hạn tổng thời gian đọc hết response. | Giới hạn thời gian từ lúc mở request đến khi đọc hết body; khi hết hạn, ngắt socket đã mở và trả lỗi có cấu trúc. | Server gửi dữ liệu liên tục từng ít một không kéo dài request vô hạn. |
| Playwright | Có timeout riêng cho một số navigation/selector, nhưng lệnh chờ future và browser slot chưa có giới hạn tổng. | Chờ slot, navigation, selector, customization và CAPTCHA tuân theo deadline cấp trên. Future bị hủy khi hết hạn. | Các lần retry và chờ tài nguyên không kéo dài vượt ngân sách của child/family. |
| Child hoặc cả family bị kẹt | `as_completed()` đợi mọi future, chưa có deadline tổng. | Child và ASIN có deadline; tiến trình giám sát cũng nhận thông tin bắt đầu/kết thúc từng scope. Khi native call không chịu dừng, tiến trình crawl và browser con bị kết thúc trước khi báo thất bại để nhả slot. | Một request, parser hoặc customization bị treo không giữ agent slot vô thời hạn. |
| Heartbeat còn hoạt động nhưng task không tiến triển | Heartbeat gia hạn lease 60 giây liên tục. | Lease được chặn tại deadline của lượt ASIN và job; heartbeat/progress không kéo dài các deadline này. | Coordinator thu hồi lượt crawl quá hạn ngay cả khi agent vẫn online. |
| Toàn job quá hạn | Chưa có deadline bền vững. | Tính deadline từ thời điểm tạo job và cấu hình đã lưu trong database. Hết hạn sử dụng luồng hủy job, giữ cache hợp lệ và báo lỗi `stage: job`. | Restart coordinator và các lượt retry không đặt lại ngân sách của job. |
| Thông tin timeout | Thông tin nằm rải rác trong diagnostics; lỗi trả về chưa có đủ trường. | Trả `stage`, `attempt`, `route`, `profile`, `elapsedMs`, `isRetryable`, `retryAfter`; giữ trường `retryable` cũ. Negative cache và kết quả coordinator giữ các trường này. | Có thể xác định tầng quá hạn và lịch retry mà không suy đoán từ message. |
| Dữ liệu đã crawl | Checkpoint và partial cache đã tồn tại nhưng chưa được nối với cơ chế timeout tổng. | Giữ checkpoint, partial và family cache khi timeout; trả lại các danh sách child đã hoàn thành và còn thiếu. | Lượt retry tiếp tục phần thiếu, giữ kết quả của các child thành công. |

## Cấu hình mặc định

Các giá trị dưới đây là cấu hình, không phải số đo hiệu năng. Có thể chỉnh trong **Advanced Settings → Giới hạn thời gian xử lý** hoặc request tạo job.

| Tầng | Trường cấu hình | Mặc định | Khoảng cho phép qua API/UI |
| --- | --- | --- | --- |
| DNS của HTTP transport | `dnsTimeoutSeconds` | 10 giây | 1–120 giây |
| TCP/TLS connect của HTTP transport | `connectTimeoutSeconds` | 15 giây | 1–120 giây |
| HTTP request và toàn response sản phẩm | `httpResponseTimeoutSeconds` | 90 giây | 1–600 giây |
| Playwright navigation | `navigationTimeoutSeconds` | 60 giây | 1–300 giây |
| Selector sản phẩm | `selectorTimeoutSeconds` | 15 giây | 1–120 giây |
| Giai đoạn customization của child | `customizationTimeoutSeconds` | 120 giây | 1–900 giây |
| Giải CAPTCHA thủ công | `captchaTimeoutSeconds` | 180 giây | 30–900 giây |
| Một child ASIN | `childTimeoutSeconds` | 300 giây | 1–3.600 giây |
| Một lượt crawl ASIN/family | `asinTimeoutSeconds` | 1.800 giây | 1–14.400 giây |
| Toàn job, gồm thời gian chờ và retry | `jobTimeoutSeconds` | 21.600 giây | 1–86.400 giây |

- Khởi tạo phiên HTTP/ZIP dùng tối đa 12 giây cho mỗi request; selector ảnh/body phụ dùng giới hạn ngắn hơn, tối đa 5–10 giây. Chờ marker customization còn có giới hạn 20 giây và trả timeout có cấu trúc khi không xuất hiện.
- DNS/connect riêng áp dụng cho tuyến HTTP của crawler. Kết nối bên trong Chromium được giới hạn qua navigation và các deadline bao ngoài.
- Một bước dùng thời gian còn lại của các scope bao ngoài. HTTP/browser retry trong cùng lượt ASIN không đặt lại ngân sách của ASIN.
- Một lượt task mới do coordinator giao lại có ngân sách ASIN mới; tối đa 3 lượt thất bại. Deadline job luôn giữ nguyên, kể cả sau restart.
- Timeout có thể phục hồi chờ 30 giây trước retry. CAPTCHA giữ chính sách chờ 2 phút của audit 1. Timeout toàn job không tự retry; muốn chạy tiếp phải tạo job mới, có thể dùng lại cache/checkpoint.
- Job đã sang trạng thái chờ duyệt thủ công không bị bộ quét deadline của job đang chạy hủy. Deadline đang chạy vẫn bao gồm thời gian chờ agent hoặc chờ xử lý pipeline.

## Dữ liệu lỗi

Ví dụ minh họa một lỗi timeout HTTP:

```json
{
  "source": "B0FY3HS8JT",
  "code": "CRAWL_TIMEOUT",
  "status": "network_error",
  "reason": "timeout",
  "stage": "http_response",
  "attempt": 2,
  "route": "proxy",
  "profile": "profile-2",
  "elapsedMs": 90000,
  "retryable": true,
  "isRetryable": true,
  "retryAfter": "2026-09-28T10:00:30+00:00"
}
```

Thời điểm trong ví dụ chỉ minh họa. `route` và `profile` có thể là `null` khi chưa chọn tuyến, hoặc khi bước đang chạy là xử lý dữ liệu cục bộ. `attempt` là số lần thử tại tầng sinh lỗi. Timeout job có `isRetryable: false` và `retryAfter: null`.

Các trường TypeScript mới là tùy chọn để đọc được job cũ. `retryAfter` cho phép `null` ở lỗi không retry. UI có phần xem chi tiết timeout. Không đổi route API hay thêm dữ liệu sản phẩm vào polling.

## Chạy thử Amazon thật: `B0FY3HS8JT` — 28/09/2026

Chạy headless với ZIP `90001`, cache riêng; không tạo export hay đồng bộ Shopify.

| Lượt thử | Kết quả quan sát |
| --- | --- |
| Crawl mới | Hoàn tất 12 child và 12 sản phẩm, không có lỗi; lượt kiểm tra cuối mất 56,59 giây. |
| Dùng lại family cache | Hoàn tất 12 sản phẩm, cả 12 báo cache hit; 0,47 giây, gồm khởi động worker. |
| Cố ý làm treo child cuối | 11 child được lấy từ Amazon thật và ghi checkpoint. Test giữ child `B0FY3JFG53` trong một lệnh chờ không hợp tác, trước request của chính child đó. |
| Hết hạn child | Trả `stage: child`, `elapsedMs: 90003`, còn đúng một child thiếu; worker không còn sống khi trả kết quả. Tổng lượt gồm crawl 11 child và chờ timeout là 146,43 giây. |
| Restart với checkpoint vừa giữ | Hoàn tất lại family 12 child, 12 sản phẩm, không có lỗi; 5,96 giây. Journal được thay bằng family cache hoàn chỉnh. |

Đây là thử timeout được tạo có chủ đích, không phải Amazon tự trả lỗi cho child đó. Các giá trị thời gian là số đo của lần chạy này, không phải cam kết hiệu năng. Khác audit 3, lần thử này thực sự kết thúc tiến trình worker và khởi động tiến trình mới.

## Kiểm tra

Test tập trung xác nhận deadline lồng nhau; DNS/connect/HTTP response; navigation, selector, CAPTCHA và customization; hủy future; native customization không hợp tác; kết thúc worker trước callback nhả slot; giữ checkpoint và merge partial sau retry; heartbeat không kéo dài ASIN; deadline job sau restart; giữ metadata trong output; phân biệt family timeout với family cùng batch bị gián đoạn; và kênh IPC Windows khi nhiều thread gửi đồng thời.

- `npm run test:engine`: 239 test qua; 1 test PostgreSQL bỏ qua vì chưa cấu hình test database.
- `npm test`: tooling 6/6, web 668/668; gateway 250/251. Lỗi gateway có sẵn về symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`; lệnh tổng dừng trước engine, nên engine được chạy riêng.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.

## Giới hạn và triển khai

- Một worker chứa một batch ASIN. Khi phải kết thúc worker vì native hang, các family chưa xong trong cùng batch cũng bị gián đoạn. Chúng báo `WORKER_INTERRUPTED`, giữ checkpoint và được retry theo chính sách; family gây timeout có lỗi timeout riêng.
- Timeout hợp tác hủy ngay công việc đang chờ. Giám sát scope cho tối đa 1 giây để việc hủy hoàn tất trước khi kết thúc tiến trình; giám sát child/ASIN/job độc lập vẫn hoạt động. Kết thúc cây tiến trình và dọn worker có thể thêm vài giây, nên đây không phải hệ thống thời gian thực.
- Worker startup và cleanup có giới hạn riêng 60 và 45 giây. Deadline job hoặc deadline ASIN đã được coordinator giao có thể kết thúc sớm hơn.
- Hết hạn job tại coordinator đi qua `cancelling`/`cancelled` và giữ lỗi timeout trong kết quả. Lệnh ghi Shopify đã bắt đầu vẫn đi qua cơ chế dừng an toàn/đối soát của audit 2.
- Checkpoint vẫn là dữ liệu trên agent. Agent khác không có journal cũ để tiếp tục; chuyển agent có thể tải lại các child.
- Các entry point local server và distributed agent đã dùng `ProcessCrawler`. Nếu tích hợp trực tiếp lớp `AmazonCrawler` bên ngoài các entry point này, cần dùng wrapper tiến trình để có bảo đảm với native call không hợp tác.
- Cần cập nhật mã coordinator và agent; agent Windows đóng gói cần build lại để nhận supervisor mới. Đã thêm `multiprocessing.freeze_support()` cho entry point; lượt này chưa build hoặc chạy installer/EXE mới.

## Vị trí thay đổi chính

- `engine/timeouts.py`: deadline, metadata, truyền context và thông báo scope cho supervisor.
- `engine/bounded_http.py`: DNS và TCP/TLS connect riêng.
- `engine/process_crawler.py`: worker tiến trình, IPC có khóa và giới hạn hàng đợi, kết thúc cây tiến trình, phục hồi trạng thái từ cache.
- `engine/crawler_core.py`, `engine/playwright_pool.py`, `engine/cache.py`: timeout ở từng bước và giữ thông tin lỗi/partial.
- `engine/distributed/coordinator_store.py`: lease và deadline job bền vững.
- `engine/distributed/client_agent.py`, `engine/distributed/client_main.py`, `engine/server.py`: nối supervisor vào các entry point.
- `types.ts`, `mocks/runner.ts`, `ui/AmazonCrawlerPage.tsx`: contract tương thích, cấu hình và chi tiết lỗi trên UI.
