# Báo cáo audit 8: cache atomic, chống corrupt và giới hạn tài nguyên

Audit này tiếp nối [partial family](amazon-crawler-partial-family-audit.md), [checkpoint](amazon-crawler-stage-checkpoint-audit.md) và [retry có phân loại](amazon-crawler-classified-retry-audit.md).

Thực hiện trên nhánh `fix-bug-audit` theo yêu cầu của người dùng, thay cho quy tắc tạo nhánh riêng trong `AGENTS.md`. Phạm vi là raw family, partial, negative và checkpoint cache trên agent/local engine. Cache ảnh của coordinator có cơ chế riêng và không được thay đổi trong audit này.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Atomic write | Đã có file tạm, `flush`, `fsync` và `os.replace`. | Giữ cơ chế này; file tạm chứa cache key để cleanup nhận diện chủ sở hữu. POSIX cũng `fsync` thư mục sau khi thay file. | Crash trước bước replace giữ bản cache cũ. |
| Nội dung JSON bị đổi nhưng vẫn đúng cấu trúc | Schema và kiểm tra cấu trúc chưa phát hiện được thay đổi này. | SHA-256 trên JSON canonical; `cacheFormatVersion: 1`, schema vẫn là 8. Kiểm tra trước khi dùng dữ liệu. | File không khớp checksum được quarantine, không biến thành lỗi parser Amazon. |
| Hai worker cùng ghi partial | Lock chỉ có hiệu lực giữa các thread trong một tiến trình. Snapshot ghi sau có thể làm mất child của snapshot trước. | Lock hệ điều hành giữa các tiến trình; đọc lại bản mới nhất dưới lock rồi merge theo child ASIN. Child hoàn chỉnh không bị thay bằng child lỗi có cùng options. | Giữ được kết quả từ cả hai worker. |
| Hai lượt crawl dùng cùng cache key | Có thể cùng tải và cùng thay đổi journal/family. | Giữ guard của family trong suốt lượt crawl. Worker khác cùng key phải chờ rồi đọc lại cache. Lock I/O riêng cho phép các child thread ghi checkpoint. | Giảm crawl trùng và ngăn worker cũ tạo lại partial/journal sau family hoàn chỉnh. |
| Journal bị corrupt | Dòng JSON lỗi được bỏ qua; nội dung bị đổi nhưng vẫn là JSON có thể được dùng. | Checksum từng record; bỏ record lỗi, giữ record hợp lệ, lưu bản lỗi vào quarantine nếu ngân sách cho phép và thay journal đã sửa bằng atomic write. | Phục hồi phần đã hoàn tất. Crash giữa lúc sửa journal vẫn giữ bản nguồn để lần sau phục hồi. |
| File quá lớn | Đọc toàn bộ JSON/journal trước khi xử lý. | Kiểm tra kích thước file đang mở và giới hạn số byte đọc; giới hạn cả khi ghi. | Chặn file quá lớn trước khi decode; một file không tăng vô hạn. |
| Cache tăng dung lượng | Chỉ quarantine có trần, còn product cache không có quota. | Quota byte và số file, TTL cleanup và LRU theo lần truy cập được lưu trong metadata. | Giới hạn lượng dữ liệu cache tích lũy. |
| Cleanup ảnh hưởng crawl đang chạy | Chưa có guard được chia sẻ với tiến trình crawl. | Cleanup bỏ qua key đang được crawl hoặc đang có I/O; giữ negative cache còn cooldown. Nếu không đủ chỗ, từ chối ghi cache mới. | Giữ dữ liệu đang sử dụng; crawl vẫn có thể trả kết quả dù không ghi được cache. |
| File `.tmp` sau crash | Có thao tác dọn thủ công. | Dọn khi khởi tạo cache; agent còn chạy maintenance theo heartbeat, tối đa một lượt quét mỗi 60 giây. | File tạm bỏ dở không phải chờ thao tác thủ công. |
| Quan sát cache | Chỉ có `cacheHit` trong diagnostics sản phẩm. | Counters bền vững và gauges byte/file, đọc được trong health local engine và status agent. | Theo dõi hit, miss, corrupt, eviction và việc từ chối ghi. |

## Chính sách mặc định

