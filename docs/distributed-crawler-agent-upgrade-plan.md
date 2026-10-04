# Kế hoạch nâng cấp Distributed Crawl Agent — triển khai từng đợt, kiểm chứng từng lớp

> Ngày phân tích: 04/10/2026. Baseline: `cua_pro`, commit `775a0ae`.
> Nguồn yêu cầu: `D:\Shopify_Workspace\distributed_crawler_agent_server_task_spec.md`, các mục 1–58.
> Trạng thái: **đề xuất để duyệt, chưa phải tính năng đã triển khai hoặc kết quả nghiệm thu**.
> Phạm vi lần làm này: đọc đặc tả, đối chiếu source/test, viết kế hoạch. Không đổi code, database, container, agent hoặc VPS.
> Cập nhật cách thực hiện: dùng [checklist từng task](distributed-crawler-agent-audit-checklist.md) làm sổ tiến độ chính. Tài liệu này giữ vai trò giải thích kiến trúc và hiện trạng baseline. Task 01–08 đã được người dùng cho chuyển tiếp qua hội thoại; Task 09 thêm recovery gate và receipt-only reconcile, chờ người dùng test. Chưa cập nhật container/agent đang chạy. Các mô tả hành vi cũ bên dưới là baseline trước chuỗi sửa Task 02–09; xem báo cáo từng task để biết thay đổi mới.

## 1. Kết luận trước: nên làm gì và chưa nên làm gì?

Không nên coi 58 mục là 58 thay đổi triển khai độc lập, cũng không nên viết lại crawler từ đầu. Hệ thống hiện tại đã có nhiều phần reliability: Coordinator dùng PostgreSQL cho dữ liệu server; agent trên máy crawler dùng SQLite làm vùng đệm cục bộ khi mất mạng. Lease, heartbeat, reconnect, retry, hủy job, lịch sử attempt và giao diện giám sát đều đã có nền.

Nâng cấp này thực chất gồm ba lớp:

1. **Sửa và thống nhất quy tắc dữ liệu**: ai có quyền hoàn thành task, kết quả offline được giữ đến khi nào, stop/purge có được xóa kết quả hay không.
2. **Bổ sung lớp điều khiển có xác thực và lưu bền vững**: Agent Key, đăng ký identity, command có ACK, global stop, audit, quyền theo agent.
3. **Hoàn thiện vận hành và quy mô**: worker isolation/watchdog, dashboard, config version, cập nhật/rollback, nhóm agent, scheduler và circuit breaker.

Thứ tự đề xuất:

| Đợt | Kết quả cần nhìn thấy | Tại sao ở vị trí này? |
| --- | --- | --- |
| E0 | Chốt hợp đồng hành vi, có môi trường test và baseline | Không thể sửa đúng nếu hai bên hiểu khác nhau về stop, lease và kết quả |
| E1 | Lease cũ không thắng lease mới; purge không làm mất outbox | Bảo vệ dữ liệu trước khi thêm nhiều nút điều khiển từ xa |
| E2 | Agent đăng ký bằng key, server kiểm soát identity/quyền | Đặc tả mới yêu cầu; lệnh phá hủy không được mở công khai |
| E3 | Command bền vững, pause/resume, emergency stop, cancel/purge an toàn | Có thể quản trị agent kể cả lúc mất mạng |
| E4 | Retry/DLQ, worker recovery, dashboard vận hành tối thiểu | Hoàn thành MVP có thể quan sát, phục hồi và nghiệm thu |
| E5 | Config version, drain, self-test, update/rollback có kiểm chứng | Chỉ cập nhật từ xa khi đã biết dừng và bảo toàn dữ liệu |
| E6 | Groups, scheduler, fleet circuit breaker, thử tải | Tối ưu sau khi correctness và khả năng phục hồi đã ổn |

**Bắt đầu bằng Task 01 trong checklist: kiểm chứng hành vi lease hiện tại, chưa sửa runtime.** Sau mỗi task: assistant test → người dùng test/xem bằng chứng → người dùng xác nhận đạt và cho chuyển task tiếp theo. Không tự làm song song task khác trong lúc chờ duyệt. Các nhóm E0–E6 là cổng nghiệm thu, không phải yêu cầu làm cả nhóm trong một lần.

Đây là kế hoạch theo rủi ro, không phải lịch cam kết theo ngày. Chốt thời lượng sau E0 dựa trên số người, baseline test và máy nghiệm thu thực tế.

## 2. Kiến trúc giữ nguyên

```text
Browser quản trị / Agent trên máy crawler
                  |
                  | HTTPS / WSS, kết nối do client/agent khởi tạo
                  v
             client / Nginx
                  |
                  v
      server / Coordinator :8766
        - đăng ký và xác thực agent
        - scheduler / lease / result
        - command / config / audit
                  |
                  v
       database / PostgreSQL 17

Agent bên ngoài VPS:
control loop + execution workers + SQLite outbox + watchdog
```

- Production vẫn đúng ba container `client`, `server`, `database`.
- “Control Server” trong đặc tả là vai trò của Coordinator hiện có, **không phải container hoặc backend thứ năm**.
- Gateway, Pinterest và Pipeline Worker tiếp tục nằm trong `server` như thiết kế hiện tại.
- Agent là ứng dụng chạy ở máy crawler bên ngoài VPS; SQLite của agent là vùng đệm cục bộ hợp lệ, không phải database production phía server thứ hai.
- Không thêm Redis, message broker hoặc database container chỉ để làm command queue; dùng PostgreSQL trước.
- Browser đi qua Nginx; không mở thêm 8766/3001/5432 ra host.
- Không mở HTTP server trên máy agent; không thêm remote shell hoặc command string tùy ý.
- Lưu ảnh/ZIP/binary trong durable volume; PostgreSQL lưu metadata và đường dẫn.

### Các phần ngoài phạm vi nâng cấp mặc định

**Làm rõ PostgreSQL/SQLite:** kiểm tra read-only Docker local ngày 04/10/2026 xác nhận Coordinator kết nối PostgreSQL và có các bảng crawl/task/attempt/result; entrypoint `scripts/coordinator_app.py` bắt buộc PostgreSQL và truyền cùng kết nối cho Review Studio. SQLite `agent.sqlite3` thuộc máy agent, đúng yêu cầu local queue ở mục 16–17 của spec. Không có task chuyển agent sang PostgreSQL hoặc migrate lại server chỉ vì source còn nhắc SQLite. Kiểm tra này không chứng minh toàn bộ dữ liệu lịch sử trên VPS đã được migrate.

- Không viết lại parser Amazon, đổi Shopify Sync/SEO hoặc đổi cách tạo ảnh Review Studio.
- Không thay extension + tab ChatGPT bằng API tạo ảnh.
- Không tạo lại Product Crawler độc lập. Kiểm tra route legacy trong regression; nếu cần nâng cấp nghiệp vụ riêng thì tạo task khác.
- Không đổi cách deploy ba container, không tự triển khai VPS hoặc publish release trong một task viết code.
- Không coi “có heartbeat” là đã chứng minh xử lý được 500 agent.

## 3. Hiện trạng có bằng chứng trong repository

