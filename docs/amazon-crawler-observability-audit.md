# Báo cáo audit 9: quan sát flow Amazon Crawler

Thay đổi được triển khai trên nhánh `fix-bug-audit`, theo yêu cầu giữ các audit trên cùng nhánh của người dùng. Audit này tiếp nối [cache integrity](amazon-crawler-cache-integrity-audit.md) và giữ cách polling nhẹ của [audit 5](amazon-crawler-polling-pagination-audit.md).

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Theo dõi một ASIN | Có job/task, progress, diagnostics và log riêng, nhưng chưa có request ID xuyên suốt các bước crawl. | Family dùng `requestId` ổn định theo task. Child có ID riêng và `familyRequestId` trỏ về family. Context đi qua thread, process crawler, HTTP và Playwright. | Tra cứu được những bước thuộc cùng một family, kể cả qua lượt retry. |
| Dùng lại cache/checkpoint | Diagnostics lưu thông tin của lần crawl trước; chưa tách rõ thống kê của lần hiện tại. | Ghi sự kiện cache riêng, cập nhật ID hiện tại khi dùng lại dữ liệu. Metrics đếm sự kiện mới; không cộng lại attempt/CAPTCHA lịch sử trong cache. | Một lượt cache hit không bị tính thành request Amazon mới. |
| Theo dõi lỗi và thời gian | Thông tin phân tán trong warning, timeout và diagnostics; thiếu bộ đếm tổng hợp. | Trace có bước, route, profile, task attempt, request attempt, duration và kết quả. Có sự kiện kết thúc khi supervisor timeout hoặc hủy worker. | Biết ASIN dừng ở đâu, qua route/profile nào và mất bao lâu. |
| Dashboard | Chưa có bộ chỉ số chung cho chất lượng crawl và tài nguyên agent. | Thêm cache hit, HTTP success, fallback, CAPTCHA, thời gian trung bình, retry, partial, parser error, queue depth và RAM/browser theo agent. | Nhìn được tình trạng crawler và tải tài nguyên mà không mở từng product lớn. |
| Agent mất kết nối | Chưa có luồng gửi trace bền vững có xác nhận. | Sự kiện lưu trong SQLite spool, gửi theo lô và chỉ xóa sau ACK. Coordinator loại trùng theo `eventId`. | Agent có thể gửi lại sau restart/reconnect; gửi lại cùng sự kiện không làm tăng bộ đếm. |
| Kích thước telemetry/log | Chưa có giới hạn và lọc dữ liệu thống nhất cho trace. | Chỉ nhận các trường được cho phép; giới hạn sự kiện, spool, retention, trang trace và file log. Che HTML, cookie/header nhạy cảm, URL có credential, token và proxy credential đã cấu hình. | Hạn chế telemetry chiếm RAM/đĩa hoặc đưa dữ liệu nhạy cảm vào log. |

## Cách đọc trace

- `jobId`: job chứa ASIN; `taskId`: task do coordinator tạo; `agentId`: agent thực hiện.
- `requestId`: ID của ASIN. Với ASIN đầu vào, ID bằng task ID; child được tạo ID ổn định từ family ID và child ASIN.
- `familyRequestId`: nối tất cả child về cùng family. Retry task vẫn giữ family ID; `leaseId` và `taskAttempt` phân biệt lượt chạy.
- `attempt`: lượt thử của thao tác HTTP/browser hiện tại. `taskAttempt`: số lần coordinator đã cấp lease cho task.
- `route`, `profile`, `cacheKey`, `result`, `durationMs`: có ở sự kiện tương ứng. Sự kiện cache không có route mạng khi không thực hiện request.

Các sự kiện bao gồm cấp task/retry, bắt đầu/kết thúc family, cache hit/miss/read/write, lấy trang, HTTP/browser attempt, fallback Playwright, matrix, media, customization, checkpoint và child/parser failure. Product diagnostics giữ các ID cần để mở trace từ sản phẩm đang chọn trên UI.

Diagnostics có thể giữ thông tin kỹ thuật lịch sử của dữ liệu được dùng lại. Bộ đếm dashboard được tính từ sự kiện của lượt chạy, không suy ra từ các diagnostics lịch sử đó.

## Định nghĩa chỉ số

Dashboard mặc định tổng hợp các sự kiện đã nhận trong **24 giờ gần nhất**, cập nhật mỗi **10 giây**. Các lần fetch không chồng lên nhau. Agent gửi snapshot tài nguyên theo heartbeat 10 giây.