| Cấu hình | Giá trị |
| --- | --- |
| Một file family/partial/negative hoặc một record checkpoint | 32 MiB |
| Một journal checkpoint | 128 MiB |
| Tổng dữ liệu cache được quản lý | 512 MiB |
| Số file dữ liệu được quản lý | 10.000 |
| TTL family | 7 ngày kể từ lúc ghi; cache hit không kéo dài độ tươi của dữ liệu |
| TTL partial/checkpoint | 24 giờ; checkpoint theo lần ghi cuối |
| TTL negative | Theo `retryAfter` của từng lỗi |
| Quarantine | Tối đa 20 file và 50 MiB; nằm trong ngân sách dữ liệu cache |
| Maintenance | Khi khởi tạo; sau đó tối đa một lượt mỗi 60 giây khi được gọi từ hoạt động cache, heartbeat agent hoặc health local |
| Chờ lock | Tối đa 30 giây, đồng thời tuân theo deadline ASIN/job bao ngoài |

Các mức trên được định nghĩa trong `CacheLimits`, không thêm biến môi trường hay dependency. Cleanup ưu tiên file hết hạn/file tạm bỏ dở, rồi dùng LRU khi cần giải phóng dung lượng. Family hợp lệ vẫn được giữ khi Stop; TTL/LRU hoạt động độc lập với vòng đời job.

Quota tính byte nội dung và số file family, partial, negative, journal, temporary và quarantine. SQLite metadata/counters và file lock không thuộc quota dữ liệu này. Lock được ánh xạ vào 1.024 bucket cho mỗi loại để số file lock không tăng theo lịch sử ASIN; hai key trùng bucket được xử lý tuần tự. Quota không phải số đo chính xác dung lượng cấp phát của filesystem.

Khi vượt giới hạn file hoặc hết ngân sách mà không thể eviction an toàn, tăng `writeRejected`, giữ bản cache/partial/checkpoint cũ và không coi đó là lỗi Amazon. Một lượt crawl thành công có thể chưa được lưu lại trong tình huống này.

## Merge partial và tính tương thích

- Merge thực hiện dưới lock I/O liên tiến trình, luôn đọc lại partial mới nhất trước khi ghi.
- Giữ child hoàn chỉnh khi snapshot khác báo child đó lỗi nhưng vẫn cùng options; cập nhật bốn danh sách ASIN. ASIN/options đã phát hiện trong các snapshot được ghép lại cho lượt tiếp tục.
- Family cache hoàn chỉnh được ưu tiên. Partial hoặc checkpoint ghi muộn không tạo lại dữ liệu dở bên cạnh family hoàn chỉnh.
- Cache schema 8 cũ, không có checksum, được kiểm tra cấu trúc và nâng cấp khi đọc thành công, trong giới hạn ghi. Family cũ đã quá TTL mới sẽ hết hạn. Checksum chưa thể xác nhận tính toàn vẹn của dữ liệu trước lần nâng cấp.
- Cần cập nhật mọi worker dùng chung thư mục cache: worker cũ không tuân theo lock mới và có thể tiếp tục ghi snapshot không có checksum.
- Checksum phát hiện sai lệch nội dung; không xác minh giá/HTML Amazon và không phải cơ chế chống người có quyền sửa cả payload lẫn checksum.

## Metrics và API

Metadata/counters nằm trong `.runtime/cache/cache-metrics.sqlite3`, dùng chung giữa các worker cùng cache directory. SQLite bị corrupt được quarantine và tạo lại index từ các file cache; family hợp lệ vẫn giữ được, counters cũ không phục hồi được trong trường hợp này.

`GET /api/amazon-crawler/health` của local engine thêm trường `cache`. Status local của agent cũng thêm trường này. Không thêm route, không đưa nội dung sản phẩm vào health, không đổi contract TypeScript hay giao diện polling coordinator.

```json
{
  "hit": 1,
  "miss": 32,
  "corrupt": 1,
  "evicted": 0,
  "writeRejected": 0,
  "temporaryRemoved": 0,
  "bytes": 892615,
  "files": 2,
  "maxBytes": 536870912,
  "maxFiles": 10000
}
```

Counters là số lần thao tác/quan sát của cache, gồm các lookup nội bộ, không phải số sản phẩm hoặc số request Amazon. Ví dụ một family cache hit có thể tạo 12 sản phẩm cache hit trên UI. `evicted` đếm file bị dọn tự động; xóa cache thủ công không reset lịch sử counters. Byte/file lấy từ index và được đối chiếu lại khi maintenance.

## Kiểm tra