Quy ước: **Có nền** = tìm thấy implementation/test liên quan, không có nghĩa đã nghiệm thu theo đặc tả mới. **Khác hợp đồng** = code cũ có chủ đích nhưng không đáp ứng hành vi mới. **Cần bổ sung** = chưa thấy cơ chế tương đương đầy đủ trong phần source đã rà soát.

| Năng lực | Hiện trạng | Bằng chứng / việc cần làm |
| --- | --- | --- |
| Identity giữ qua restart | Có nền, khác nơi cấp ID | `ClientStore.client_id()` tạo UUID tại máy và lưu SQLite; spec muốn server cấp ID sau xác thực |
| Kết nối từ agent ra server | Có nền | `_connection_supervisor()` mở outbound WebSocket; `hello`/`ready` cung cấp slots |
| Agent Key / enrollment | Cần bổ sung | `worker_socket()` kiểm tra protocol, capability và clientId; chưa có Agent Key trong flow này |
| Heartbeat/offline | Có nền | `protocol.py`: heartbeat 10s, offline 30s, lease cơ sở 60s; không phải bộ 15–30s/60s trong spec |
| Lease cạnh tranh | Có nền | `lease_tasks()` dùng PostgreSQL `FOR UPDATE ... SKIP LOCKED`, capacity và capability |
| Fencing lease cũ | **Khác hợp đồng quan trọng** | `accept_result()` kiểm tra attempt từng được cấp; test hiện tại cho lease cũ thắng sau reassignment |
| Product streaming | Có nền, cần áp cùng fencing | `accept_product()` cũng dùng attempt lịch sử; không chỉ sửa endpoint final result |
| SQLite outbox | Có nền | `leases`, `pending_results`, `pending_products`, WAL và `synchronous=FULL` trong `client_store.py` |
| Purge giữ kết quả | **Khác hợp đồng quan trọng** | `discard_task()`, `discard_job()`, `clear_orphaned_jobs()` xóa cả pending results/products |
| ACK/upload retry | Có nền | `_upload_loop()` retry; nhận `accepted`, `duplicate`, `cancelled` có thể xóa spool |
| Idempotent result | Có nền, chưa đúng hợp đồng result_id mới | `TaskResult` khóa chính task_id; outbox final cũng khóa task_id; cần kiểm checksum và phân biệt từng attempt |
| Reconcile khi reconnect | Có nền | `reconcile_tasks()` trả resume/discard/cancel; một số đường gọi discard dẫn đến xóa outbox |
| Hủy job và ACK cleanup | Có nền | `cancel_job`, `acknowledge_task_cancel`, `JobStopClientCleanup`, cancel intents và generation |
| Generic durable commands | Cần bổ sung | Cơ chế cancel/cache generation hiện tại không thay thế ledger cho toàn bộ typed commands |
| Retry phân loại/cooldown | Có nền | Audit retry và các test retry-after, CAPTCHA cooldown, partial retry, finite failures |
| Attempt history | Có nền | `TaskAttempt`; cần chuẩn hóa version/error/attempt number và retention phù hợp |
| DLQ thao tác quản trị | Cần bổ sung/đối chiếu | Có terminal failed và retry_failed; không nên coi đó là DLQ đầy đủ |
| Worker riêng có thể kill/restart | Chưa đủ bằng chứng | Execution hiện gọi batch qua `asyncio.to_thread`; không thể mặc định coi là process pool có watchdog độc lập |
| UI/telemetry agent | Có nền | Endpoint clients, dashboard agent, telemetry spool và audit observability |
| Versioned config và ACK áp dụng | Cần bổ sung | Có limits/settings fingerprint; khác với config version, validate, rollback và applied status |
| Update/rollback | Có công việc ở nhánh khác | `feature/tooling-add-agent-self-update` có release/updater/tests; chưa coi là đã có trên baseline này |

### 3.1. Hai khác biệt bắt buộc chốt trước khi sửa

**Lease:** test `test_first_valid_result_wins_after_expired_task_is_reassigned` trong `engine/tests/test_distributed.py` tạo lease A, cho hết hạn, cấp B, rồi kỳ vọng kết quả A được accepted và B duplicate. Đây là chủ đích của code hiện tại. Spec mục 15 yêu cầu lease A không còn quyền khi B đã nhận task. Cần thay cả contract, test, result upload, product streaming và reconcile; không chỉ thêm một điều kiện ở một API.

**Purge:** tài liệu `docs/amazon-crawler-stop-cache-audit.md` mô tả Stop bỏ spool của job bị hủy, nhưng giữ cache sản phẩm. Spec mới yêu cầu queue task và queue result tách biệt, purge không tự xóa pending results. Cần phân biệt **cache có thể tái tạo**, **assignment có thể cấp lại**, **kết quả chưa được xác nhận**, **asset mà kết quả đang tham chiếu**.

Các khác biệt này là thay đổi chính sách so với hành vi cũ, không nên gọi tất cả là “bug cũ”.

### 3.2. Cẩn thận với kết luận từ test cũ

- Có test trong source không đồng nghĩa test vừa chạy thành công.
- Test PostgreSQL có thể skip nếu thiếu `TEST_AMAZON_COORDINATOR_DATABASE_URL`.
- SQLite test không chứng minh được row locking hoặc cạnh tranh transaction của PostgreSQL.
- Báo cáo audit cũ là bằng chứng lịch sử, không thay fresh output trên commit triển khai mới.
- Lần lập kế hoạch này không chạy chaos test, build hoặc test ứng dụng; chưa đưa ra kết luận nghiệm thu runtime.

## 4. Quyết định cần duyệt ở E0

| ID | Câu hỏi | Đề xuất | Hệ quả nếu chưa chốt |
| --- | --- | --- | --- |
| D1 | Bỏ ngoại lệ agent công khai không xác thực trước đây để áp dụng Agent Key? | Có; chuyển có kiểm soát, đích cuối bắt buộc xác thực | E2 không thể bật production đúng spec nếu vẫn giữ ngoại lệ cũ |
| D2 | Chuyển từ first-result-wins sang current-lease-only? | Có; stale result giữ ở quarantine, không vào pipeline | Chặn thay đổi semantics E1.1 |
| D3 | Stop/purge có giữ kết quả chưa gửi của job bị hủy? | Có; không publish lại job đã hủy; giữ/quarantine để audit hoặc phục hồi có duyệt | Chặn retention và E1.2/E3 purge |
| D4 | Giữ outbound WSS hay bắt buộc HTTP pull? | Giữ WSS trước; request lease/ready phải do agent chủ động, server vẫn quyết định | Tránh đổi transport và nghiệp vụ cùng lúc; HTTP có thể là adapter sau |
| D5 | Agent được tự hủy toàn bộ job như cancel intent hiện tại không? | Mặc định không; agent chỉ trả/cancel lease của chính nó, admin mới hủy job | Phải cập nhật tray/local stop và quyền server |
| D6 | Một key cho một máy hay chia sẻ nhiều máy? | Một key bind một identity; rotate/rebind có audit | Tránh máy copy config giả danh cùng agent |
| D7 | Global stop là chỉ crawler hay cả SEO/Shopify downstream? | Ban đầu chỉ admissions/execution crawler; downstream là scope riêng rõ ràng | Không hứa hủy được Shopify write đã gửi |
| D8 | Job STOPPED có resume hay CANCELLED là vĩnh viễn? | PAUSED resume; CANCELLED terminal; STOPPED chỉ có nghĩa riêng nếu product cần | Tránh dùng nhiều tên cho cùng một trạng thái |
| D9 | Bao lâu giữ quarantined results, audit và attempts? | Đặt retention/quota rõ trước launch; không auto xóa kết quả chưa ACK | Cần dung lượng đĩa và quy trình xử lý đầy đĩa |
| D10 | Windows là platform chính; có máy sạch, chứng thư ký và người phụ trách updater? | Windows trước, không tuyên bố Linux/macOS production | Chặn nghiệm thu installer/update thật |