| Chỉ số | Cách tính |
| --- | --- |
| Cache hit rate | Family cache hit / (family cache hit + miss). Không trộn cache negative, partial hoặc checkpoint vào mẫu số này. |
| HTTP success rate | HTTP attempt thành công / tổng HTTP attempt. Phản hồi CAPTCHA hoặc bị chặn không được coi là thành công chỉ vì có HTTP 200. |
| Playwright fallback rate | Số lượt lấy trang sản phẩm chuyển sang Playwright / tổng lượt bắt đầu lấy trang sản phẩm. Fallback thất bại vẫn được đếm. |
| CAPTCHA rate | Attempt HTTP/browser gặp CAPTCHA / tổng attempt HTTP/browser. Dù giải CAPTCHA thành công, lần gặp CAPTCHA vẫn được ghi nhận. |
| Average crawl duration | Trung bình thời gian thực hiện family của các lượt đã kết thúc, gồm cache hit và lỗi. Không gồm thời gian chờ hàng đợi hoặc pipeline SEO/Shopify. |
| Retry count | Tổng request retry HTTP/browser có `attempt > 1` và lượt task được cấp lại. API trả riêng hai số để phân biệt. |
| Partial family count | Task có kết quả family mới nhất là partial trong cửa sổ thống kê. Retry hoàn tất sẽ bỏ task khỏi số partial. |
| Parser failure count | Lỗi parser mới phát sinh; đọc lại negative cache parser không tăng số này. |
| Queue depth | Task crawl đang queued, số task leased/running và số sản phẩm đang chờ/đang xử lý trong các bước pipeline được tính. |
| RAM/browser | Tổng RAM resident của agent và tiến trình con; browser context/trang đang mở; số tiến trình Chromium, gồm cả renderer. |

Khi chưa có mẫu số, tỷ lệ là `null` và UI ghi “Chưa có số liệu”. Agent cũ chưa gửi RAM hiển thị “Chưa đo RAM”; không thay bằng số 0. RAM được đọc bằng API Windows hoặc `/proc` trên Linux, không đọc command line hoặc credential.

## API, lưu trữ và giới hạn

```text
GET /api/v1/crawler-metrics
GET /api/v1/crawler-metrics?jobId=...
GET /api/v1/crawl-jobs/:jobId/traces/:requestId?cursor=...&limit=50
```

Metrics là SQL aggregate, không tải HTML, raw product hay final variants để tính toán. Trace là endpoint riêng: mặc định 50, tối đa 100 sự kiện/trang; UI tải khi người dùng mở và bấm nút, mỗi lần thay trang đang hiển thị. Summary/progress tiếp tục dùng contract nhẹ hiện có.

- Mỗi sự kiện tối đa **4 KiB**; mỗi lô tối đa **64 sự kiện**. Coordinator kiểm tra task/lease thuộc đúng agent và ghi lại danh tính chuẩn từ database.
- Spool agent giữ tối đa **10.000 sự kiện**. Khi đầy, bỏ sự kiện cũ nhất và tăng số `dropped`; dashboard hiển thị backlog và số bị bỏ.
- Coordinator dọn sự kiện quá **7 ngày**, giữ tối đa **100.000 sự kiện** sau mỗi lượt bảo trì. Bảo trì khoảng một phút/lần, nên dung lượng có thể vượt ngưỡng giữa hai lượt.
- Log cục bộ dùng rotation **5 MiB/file + 3 bản cũ**, khoảng 20 MiB cho mỗi loại log. File crawler trace ở `.runtime/logs/crawler-trace.jsonl`, coordinator ở `.runtime/logs/coordinator-debug.jsonl`, agent debug ở data directory của agent. Log stdout cần retention do dịch vụ vận hành cấu hình.
- Log lỗi `JobEvent` chỉ giữ các trường chẩn đoán cho phép. HTML/customization raw và trường lạ trong payload lỗi không được ghi vào log này; danh sách trong log cũng được giới hạn.
- Không thêm dependency, biến môi trường hoặc cấu hình ở thư mục gốc. Có bảng database mới `crawl_telemetry_events`, được tạo qua cơ chế `create_all` hiện có. Môi trường tắt tạo schema cần tạo bảng/index mới trước khi dùng endpoint mới.
- `metrics`/`trace` trên job controller và các ID trong diagnostics là trường bổ sung; controller cũ vẫn tương thích. Agent cũ không cung cấp đủ metrics mới; cần cập nhật coordinator và agent để có toàn bộ số liệu.

## Chạy thử Amazon thật: `B0FY3HS8JT` — 28/09/2026

Chạy headless, ZIP `90001`, cache và database tách biệt; không export hoặc đồng bộ Shopify. Agent xử lý bằng process crawler thật. Nội dung sản phẩm/customization được lấy từ Amazon; sự kiện spool được chuyển vào coordinator cục bộ và metrics/trace được đọc qua HTTP TestClient. Đây chưa phải bài đo qua mạng giữa hai máy agent/VPS.