- Mô phỏng hai tiến trình đọc cùng snapshot cũ rồi ghi partial: giữ được child của cả hai; child lỗi không ghi đè child hoàn chỉnh.
- Hai tiến trình append journal: đủ 20 record child, không mất hoặc trộn dòng.
- Kill tiến trình giữ lock: tiến trình khác lấy lại được lock; cleanup bỏ qua key còn có chủ sở hữu.
- Crash trước khi replace family: bản cũ còn nguyên, `.tmp` được dọn sau khởi tạo mới.
- Crash khi replace journal đã sửa: lần khởi động sau vẫn lấy lại parent và matrix đã hoàn tất.
- Test checksum JSON/journal, legacy upgrade, JSON lồng quá sâu, file/write quá lớn, LRU, TTL của key chưa đọc lại, giới hạn số file, quota giữ cooldown/partial, metrics qua restart và metadata SQLite corrupt.
- `npm run test:engine`: 282 test qua, 1 test PostgreSQL bỏ qua vì chưa cấu hình test database.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.
- `npm test`: tooling 6/6, web 668/668, gateway 250/251. Lỗi gateway symlink `/etc/hosts` trên Windows có sẵn vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`. Lệnh tổng dừng trước engine; engine được chạy riêng.

### Chạy thử Amazon thật: `B0FY3HS8JT` — 28/09/2026

Chạy headless, ZIP `90001`, cache tách biệt, không tạo export hoặc đồng bộ Shopify.

| Lượt | Kết quả |
| --- | --- |
| Crawl mới | Hoàn tất 12 child và 12 sản phẩm, không lỗi; 49,07 giây. Family được ghi kèm checksum. |
| Cache hit | 12 sản phẩm cache hit; 0,75 giây. Không gọi lại hàm lấy trang parent/child. |
| Phục hồi corrupt | Chủ động đổi title trong JSON nhưng giữ checksum cũ. Crawler phát hiện mismatch, quarantine một file rồi lấy lại đủ 12 child/12 sản phẩm từ Amazon; không lỗi; 51,81 giây. Counter `corrupt` tăng lên 1. |

Corruption do test tạo có chủ đích; đây không phải lỗi đĩa tự phát. Bộ đếm hàm lấy trang không bao gồm mọi request HTTP bootstrap/media bên trong. Thời gian là số đo của lần chạy này, không phải cam kết hiệu năng. Thử đồng thời và crash dùng dữ liệu giả; không cố gây crash hoặc nhiều lượt crawl trùng tới Amazon thật.

## Giới hạn

- Lock/cache là cục bộ trên một filesystem. Không chia sẻ checkpoint giữa các agent khác máy; chưa kiểm chứng lock trên network filesystem.
- Guard family có thể khiến cùng key hoặc key trùng bucket phải đợi. Deadline giới hạn thời gian chờ và worker được giải phóng khi hết hạn.
- Nếu dữ liệu đang được bảo vệ chiếm hết ngân sách, thao tác ghi cache bị từ chối; cần giải phóng dung lượng hoặc đổi giới hạn trước khi kỳ vọng mọi kết quả đều được lưu.
- Các file bị bên ngoài sửa/copy vào thư mục được tính lại khi đọc hoặc maintenance; quota không ngăn một chương trình khác ghi vào thư mục.
- Đã thử process crash bằng tiến trình hệ điều hành trên Windows; chưa thử mất điện, lỗi phần cứng đĩa hoặc filesystem chỉ đọc. Không cam kết khôi phục bước chưa flush/fsync xong.
- Lượt này chưa build/chạy installer hoặc EXE agent mới. Metrics chưa được bổ sung thành dashboard tổng hợp tại coordinator.

## Vị trí thay đổi chính

- `engine/cache.py`: checksum, giới hạn đọc/ghi, atomic repair, merge partial và ưu tiên family hoàn chỉnh.
- `engine/cache_storage.py`: process lock, SQLite index/counters, quota, TTL/LRU và cleanup.
- `engine/crawler_core.py`: giữ guard cho vòng crawl family.
- `engine/distributed/client_agent.py`: status metrics, maintenance qua heartbeat và dùng lại cache service.
- `engine/server.py`: health local có metrics nhỏ, tái sử dụng cache service.
- `engine/tests/test_cache_integrity.py`: kiểm chứng integrity, hai tiến trình, crash và giới hạn tài nguyên.