Thông tin đã có từ trao đổi trước: GitHub Releases dự kiến tại `https://github.com/tuan03/ffp_tool/releases`; lúc đó chưa có máy Windows sạch/VM. Cần xác nhận lại tình trạng hiện tại. Không yêu cầu gửi token, private key hoặc mật khẩu vào chat.

Quyết định bổ sung trong workshop E0:

- Chuẩn hóa `DRAINED` và `NEED_REAUTH`: spec dùng nhưng không liệt kê đầy đủ trong bảng trạng thái.
- Tách connectivity (`online/offline`), desired mode (`running/paused/draining/stopped`) và health (`healthy/degraded/unhealthy`) để heartbeat không vô tình xóa trạng thái PAUSED.
- Revoke và emergency stop ưu tiên cao nhưng không được làm mất các command có sequence thấp chưa xử lý.
- Khi server mất mạng, chạy xong task đang chạy theo policy; không tự bắt đầu thêm task đã xếp hàng nếu chưa được cho phép.
- Khi lease hết hạn mà chưa cấp lại, chọn rule rõ. Đề xuất server phải reconcile/cấp quyền hợp lệ trước khi nhận; không tự hồi sinh lease cũ từ local payload.

## 5. Hợp đồng an toàn dùng xuyên suốt

### 5.1. Task, lease, attempt và result là các định danh khác nhau

- `task_id`: đơn vị công việc logic.
- `attempt_id`: một lần thực thi; giữ lịch sử và version đã chạy.
- `lease_id`/token: quyền có hạn của agent cho attempt hiện tại; không phải credential thay Agent Key.
- `result_id`: định danh upload ổn định qua mọi lần retry của cùng một kết quả.
- Result receipt: xác nhận bền vững của server, có checksum và disposition.

Khi nhận result mới, server xác thực agent, quyền, task/attempt/lease hiện tại, trạng thái job và checksum. Chỉ ACK sau transaction commit. Nếu result đã commit và agent gửi lại vì mất ACK, trả receipt cũ khi identity và checksum khớp; không bắt chạy lại chỉ vì lease đã kết thúc.

Không gọi mọi duplicate là thành công: cùng result_id nhưng khác nội dung phải trả conflict, lưu audit và không ghi đè. Streaming products cũng phải tuân thủ cùng quy tắc; sản phẩm A gửi sau khi mất lease không được kích hoạt SEO/Shopify.

Đảm bảo thực tế là **có thể chạy/gửi lại, nhưng chỉ chấp nhận tác động hợp lệ một lần theo khóa idempotency**. Không hứa “mỗi task chỉ chạy đúng một lần” trong mọi trường hợp mạng phân vùng.

### 5.2. Không xóa nhầm outbox

Tách API local theo trách nhiệm:

- Gỡ pending assignment.
- Yêu cầu cancel running worker.
- Lưu kết quả và file tham chiếu bền vững.
- ACK đúng result/receipt.
- Quarantine kết quả stale/cancelled/không còn job.
- Xóa kết quả theo retention hoặc thao tác riêng có xác nhận và audit.

Không dùng lại helper “discard toàn bộ task” cho các trường hợp trên. Cần migrate cả final results và `pending_products`; không bỏ quên streaming hoặc binary liên quan.

Khi disk gần đầy: cảnh báo và ngừng nhận task mới. Khi không lưu được result: không báo SUCCESS. Việc người dùng xóa database/ổ đĩa hỏng ngoài mô hình durability phải được ghi rõ, không hứa chống mọi mất dữ liệu vật lý.

### 5.3. Command không chỉ là một WebSocket message

Server lưu command trước khi gửi. Agent lưu command ID và tiến độ trước side effect. ACK nhận lệnh khác ACK hoàn thành. Server restart/agent restart không làm mất lệnh hoặc chạy lại side effect phá hủy.

Sequence dùng để phát hiện thiếu và resume, không đơn giản gán `last_processed_seq = max(received)`. Nếu seq 12 emergency được xử lý trước seq 11 config, seq 11 vẫn phải được giải quyết hoặc đánh dấu superseded có căn cứ. Dùng ledger ID + contiguous cursor/gap tracking.

`RESTART_AGENT` cần boot mới xác nhận completion; không thể chỉ tự trả SUCCESS trước khi tiến trình cũ thoát. Lệnh hết hạn không được tự chạy lại sau nhiều ngày offline. TTL của command không tự xóa desired global stop trong PostgreSQL.

### 5.4. Global stop và command phải chặn tại server

Ghi global admission gate vào PostgreSQL; kiểm tra trong đường cấp lease với chiến lược transaction/locking rõ. Chỉ broadcast stop là chưa đủ.

Định nghĩa mốc: sau khi stop commit, không transaction cấp lease mới nào được commit ngoài quy tắc đã chốt. Lease cấp trước mốc thuộc running/pending cancellation và phải được thống kê. Test race cần barrier có kiểm soát, không chỉ chạy tuần tự.

Mạng bị cắt thì không thể hứa agent dừng tức thì. Server ngừng cấp quyền ngay; agent offline xử lý theo policy và nhận lệnh khi reconnect. UI phải báo “đã yêu cầu, chưa xác nhận” thay vì giả vờ mọi máy đã dừng.

## 6. E0 — baseline, contract và môi trường thử

### E0.1. Lập baseline có thể lặp lại

**Phạm vi:** tài liệu, test harness, cấu hình test không secret. Không thay runtime production.

1. Chốt commit baseline và danh sách agent/protocol đang dùng.
2. Chạy test hiện có, tách PASS/FAIL/SKIP; ghi lỗi có sẵn riêng.
3. Tạo hai agent giả A/B với SQLite và identity riêng, nguồn crawl fixture không dùng Amazon thật.
4. Dùng PostgreSQL test biệt lập; không trỏ test vào database VPS hoặc local đang có job thật.
5. Ghi test transcript của lease/reassign, result retry, job cancel, reconnect.
6. Liệt kê consumers chung: Amazon, Amazon Reviews, Pinterest, Review Studio, Pipeline Worker.

**Đạt khi:** người thứ hai tái hiện được cùng scenario bằng hướng dẫn, biết chính xác DB/thư mục nào là test, không tác động store thật.

### E0.2. Chốt state machine và compatibility

Viết transition table cho task/job/agent/command, response error/disposition, rule timeout, map tên trạng thái cũ sang mới. Không đổi hàng loạt string trong DB trước khi có adapter/migration.

Chốt quyết định liên quan trước từng task: D2 trước sửa lease, D3 trước đổi outbox/purge, D1/D5/D6 trước auth, D7/D8 trước remote stop. Không bắt trả lời toàn bộ D1–D8 để chạy bài kiểm chứng hiện trạng Task 01. Định nghĩa minimum protocol/capabilities và cách xử lý agent cũ trước thay contract tương ứng; không tự giả định tăng từ 5 thành một số cụ thể là đủ tương thích.