| Lượt thử | Kết quả | HTTP/browser attempt | Trace | Thời gian |
| --- | --- | --- | --- | --- |
| Cache trống | 12 sản phẩm, 12 source variants, không lỗi | 24 HTTP thành công, 0 browser | 115 sự kiện, 12 request ID gồm family và child | 61,82 giây cho toàn harness; 60.178 ms cho family |
| Dùng lại cache, chạy lại sau rà soát cuối | 12 sản phẩm đều `cacheHit: true`, không lỗi | 0 HTTP, 0 browser | 5 sự kiện | 1,87 giây cho toàn harness; 74 ms cho family |
| Fallback Playwright có kiểm soát | 12 sản phẩm, không lỗi | 24 HTTP attempt, 23 thành công; 1 browser attempt thành công | 117 sự kiện; đúng 1 fallback | 74,57 giây cho toàn harness; 72.260 ms cho family |

Ở lượt fallback, harness **giả lập một lỗi HTTP cho trang parent** để buộc chạy nhánh này; Playwright sau đó tải Amazon thật. Vì vậy HTTP success 23/24 không chứng minh Amazon đã trả lỗi đó trong thực tế. Lượt này đo được tối đa 1 browser context, 2 trang mở và 5 tiến trình Chromium. Tổng RAM resident cao nhất của harness/agent và tiến trình con khoảng 1.020 MiB; số này gồm overhead thử nghiệm và có thể tính trùng vùng nhớ dùng chung giữa các process, không phải yêu cầu RAM tối thiểu cho sản phẩm.

Ở cả ba lượt, gửi lại toàn bộ sự kiện không làm tăng bộ đếm. Spool về 0, không có sự kiện bị bỏ. Trace được đọc qua cursor với 20 sự kiện/trang trong bài thử; không có trường HTML, cookie, token hoặc customization raw. Summary khoảng **426 byte**, metrics khoảng **1,1 KiB** trong cấu hình một agent này. Đây là số đo của lần chạy, không phải giới hạn cố định cho mọi job/agent.

HTTP attempt ở đây là lượt gọi thao tác fetch được instrument, không phải tổng mọi request trên dây: bootstrap cookie, asset của trình duyệt và request nội bộ trong một thao tác không đều có sự kiện HTTP riêng.

## Kiểm tra

- 16 test observability tập trung: context/allowlist, redaction, rotation, cache và checkpoint dùng lại ID hiện tại, hủy worker, spool restart/overflow, ACK/replay không đếm trùng, xác thực agent, SQL metrics, partial phục hồi, retention và endpoint/websocket.
- 4 test TypeScript: service API và cursor, mock trả bản sao riêng, dữ liệu RAM chưa đo/dropped, từ chối response sai contract.
- Kiểm tra dashboard bằng Playwright trong chế độ mock: đủ thẻ chỉ số, không có lỗi JavaScript; đã xem ảnh giao diện.
- `npm run test:engine`: 299 test, 298 qua và 1 test PostgreSQL bỏ qua do chưa cấu hình test database.
- `npm test`: tooling 6/6 và web 672/672 qua; gateway 250/251. Test symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`, giống lỗi có sẵn của các audit trước. Lệnh tổng dừng ở gateway; engine được chạy riêng với kết quả ở trên.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua. Build còn cảnh báo kích thước bundle hiện có.

## Giới hạn vận hành

- Metrics phản ánh **sự kiện đã nhận và còn được giữ**, không bảo đảm đủ lịch sử khi spool tràn, I/O lỗi hoặc retention đã xóa. Agent hiển thị `backlog`/`dropped`; API có `retainedSince` để kiểm tra dữ liệu còn lưu.
- Snapshot RAM/browser lấy theo heartbeat, nên thao tác rất ngắn giữa hai heartbeat có thể không xuất hiện trong số đo tài nguyên. Nếu đọc thiếu process, `isComplete: false` cho biết phép đo chưa đủ.
- Crash hệ điều hành trước khi ghi spool có thể mất sự kiện đang ghi. Các bước chưa hoàn tất không tự biến thành thành công; lease và retry vẫn do coordinator hiện có xử lý.
- Metrics cửa sổ 24 giờ không khôi phục từ diagnostics của job cũ chạy trước bản nâng cấp. Trace hết hạn hoặc job đã purge không còn đọc được; cursor hết hạn yêu cầu tải lại từ đầu.
- Bài thử thật xác nhận một ASIN và nhánh fallback có kiểm soát; chưa đo tải 1.000 ASIN, nhiều agent hoặc PostgreSQL production.