### E0.3. Rà soát updater đang làm

Nhánh `feature/tooling-add-agent-self-update` có các commit `02f6957`, `1f4fcbe`, `ed3e7fd` chưa nằm trong baseline. Cần hỏi owner về phạm vi và lịch merge; rà diff chính xác từ commit liên quan. Git báo nhiều merge base khi so sánh ba chấm, nên không lấy nguyên diff tổng làm danh sách tính năng còn thiếu.

Không tự merge/cherry-pick trong task kế hoạch. Đối chiếu với topology ba container: mọi script riêng triển khai Coordinator phải được review, không đưa topology cũ quay lại.

**Cổng G0:** baseline được ghi nhận, contract đã duyệt, scope auth rõ, test DB biệt lập sẵn sàng.

## 7. E1 — bảo vệ dữ liệu trước khi mở rộng remote control

### E1.1. Current-lease fencing

**Phạm vi:** Coordinator store/server/models nếu cần, protocol và test. Đây là thay đổi semantics có phối hợp agent.

- Thay test first-result-wins bằng bộ test current-lease-only theo D2.
- Check ownership/lease/expiry tại result, product streaming, progress, fail, renew và cancellation ACK; không để API phụ hồi sinh lease cũ.
- Reconcile không nhận ID/token tùy ý từ agent rồi gán lại vào task đang queued.
- Xác định transaction ordering giữa reaper, accept result, cancel và reassignment.
- Giữ receipt cho kết quả đã commit để duplicate upload vẫn idempotent.

**Test bắt buộc:** A hết lease, B nhận; A gửi product/final/fail/heartbeat muộn; không tác động lease hoặc result của B. B hoàn thành; duplicate cùng checksum trả receipt; checksum khác bị reject. Test tương tự dưới PostgreSQL cạnh tranh thật.

**Không làm chung:** generic commands, updater, UI redesign, parser refactor.

### E1.2. Tách task queue và result outbox

**Phạm vi:** client_store/client_agent, schema SQLite có version, test recovery.

- Migrate spool hiện có không mất row; backup local DB trước migration đáng kể.
- Result ID độc lập với task ID để attempt mới không đè result cũ.
- Purge assignment/cancel không tự xóa result; stale/cancelled chuyển quarantine với lý do.
- Giữ asset đến khi receipt/retention cho phép xóa; dọn cache không xóa file outbox còn tham chiếu.
- Server ACK bền vững rồi local mới delete đúng result. Mất ACK chỉ retry upload.
- Add backpressure theo dung lượng/count/tuổi outbox; policy khi disk full.

**Test bắt buộc:** pending_products + pending_results tồn tại qua stop, purge, restart; crash trước/sau commit local; server commit rồi mất ACK; DB migration chạy lại; disk full không trả SUCCESS.

### E1.3. Reconnect/reconcile đúng thứ tự

Thứ tự: load identity/DB → auth/compatibility → nhận control gate/commands → reconcile assignments và results → xử lý upload/receipt → health/capacity → được phép xin task mới.

Không bắt buộc upload sạch toàn bộ outbox mới chạy lại nếu có cơ chế quota an toàn, nhưng phải **phân loại được backlog và đóng admission khi quá ngưỡng**. Pending emergency/purge phải xử lý trước admission.

Server offline: không claim mới, chạy dở theo policy, lưu kết quả, reconnect backoff có jitter. Agent crash: không gọi việc mở lại browser từ đầu là “resume chính xác” nếu chưa có checkpoint tương ứng; server quyết định restart attempt, resume checkpoint hoặc quarantine.

**Cổng G1:** hai agent mất mạng/restart/đổi lease không làm mất outbox hoặc chấp nhận stale result; artifacts và DB counts đối chiếu được. Đây là thời điểm demo đầu tiên cho người dùng.

## 8. E2 — enrollment, Agent Key và quyền

### E2.1. Server identity và key lifecycle

- Key entropy cao; hiển thị raw một lần, DB lưu verifier/hash và metadata, không log raw.
- Register idempotent khi response bị mất: retry không sinh identity vô hạn.
- Key bind identity, status/expiry/permission/max_workers được server kiểm tra.
- Hỗ trợ revoke/rotate/rebind có audit; không tin clientId tự khai để nhận quyền máy khác.
- Map identity cũ sang server identity theo migration được duyệt; không dùng clientId cũ làm bằng chứng sở hữu.
- Khi copy SQLite/config sang máy khác: không để cả hai máy chạy đồng thời cùng identity mà không phát hiện.

### E2.2. Agent enrollment và secret storage

Setup chính: Server URL + Agent Key. URL production HTTPS; không chèn token vào query string, log hoặc command line/history.

Windows lưu credential trong cơ chế OS phù hợp user chạy agent; identity metadata không secret có thể lưu file. Phải chọn một nguồn identity chính thức, không để JSON và SQLite lệch nhau. Export backup không kèm raw credential mặc định.

Không tự đưa credential Shopify/proxy/Google vào agent package. Agent Key không thay thế `SHOPIFY_PIPELINE_TOKEN` hoặc Review Image extension token.

### E2.3. Auth bao phủ mọi đường và tách quyền operator

- Bảo vệ HTTP upload, WSS handshake/session, heartbeat, lease, command ACK và asset endpoints thuộc agent.
- Key revoke kiểm tra lại trên session đang mở, không chỉ lần handshake; đóng admission và ngắt session theo policy.
- Key A không sửa task/client B, không dùng admin API.
- Operator tạo/revoke key, global stop, purge phải có operator authorization. Không dùng agent credential làm admin credential.
- Auth error giữ outbox, chuyển NEED_REAUTH; không retry authentication lỗi với tốc độ cao.
- Kiểm tra Nginx allowlist cho route mới; không làm `/api/v1/internal/*` bị lộ qua regex rộng.

**Test/demo:** register một máy, restart giữ ID; key sai/hết hạn/revoked bị từ chối; rotate giữ identity; revoke khi đang WSS; A không giả danh B; token không xuất hiện trong log/bundle; outbox không mất khi auth thất bại.

**Cổng G2:** admin và agent được phân quyền thật qua public Nginx URL. Đóng compatibility window agent không auth trước khi tuyên bố đạt yêu cầu bảo mật của spec.

## 9. E3 — remote control, chia nhỏ theo mức phá hủy

### E3.1. Command ledger + PAUSE/RESUME

Đây là lát cắt đầu tiên xuyên server → agent → UI:

1. Server tạo command và audit trong transaction.
2. UI hiện PENDING, không đổi trạng thái thành công ngay khi POST trả 200.
3. Agent persist/ACK, thực hiện desired mode, báo terminal result.
4. Restart hoặc reconnect vẫn thấy cùng command ID; không nhân đôi tác động.

Đưa heartbeat desired/applied mode vào UI; PAUSE ngừng nhận task, task đang chạy có thể kết thúc. RESUME không được vượt global stop, revoke hoặc unhealthy gate.

### E3.2. Emergency/global stop

- Persist admission gate, scope và người yêu cầu trước broadcast.
- Phân biệt soft/hard; đối với hard, cancel event rồi escalate worker được sở hữu sau grace period.
- Offline agents được liệt kê là pending confirmation, nhận state trước lease khi reconnect.
- Resume là thao tác có quyền riêng; không tự resume khi server restart hoặc circuit breaker đóng.

### E3.3. CANCEL_JOB / CANCEL_TASK

- Đồng bộ với job control đã có, không xây hai cancellation engine song song.
- Task queued ngừng cấp; running có receipt/timeout; result muộn không làm sống lại job.
- Task cancel không hủy task khác chung batch. Nếu execution hiện chỉ có cancel theo batch/job, task này cần phối hợp worker isolation E4.2 hoặc giữ phạm vi MVP rõ ràng.
- Downstream đang Shopify write phải báo giới hạn; hủy crawl không thể thu hồi một external write đã thực hiện.

### E3.4. PURGE_PENDING_TASKS / PURGE_ALL_LOCAL_TASKS

Chỉ làm sau E1.2. Định nghĩa payload scope, include_running, dry-run/count và confirmation.

- Pending purge không xóa running/outbox.
- Purge all đóng admission, cancel theo lựa chọn, đối chiếu server rồi gỡ assignment.
- Kết quả stale/cancelled giữ quarantine; xóa result là thao tác khác.
- Lệnh gửi lúc offline vẫn chạy trước lease mới; lặp command không xóa thêm ngoài scope.
- Audit ghi actor, reason, scope, counts, result; không chứa raw result/secret.

**Cổng G3:** lần lượt demo pause/resume → global stop → cancel → purge trên hai agent; mỗi tính năng có test mất mạng, server restart và agent restart. Không merge một PR lớn chứa toàn bộ nút mà chỉ test happy path.

## 10. E4 — đóng MVP: retry, DLQ, worker recovery, giao diện tối thiểu

### E4.1. Chuẩn hóa lỗi, retry và DLQ

Tận dụng retry/cooldown hiện tại; map các lỗi sang taxonomy mục 36 thay vì tạo retry loop thứ hai.

- Tách lỗi crawl và lỗi delivery; upload fail không tăng số lần crawl.
- `retry_count`, `next_retry_at`, giới hạn attempts phải bền vững; restart không reset budget.
- Lease expiry không nhất thiết là lỗi parser; lưu nguyên nhân riêng.
- DLQ là trạng thái/queue quản trị có reason, attempts và quyền requeue, không chỉ tên khác của failed.
- Requeue tạo attempt mới, giữ lịch sử; bulk retry có bộ lọc, giới hạn và xác nhận.
- Thu thập agent/parser/crawler/config version tại thời điểm attempt, không lấy version hiện tại khi xem lịch sử.
- Không cascade-delete lịch sử cần audit chỉ vì operator dọn job; chốt retention/archive và tham chiếu tombstone.

**Test:** lỗi vĩnh viễn không retry vô hạn; 429 giữ Retry-After; retry restart vẫn đúng lịch; DLQ requeue không duplicate pipeline; attempt history không mất sau cleanup hợp lệ.

### E4.2. Worker isolation + watchdog

Đây có thể là task khó nhất về agent, không xem như “thêm một vòng while”. Source hiện gọi batch qua thread; Python thread bị treo không thể được hard-kill an toàn như child process.

Trước tiên kiểm tra executor/browser process ownership; nếu cần, đưa execution vào child process **trên máy agent**, không thêm container VPS. Control loop và SQLite writer cần sống độc lập với worker.

- IPC typed, không truyền toàn bộ runtime object không serializable qua Windows spawn.
- Task cancellation riêng; graceful cancel trước, kill đúng process tree đã sở hữu sau timeout.
- Không `taskkill` toàn bộ Chrome trên máy; không đóng tab ChatGPT/extension của người dùng.
- Crash một worker không làm chết control plane hoặc mất outbox worker khác.
- Rate limit restart; crash storm → DEGRADED/UNHEALTHY, giảm/ngừng admission, không reset agent liên tục.
- CAPTCHA/manual browser flow vẫn hoạt động; kiểm tra tương tác tray và profile lock.

**Test:** kill worker, browser hang, parent restart, IPC lỗi, SQLite busy, nhiều worker dùng riêng profile; phải chạy cả Windows thật vì fixture Linux không chứng minh Windows spawn/process tree.

### E4.3. UI vận hành MVP

Làm phần UI nhỏ đi kèm từng đợt, tới đây hoàn thiện:

- Danh sách agent: connectivity, desired/applied mode, health, last_seen, version, slots, pending uploads.
- Chi tiết: task hiện tại, attempts/errors, command timeline/ACK, key metadata không raw secret.
- Nút thao tác có quyền, confirmation và feedback pending/partial/timeout.
- Job view: queued/running/retry/DLQ/cancelled; không gộp upload backlog vào đang crawl.
- Hiển thị offline là “không liên lạc”, không khẳng định process đã chết.
- Pagination/filter cho histories; không polling full payload tăng vô hạn.

**Cổng G4 = MVP:** toàn bộ mục 53 được trace tới test; scenario 20-agent ở mục 15 đạt. Nếu worker recovery chưa đạt, ghi MVP chưa hoàn thành thay vì chuyển âm thầm sang V2.

## 11. E5 — config, drain và cập nhật agent

### E5.1. Versioned config

Config validate trước apply, có requested/applied version, ACK và last-known-good. Cho phép thay concurrency theo cách không cắt ngang worker trái policy. Secret không trộn vào config thông thường.

Heartbeat/lease/retry settings phải có ràng buộc với nhau. Không đổi 10/30/60 sang số spec chỉ vì giống tài liệu; chạy fault test với latency thực tế rồi chốt budget.

Config cơ bản/capacity validation phải có từ E2–E3; phần V2 ở đây là quản trị version, rollout và rollback hoàn chỉnh.

### E5.2. DRAIN và SELF_TEST

Drain: khóa admission, đợi running về 0, xử lý outbox theo policy, báo DRAINED. Timeout không được tự purge. Self-test kiểm network/auth/local DB/disk/runtime/parser/worker spawn/serialize, không tạo Shopify write hoặc job Amazon thật mặc định.

### E5.3. Tích hợp updater hiện có

- Review/reuse nhánh updater, xác định những phần đã đáp ứng checksum/signature/rollback và phần chưa có command-driven rollout.
- Release manifest chứa version/protocol constraints/hash/signature metadata; agent validate trước thay binary.
- Chặn downgrade trái policy, file sai hash/signer, partial download và thiếu dung lượng.
- Giữ credential/identity/profiles/SQLite/outbox qua upgrade.
- Rollback binary phải tương thích schema local; migration không tương thích cần backup + recovery plan, không chỉ đổi executable cũ.
- Update journal sống qua reboot; agent mới self-test/reconnect rồi server mới ghi SUCCESS.
- Canary từ nhóm nhỏ, giám sát rồi tăng; 10/50/100% là policy cần phê duyệt, không auto launch mặc định.

**Cổng G5:** bản signed thật trên Windows sạch, update/rollback qua public URL, không Git/Python/Chromium cài sẵn; không mất identity/outbox. Chưa có chứng thư hoặc máy sạch thì ghi blocked nghiệm thu, không đánh dấu đạt bằng unit test.

## 12. E6 — fleet scheduling và scale

- Groups/allowed crawler được server enforce, không chỉ filter UI.
- Scheduler cân bằng capacity, health, affinity; tránh starvation, giữ fairness khi agent nhanh/chậm khác nhau.
- Quan sát query `lease_tasks()` hiện lấy các task queued phù hợp rồi lọc tiếp trong Python; chỉ tối ưu sau đo queue size/query latency, không benchmark 500 agents bằng suy đoán.
- Auto concurrency có min/max, hysteresis và thời gian giữ, không dao động theo mỗi heartbeat.
- Fleet circuit breaker theo crawler/parser version/error family, khác với circuit của AI/SEO provider.
- Có minimum sample, cửa sổ thời gian, OPEN/HALF_OPEN/CLOSED và số probe hữu hạn; ngưỡng 30% trong spec là ví dụ cần hiệu chỉnh.
- Admin pause/emergency/revoke luôn thắng auto-recovery; circuit đóng không tự resume global stop.
- Metrics: lease latency, throughput, P95 duration, retry/DLQ, outbox age/bytes, stale rejections, command ACK latency, DB pool, CPU/RAM/disk.
- Không đưa agentId/taskId tùy ý vào mọi metrics label; trace/log chi tiết riêng để tránh cardinality tăng vô hạn.

**Cổng G6:** báo cáo tải 20 → 50 → 100 và các mức tiếp theo theo tài nguyên, có bottleneck/profile và p95/p99; chỉ công bố 500 khi đã test đúng workload. Không cần đợi 500 mới có thể ra MVP 20-agent ổn định.

## 13. Danh mục giao việc nhỏ và phụ thuộc

Mỗi hàng là một lát cắt có thể review/demo. Nếu diff lớn, chia test/schema/service/UI thành các commit tương thích; không để một commit trung gian bật endpoint phá hủy chưa có auth.

| Ticket | Phạm vi chính | Phụ thuộc | Bằng chứng bàn giao |
| --- | --- | --- | --- |
| E0.1 | Baseline, fixture agents, test DB | Không | Transcript và danh sách PASS/FAIL/SKIP |
| E0.2 | State/transport/security decisions | E0.1 | Transition/compatibility contract được duyệt |
| E0.3 | Rà updater và owner | Không | Reuse/gap list; không merge tự động |
| E1.1 | Lease fencing mọi mutation | E0.2, D2 | Race A/B + streaming/final tests |
| E1.2 | Outbox/quarantine/SQLite migration | E0.2, D3 | Crash/ACK-loss/purge giữ rows |
| E1.3 | Startup/reconnect admission | E1.1–E1.2 | Offline/restart demo |
| E2.1 | Keys, server IDs, admin authorization/audit nền | D1/D5/D6 | Register/revoke/rotate tests |
| E2.2 | Enrollment UI + OS secret storage | E2.1 | Máy restart giữ identity, không lộ key |
| E2.3 | HTTP/WSS enforcement + compatibility | E1.3, E2.1–E2.2 | Public URL negative auth tests |
| E3.1 | Command ledger + pause/resume UI | E2.3 | Duplicate/out-of-order/restart tests |
| E3.2 | Global stop gate | E3.1 | Race stop/lease + offline agents |
| E3.3 | Cancel task/job + local action permissions | E3.1, E1; E4.2 nếu cần isolation | Cancel scope/late result tests |
| E3.4 | Purge có scope/confirmation | E1.2, E3.1 | Outbox/asset preservation |
| E4.1 | Retry taxonomy/attempt/DLQ | E1 | Retry budget và DLQ demo |
| E4.2 | Worker isolation/watchdog | E1.2, contract E3.3 | Windows crash/hang recovery |
| E4.3 | UI MVP và acceptance | E2–E4 | 20-agent report và regression |
| E5.1 | Config versions | E3.1 | Invalid config giữ last good |
| E5.2 | Drain/self-test | E4.2, E5.1 | Drain timeout/restart tests |
| E5.3 | Signed update/rollback integration | E0.3, E5.2 | Clean-machine release rehearsal |
| E6 | Groups/scheduler/breaker/load | G4; phần rollout cần G5 | Measured scale report |

Các hàng trên là nhóm kỹ thuật; thứ tự thực thi nhỏ nằm trong checklist đi kèm. Không thực hiện song song khi người dùng yêu cầu duyệt từng task. E3.3 cần task-level worker cancel; checklist đưa kiểm tra/isolation worker trước hard stop và cancel task. Nếu phát hiện phụ thuộc mới, trình điều chỉnh thứ tự trước, không tự mở rộng task đang làm.

### Mẫu giao một task cụ thể

```text
Task: E1.1 — Current-lease fencing
Baseline: commit được chốt sau E0; làm trên cua_pro theo chỉ định hiện tại.
Allowed scope: Coordinator store/server, protocol, engine tests; model/migration chỉ khi cần.
Không sửa: parser, Shopify/SEO business logic, AGENTS.md, deployment topology, secrets.
Contract: bỏ first-result-wins cho result chưa commit; duplicate đã commit dùng receipt.
Acceptance: A stale không mutate task/product; B hợp lệ; ACK retry idempotent.
Test: deterministic unit + PostgreSQL race + HTTP streaming/final integration.
Handoff: files, contract changes, fresh PASS/FAIL/SKIP, rollback/compatibility notes.
Không deploy/push hoặc thử phá job thật nếu chưa được yêu cầu.
```

Thực hiện hiện tại trên `cua_pro` theo chỉ định người dùng, là ngoại lệ workflow tạo branch trong AGENTS.md. Không tự tạo nhánh mới hoặc merge/push main. Nếu team muốn mỗi ticket một branch đúng handbook, xin duyệt thay đổi workflow trước.

## 14. Chiến lược test: ít thành phần trước, fault có kiểm soát sau

### Lớp T1 — unit/state machine

Clock, jitter, IO và network được kiểm soát. Test transition hợp lệ/không hợp lệ; permission; checksum; command duplicate/sequence; retry budget. Không dùng sleep dài rồi hy vọng race xảy ra.

### Lớp T2 — persistence

- SQLite file thật trong thư mục test riêng: crash/reopen, migration, outbox transaction và lock contention.
- PostgreSQL thật trong deployment test: concurrent claims, stop/lease race, unique receipt, rollback transaction, restart persistence.
- Chỉ dùng schema test và credential test; test cleanup chỉ được xóa schema/thư mục đã tạo và xác minh đúng phạm vi.
- PG-required CI job thiếu DB phải fail setup, không được báo xanh vì tất cả integration tests skip.

### Lớp T3 — API/protocol với hai fake agents

Đi qua public Nginx path, xác minh WSS headers/auth, HTTP errors là JSON, retry/reconnect và command ordering. Fixture crawl dùng localhost test data, không gọi Amazon/Shopify thật. Hai agent phải có local DB riêng, không chạy hai instance tranh cùng profile.

### Lớp T4 — runtime ba container thật

Deployment test biệt lập vẫn chỉ ba service production. Test driver/agent giả chạy ngoài server container. Verify process supervisor, aggregate readiness, ports và WebSocket sau restart. Không thêm service production thứ tư để thuận tiện test.

### Lớp T5 — Windows agent thật

Máy sạch/VM: install, enrollment, tray, browser/CAPTCHA, worker spawn, profile locks, restart/autostart, update/rollback/uninstall bảo toàn dữ liệu. Windows hiện tại có Python/Git không thay bằng chứng máy sạch.

### Lớp T6 — fault/soak/load

Chỉ trong môi trường test. Cắt network có chủ đích; kill đúng PID; restart test server; giả disk full trên vùng test; inject errors bằng fixture. Không revoke key thật hoặc xóa dữ liệu production để thử tính năng.

### Ma trận regression quan trọng nhất

| ID | Tình huống | Kết quả phải chứng minh |
| --- | --- | --- |
| R01 | Hai agent claim đồng thời | Một active lease hợp lệ/task; capacity không bị vượt |
| R02 | Lease A hết, B nhận, A gửi muộn | A không sửa task/result/product của B |
| R03 | Server commit result, ACK mất | Upload lại trả receipt, không crawl lại/nhân pipeline |
| R04 | Cùng result_id khác checksum | Conflict, không overwrite |
| R05 | Agent chết sau lưu result trước upload | Restart thấy outbox nguyên vẹn |
| R06 | Agent chết trước lưu result | Server recover theo lease; không bịa SUCCESS |
| R07 | Purge pending khi có running + outbox | Chỉ pending assignment bị gỡ |
| R08 | Purge all/offline rồi reconnect | Control xử lý trước lease; outbox/asset giữ đúng policy |
| R09 | Revoke key đang WSS | Không cấp mới, session bị hạn chế; outbox giữ |
| R10 | Agent A giả clientId/task của B | Từ chối, audit an toàn |
| R11 | Duplicate command sau restart | Không lặp side effect |
| R12 | Emergency seq cao tới trước config seq thấp | Không bỏ sót lệnh thấp; stop vẫn thắng |
| R13 | Stop commit đua lease/result | Đúng mốc transaction, không resurrect job |
| R14 | Worker/browser treo | Kill đúng child; worker khác/control loop còn sống |
| R15 | Server offline rồi restart | Global gate/commands còn; reconnect không storm |
| R16 | Retry hết budget | DLQ; không reset budget sau restart |
| R17 | Disk full hoặc SQLite write fail | Ngừng admission/cảnh báo; không ACK giả |
| R18 | Config invalid | Last-good giữ; applied version không tăng giả |
| R19 | Update sai hash/signature | Không chạy file; bản cũ còn dùng được |
| R20 | Binary mới lỗi sau đổi version | Rollback đúng schema/identity/outbox |
| R21 | Amazon Reviews/Pinterest cùng agent | Capability, leases và cancel không cross-job |
| R22 | Coordinator restart có Review Studio | Health/routes/extension bridge vẫn hoạt động |
| R23 | Pipeline nội bộ và public routes | Nội bộ không lộ, token riêng không bị thay bằng Agent Key |
| R24 | Partial-family resume/cache/ZIP | Không mất child đã có, không reuse cache sai phạm vi |
| R25 | Reinstall/copy agent database | Identity bind/rebind theo policy, không giả danh âm thầm |

Các lệnh source gate cho mỗi đợt có code:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

`build:mock` bắt buộc khi đổi mock/runtime; có thể giữ trong CI toàn bộ để phát hiện drift. Chạy thêm focused Python tests phù hợp (distributed, PostgreSQL, retry, agent) và Pinterest regression. E0 phải xác nhận runner/env cụ thể, không copy lệnh test mà thiếu DB rồi coi SKIP là PASS.

## 15. Nghiệm thu MVP 20 agent — kịch bản cụ thể

Chạy simulator trước, sau đó đối chiếu agent thật. **20 process giả không phải bằng chứng 20 máy Windows với browser thật**; báo cáo phải ghi loại agent và tài nguyên.

1. Tạo tập task fixture có ID/checksum biết trước; ví dụ 200 task là dữ liệu test đề xuất, không phải throughput cam kết.
2. Đăng ký 20 identity riêng, đặt capacity và ghi baseline DB/outbox.
3. Đang chạy thì kill 5 agent; chờ expiry/reconcile theo config, không reset DB.
4. Dừng server test rồi khởi động lại; agent còn sống lưu kết quả offline.
5. Kết nối lại tất cả; kiểm receipt, stale result và backlog.
6. Với job khác, yêu cầu cancel lúc đang chạy; chứng minh không cấp task sau cancel gate.
7. Với agent offline có pending/running/result, gửi purge; reconnect, kiểm thứ tự và preserved outbox.
8. Revoke một key đang chạy; kiểm không claim mới, không xóa kết quả.
9. Restart agent và server lần nữa để kiểm trạng thái bền vững, không chỉ session memory.
10. Đối chiếu từng task/attempt/result/receipt/command/audit, không chỉ nhìn counter UI.

Tiêu chí:

- Không mất kết quả đã commit local trong phạm vi lỗi process/network được mô phỏng.
- Không task tồn tại ở trạng thái không thể giải thích hoặc kẹt vô hạn; retry/DLQ/cancel đều có lý do.
- Không stale result tác động pipeline, không duplicate accepted effect theo khóa idempotency.
- Task canceled không tự chạy lại; quarantine không xuất bản kết quả canceled vào job.
- Command có trạng thái cuối hoặc pending có lý do cụ thể; offline không giả SUCCESS.
- Outbox, retry và quarantine counts đối chiếu được; không yêu cầu tất cả bằng 0 nếu policy giữ kết quả bị từ chối.
- Recovery time đo theo heartbeat/lease/retry config cộng processing budget đã chốt; không đặt một số giây vô căn cứ.

Nên chạy lặp nhiều vòng và một soak dài hơn trước production. Thời lượng soak chốt sau E0 dựa workload; không gắn nhãn “ổn định lâu dài” sau một demo vài phút.

## 16. Migration, rollout và rollback

### Migration

- Ưu tiên additive schema và adapter trạng thái; giữ old columns/receipts đến hết compatibility window.
- Không nhân đôi toàn bộ 14 bảng gợi ý nếu models hiện có đã đáp ứng; map logical entities vào schema hiện tại trước.
- Có version migration PostgreSQL và SQLite; test DB mới, DB snapshot cũ, chạy lại và failure giữa chừng.
- Backup có kiểm restore trước thay đổi phá vỡ tương thích; file backup/credential không đưa Git.
- Backfill version/identity/result IDs phải deterministic/idempotent; không giả dữ liệu lịch sử chưa thu thập.
- Quarantine khác accepted result: giữ evidence nhưng không làm scheduler hiểu task đã completed.

### Rollout đề xuất

1. Deploy test server additive schema trước; kiểm agent cũ/mới theo matrix.
2. Test 1 agent mới, rồi 2-agent failure scenarios, rồi 20-agent gate.
3. Canary production chỉ khi người dùng phê duyệt, có cửa sổ và người rollback.
4. Bật Agent Key enforcement sau enrollment đủ các agent được giữ lại; public unauthenticated compatibility nếu có phải giới hạn thời gian/phạm vi rõ.
5. Đóng legacy behavior sau khi outbox cũ đã đối chiếu, không kéo dài hai scheduler/lease policies vô thời hạn.
6. Từng ticket triển khai sau được kiểm regression với phần trước; không merge tất cả rồi mới test cuối.

### Rollback

- Tắt admission trước khi rollback nếu binary/schema/protocol không tương thích.
- Rollback code không nhất thiết rollback database; cần compatibility đã test.
- Không rollback security bằng cách âm thầm mở lại mọi endpoint không auth.
- Không restore DB cũ đè kết quả mới mà chưa có safety backup và đối chiếu receipts/outbox.
- Với agent, giữ local data và journal; update thất bại không uninstall xóa sạch.

## 17. Các điểm cần phối hợp với đồng đội

| Người/phạm vi | Cần phối hợp gì? |
| --- | --- |
| Lead/product | Duyệt semantics auth, lease, purge, stop và retention |
| Coordinator/backend | Transaction fences, migration, scheduler, command ledger, permissions |
| Agent | SQLite migration, OS credential, reconnect, worker/cancel, installer |
| Frontend | Agent/job states, key management, command progress, confirmation |
| Gateway/security | Operator auth và pipeline token boundary, không gộp credential |
| Deployment | Nginx allowlist/WSS, secret injection, test environment, backup |
| Updater owner | Reuse nhánh self-update, ký artifact, release/rollback ownership |
| QA | Fixture, PostgreSQL race, Windows clean machine, chaos/soak evidence |

Đây là đề xuất chia trách nhiệm cho team, không phải chỉ định phải chạy nhiều agent lập trình. Nếu một người làm, vẫn đi theo các ticket nhỏ, mỗi ticket có test/demo và commit riêng.

## 18. Đối chiếu toàn bộ đặc tả để không bỏ sót

| Mục spec | Nội dung | Đợt xử lý |
| --- | --- | --- |
| 1 | Mục tiêu tổng thể | E0, mọi gate |
| 2–5 | Cài đặt, keys, identity, reinstall | E2; E5 installer |
| 6–7 | Status và heartbeat | E0 contract; E2–E4; E5 config |
| 8–10 | Commands, pause/drain/stop/purge | E3; drain E5 |
| 11–12 | Emergency/job stop | E3.2–E3.3 |
| 13–15 | Task lifecycle, lease, lease token | E0, E1.1 |
| 16–17 | Local queue, task/result separation | E1.2 |
| 18–19 | Pull/API | E0 transport contract; E1.3/E2.3 |
| 20 | Command model | E3.1 |
| 21–22 | Agent detail/global actions UI | UI theo E2–E4, advanced filters E6 |
| 23–24 | Security và permissions | E2 |
| 25–27 | Offline/crash fallback | E1.3, E4.2 |
| 28–29 | Worker/browser crash | E4.2 |
| 30–31 | Upload failure/duplicate | E1.1–E1.2 |
| 32–35 | Stop modes, offline purge, priority, cancel token | E3 và E4.2 |
| 36–38 | Errors/retry/DLQ | E4.1 |
| 39 | Config | Capacity nền E2; versioned E5.1 |
| 40–41 | Version/self-test | E5.2–E5.3 |
| 42–43 | Scheduler/groups | Gate nền E1–E3; nâng cao E6 |
| 44–46 | Attempts, database, job model | E0/E1/E3/E4.1; không copy schema mù quáng |
| 47–48 | Dashboard/audit | Audit nền E2/E3; UI E4; metrics nâng cao E6 |
| 49 | Fallback matrix | R01–R25, nghiệm thu từng gate |
| 50 | Fleet circuit breaker | E6 |
| 51–52 | Startup/runtime loops | E1.3/E2/E3/E4.2 |
| 53 | MVP | G4 và scenario 20-agent |
| 54 | V2 | E5–E6; một số nền tảng tối thiểu cần sớm hơn |
| 55 | Ownership | Mục 17 của kế hoạch |
| 56 | Nguyên tắc bắt buộc | Mục 2/5/14/16; test invariants xuyên suốt |
| 57 | Tầm nhìn quy mô | E6, đo rồi mới cam kết |
| 58 | Phases/DoD | E0–E6, G0–G6, mục 15 |

So với thứ tự của sếp, kế hoạch này vẫn giữ reliability → control → healing → operations → scale. Khác biệt là **tách E0 và đưa hai xung đột với hành vi hiện tại lên đầu**, đồng thời làm audit/UI tối thiểu cùng từng tính năng để có thể test. Không đưa toàn bộ dashboard, config hoặc cơ chế an toàn vào cuối dự án.

## 19. Cách biết từng đợt thực sự xong

Mỗi handoff phải có:

1. Ticket và commit baseline/commit kết thúc.
2. Scope/files và lý do đụng file dùng chung.
3. Contract/schema/env/route thay đổi; agent nào tương thích.
4. Test commands và fresh PASS/FAIL/SKIP; lỗi có sẵn tách riêng.
5. Demo transcript, DB/outbox counts, metrics liên quan; không log secrets.
6. Migration/rollback instructions đã thử trong test environment.
7. TODO/rủi ro còn lại, chủ sở hữu và điều kiện mở gate tiếp theo.

Không đánh dấu hoàn thành chỉ vì có endpoint, UI có nút, test regex YAML pass, hoặc agent hiện online. Bằng chứng phải thể hiện hành vi khi lỗi xảy ra.

## 20. Những câu hỏi cần người dùng trả lời trước khi triển khai

Ưu tiên trả lời nhóm đầu để bắt đầu E0/E1; nhóm sau có thể bổ sung khi tới đợt liên quan.

### Cần ngay

1. Có đồng ý thay lựa chọn “agent công khai không xác thực” trước đây bằng **Agent Key bắt buộc**, theo yêu cầu mới của sếp không?
2. Có đồng ý **chỉ lease hiện tại được hoàn thành task**, thay cho first-result-wins đang có không?
3. Có đồng ý **Stop/Purge không xóa kết quả chưa ACK**, kết quả không còn hợp lệ được giữ quarantine và không tự đưa vào pipeline không?
4. Có đồng ý giữ outbound WSS hiện tại ở giai đoạn đầu, triển khai semantics pull/admission đúng spec trước, hay sếp yêu cầu HTTP pull cụ thể?
5. Global emergency stop có cần dừng cả SEO/Shopify downstream không, hay chỉ phần crawler/agent?

### Cần trước nghiệm thu và rollout

6. Có bao nhiêu máy agent thực tế, Windows phiên bản nào, cấu hình/RAM, số worker và loại job chính?
7. Có môi trường staging/domain riêng và được phép thử kill/restart không? Ai cấp DB test và giữ backup?
8. Hiện đã có Windows sạch/VM và chứng thư/hệ thống ký code chưa?
9. Ai đang phụ trách nhánh `feature/tooling-add-agent-self-update`; có muốn tích hợp nhánh này sau review không?
10. Muốn giữ result quarantine/audit trong bao lâu, dung lượng dự kiến, ai có quyền xóa?
11. Những task sếp/team đã làm ở nhánh khác là gì? Cần commit/PR để đối chiếu, tránh implement lại.

**Bước tiếp theo:** người dùng đọc tài liệu này và checklist, xác nhận phạm vi Task 01 rồi mới bắt đầu. Duyệt docs không tự động cho phép chạy Task 01 hoặc triển khai toàn bộ E0–E6. Các câu hỏi được hỏi đúng lúc task cần quyết định, không dồn tất cả thành điều kiện bắt đầu bài kiểm chứng.
