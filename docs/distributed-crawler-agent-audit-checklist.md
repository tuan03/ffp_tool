# Distributed Crawler Agent — checklist audit và nâng cấp từng task

> Trạng thái: **TASK 13 CHỜ NGƯỜI DÙNG TEST**. Task 12 đã được duyệt qua yêu cầu chuyển tiếp. Xem [báo cáo Task 13](audits/distributed-crawler/task-13-agent-key-creation.md). Tạo key chỉ có trong app factory bật operator; chưa bật auth trên runtime/VPS.
> Nhánh làm việc theo yêu cầu: `cua_pro`. Không tự tạo nhánh, merge, push, deploy VPS hoặc publish release.
> Tài liệu kỹ thuật: [Kế hoạch nâng cấp](distributed-crawler-agent-upgrade-plan.md).
> Nguồn yêu cầu: `D:\Shopify_Workspace\distributed_crawler_agent_server_task_spec.md`, mục 1–58.

## 1. Mục tiêu và cách sử dụng

Đi từ hiện trạng đến đáp ứng đặc tả bằng các việc nhỏ, có bằng chứng. Audit không mặc định phải sửa mọi phần: nếu tiêu chí đã đúng và có test mới chứng minh, bàn giao kết quả kiểm tra thay vì viết lại code.

- **Đọc nhanh:** mục 2 là quy trình; mục 3 là việc đầu tiên; mục 4 là toàn bộ danh sách.
- **Đọc sâu:** tài liệu kế hoạch giải thích thiết kế, các quyết định D1–D10, test R01–R25, cổng G0–G6.
- Checklist này là nguồn tiến độ duy nhất; không tick trạng thái độc lập trong hai tài liệu.
- Các nhóm E là nhóm nghiệm thu liên quan, không phải một task lớn phải triển khai cùng lúc.
- SQLite trên agent là bộ đệm offline. Database chính của Coordinator/Review Studio trong topology Docker là PostgreSQL; không đưa việc chuyển SQLite agent sang PostgreSQL vào audit này.
- Giữ đúng ba container production. Test agents chạy ngoài server; không tác động dữ liệu/store/job thật để thử lỗi.

## 2. Quy trình bắt buộc cho từng task

1. **Xin bắt đầu:** nêu task ID, baseline, phạm vi, phụ thuộc và quyết định cần duyệt. Duyệt tài liệu không đồng nghĩa cho phép triển khai toàn bộ.
2. **Đọc hiện trạng:** phân loại đã đúng / thiếu test / thiếu tính năng / khác hợp đồng. Bảo toàn thay đổi của đồng đội.
3. **Viết bài kiểm tra trước:** xác định input, expected output và môi trường; nếu cần đổi policy phải được duyệt trước.
4. **Làm đúng một task:** không nhân tiện refactor hoặc sửa phần ngoài phạm vi. Có phụ thuộc mới thì báo, xin điều chỉnh.
5. **Assistant test:** focused test + regression liên quan; task có code chạy thêm các lệnh trong AGENTS.md. PostgreSQL bắt buộc mà bị skip thì chưa đạt.
6. **Bàn giao cho người dùng test:** hướng dẫn cụ thể, dữ liệu test, expected/actual, log đã loại secret, cách khôi phục môi trường test.
7. **Dừng chờ:** không bắt đầu task tiếp theo khi task hiện tại còn chờ người dùng xác nhận. Người dùng báo lỗi → sửa cùng task → cả hai test lại.
8. **Đóng task:** ghi xác nhận thực tế của người dùng và commit/bằng chứng. Chỉ chuyển task tiếp theo khi người dùng đồng ý.

### Trạng thái

`CHƯA LÀM → ĐƯỢC PHÉP BẮT ĐẦU → ĐANG LÀM → ASSISTANT TEST ĐẠT → CHỜ NGƯỜI DÙNG TEST → ĐÃ NGHIỆM THU`

- `CẦN SỬA`: test không đạt, quay lại task này.
- `CHỜ ĐIỀU KIỆN`: thiếu quyết định/môi trường/chứng thư/máy sạch; ghi rõ thiếu gì, không tự bỏ qua.
- `KHÔNG ÁP DỤNG`: chỉ dùng khi người dùng/lead duyệt ngoại lệ có lý do; không tính là đáp ứng spec.
- PASS kỹ thuật không tự đồng nghĩa người dùng đã nghiệm thu. Nếu task đã đúng sẵn, vẫn cần fresh test và xác nhận.

### Người dùng test như thế nào?

Task có UI: thao tác trực tiếp trên môi trường test theo checklist. Task nền như lease/race: chạy lại lệnh hoặc xem demo và bảng expected/actual; không yêu cầu người dùng gây lỗi trên hệ thống thật. Bằng chứng mô phỏng không thay nghiệm thu Windows/browser thật ở những task yêu cầu máy thật.

Mỗi lần bàn giao phải cung cấp lệnh/path thực tế đã thử, không đưa placeholder rồi yêu cầu người dùng tự suy đoán. Nếu cần build/restart instance test, phải ghi rõ target và tác động; không restart instance đang phục vụ công việc chỉ để test.

## 3. Task 01 — kiểm chứng lease hiện tại, chưa sửa hành vi

**Liên kết:** E0.1; spec 14–15. **Trạng thái:** ĐÃ NGHIỆM THU. Người dùng đã kiểm tra và cho triển khai Task 02. Xem [báo cáo lịch sử Task 01](audits/distributed-crawler/task-01-lease-baseline.md); kết quả first-result-wins thuộc baseline trước sửa. Hiện chạy [bài kiểm chứng Task 02](audits/distributed-crawler/task-02-final-result-fencing.md) với `--expect current-lease`.

### Mục tiêu

Chứng minh bằng test PostgreSQL hiện tại server nhận kết quả nào khi A hết lease, B được cấp lại và A gửi muộn. Phân biệt kết quả baseline với hành vi mong muốn của đặc tả mới.

### Điều kiện bắt đầu

- Người dùng đã đọc docs và cho phép bắt đầu Task 01.
- Xác định được PostgreSQL test biệt lập, credential test, namespace/directory riêng và giới hạn quyền cleanup.
- Nếu chưa có môi trường phù hợp: báo phương án, tài nguyên và target trước khi dựng. Không dùng DB production, không chỉ thay database URL rồi chạy test phá dữ liệu.

### Công việc được phép

1. Ghi commit/branch/worktree, phiên bản runtime và cấu hình test không secret.
2. Đọc test first-result-wins có sẵn; chuẩn bị test/harness tối thiểu nếu cần.
3. Tạo A/B giả ở tầng store/API để tái hiện lease; bước này chưa chứng minh WSS, browser hoặc hai agent Windows thật.
4. A nhận task → hết lease có kiểm soát → reaper → B nhận task → A gửi → B gửi.
5. Đối chiếu current lease, accepted result, task status và attempt history sau từng bước.
6. Kiểm tra fixture cleanup chỉ tác động namespace test; ghi hướng dẫn chạy lại.

### Không được làm trong Task 01

- Không sửa `accept_result`, scheduler, agent runtime hoặc semantics lease.
- Không sửa migration production, gọi Shopify thật, cào Amazon thật, kill agent thật, restart Docker đang dùng hoặc deploy VPS.
- Không tự sửa test cũ thành expected mới rồi tuyên bố baseline sai test.

### Assistant test và tiêu chí đạt

- PostgreSQL thực sự được dùng; test không skip; fixture lặp lại được, có cleanup an toàn.
- Báo **actual behavior**, không bắt baseline phải pass current-lease-only khi implementation vẫn first-result-wins.
- Nếu A được accepted như test cũ: bài kiểm chứng baseline đạt; yêu cầu mới vẫn chưa đạt.
- Nếu hành vi khác dự kiến: giải thích khác biệt code/config/commit trước khi chuyển task.
- Fresh output cho test đã chạy; không lấy kết quả audit cũ làm bằng chứng hiện tại.

### Người dùng test

Assistant cung cấp một lệnh đã kiểm chứng, bảng bước A/B, expected baseline và actual. Người dùng chạy lại hoặc xem demo, xác nhận hiểu sự khác biệt baseline/spec. Sau đó mới duyệt D2 và Task 02. Không bắt người dùng quyết định auth hoặc updater để hoàn tất bài kiểm chứng này.

### Bàn giao bắt buộc

Commit baseline; files test/docs thay đổi nếu có; command/exit code; schema/namespace test đã dùng; bảng A/B; giới hạn chưa kiểm tra; câu hỏi: “Task 01 đạt chưa, có cho phép Task 02 theo D2 không?”.

## 4. Backlog theo thứ tự thực hiện

**Task 01–13 đã được người dùng cho chuyển tiếp. Task 14–18 đã có triển khai source và test local, chờ nghiệm thu; Task 19 mới đạt phần local, chưa đạt public/composed-runtime gate. Task 20–53 chưa làm.** Người dùng đã duyệt làm gộp Task 14–19. Xem [báo cáo và giới hạn nghiệm thu](audits/distributed-crawler/task-14-19-auth-local-gate.md). Ô checkbox chỉ tick khi người dùng nghiệm thu; không coi code/test local là đã deploy.

Task 02–10 là một nhóm thay đổi liên quan, chỉ thử trên test instance cho tới gate Task 10; không đưa bản sửa nửa chừng vào production. Các task backend chưa có UI sẽ bàn giao bằng harness/CLI; task UI có sẵn được dùng ngay trong demo, không phải đợi cuối mới cho người dùng nhìn thấy kết quả.

### Cách đọc cột đối chiếu với file gốc

- Cột **“Mục trong đặc tả gốc / phần xử lý”** dùng số tiêu đề trong `distributed_crawler_agent_server_task_spec.md`, không phải số dòng hoặc số task của checklist này. Ví dụ **Task 02 → mục 13–15, 19**; không phải mục 2 của file gốc.
- Phần trong ngoặc chỉ rõ phạm vi đóng góp. Đây là **phần dự kiến xử lý sau khi task được nghiệm thu**, chưa phải tuyên bố đã hoàn thành; xem trạng thái Task 01 ở mục 3 và bảng tiến độ cuối file.
- Một mục gốc có thể cần nhiều task: mục 15 (Lease Token) được kiểm chứng ở Task 01, xử lý qua Task 02–04 và kiểm tra chung ở Task 10. Task 01 hoàn thành chỉ chứng minh hiện trạng, không đánh dấu mục 15 đã đáp ứng yêu cầu mới.
- Task có chữ **“nghiệm thu”** kiểm tra kết hợp các phần đã làm, không thay thế implementation hoặc test còn thiếu. Task 53 đối chiếu toàn bộ 1–58, không tự làm nốt phần thiếu trong một task tổng kết.
- Các mục 1 (mục tiêu), 45 (database), 49 (fallback), 55 (phân công), 56 (nguyên tắc), 58 (ưu tiên/DoD) còn có tính xuyên suốt. Cột ghi liên hệ chính; khi mở task phải ghi thêm điều khoản cụ thể và test chứng minh nếu có tác động.
- Topology ba container là ràng buộc kiến trúc FFP từ kế hoạch triển khai trước, không gán nhầm thành một yêu cầu mới chỉ có trong mục 56 của file gốc.
- Chỉ xác nhận **một mục gốc đã hoàn thành** khi toàn bộ tiêu chí áp dụng của mục đó có bằng chứng và người dùng nghiệm thu. Ngoại lệ được duyệt phải ghi riêng, không tính thành PASS.

### A. Reliability — bảo vệ kết quả trước

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | 01 | Tái hiện lease A/B hiện tại | 14–15 (kiểm chứng hiện trạng) | E0.1 | PostgreSQL baseline như mục 3 | Người dùng đã kiểm tra, cho chuyển Task 02 |
| [x] | 02 | Final result mới chỉ nhận từ lease còn quyền | 13–15, 19 (final result) | 01; duyệt D2, rule expiry; E1.1 | A stale bị reject, B accepted | Người dùng xác nhận ổn, cho triển khai Task 03 |
| [x] | 03 | Product streaming cũng chặn lease cũ | 15, 19, 31 (product streaming) | 02; E1.1 | A không tạo pipeline item, B hợp lệ | Người dùng gửi output PASS và cho triển khai Task 04 |
| [x] | 04 | Mutation phụ không hồi sinh lease cũ | 13–15, 19, 27 (mutation/reconcile) | 03; E1.1 | Progress/fail/renew/cancel ACK/reconcile với token cũ | Người dùng đồng ý chuyển task tiếp theo; không có output test riêng được gửi |
| [x] | 05 | Result receipt idempotent, checksum conflict rõ | 19, 30–31 (receipt/duplicate) | 04; E1.1 | Mất ACK gửi lại không duplicate; khác checksum reject | Người dùng báo test thành công và cho triển khai Task 06 |
| [x] | 06 | Outbox định danh riêng, migrate không mất dữ liệu | 16–17, 27, 30–31 (outbox) | 05; duyệt D3; E1.2 | SQLite agent cũ → mới; hai attempts không đè nhau | Người dùng cho chuyển task tiếp theo; không gửi output test riêng |
| [x] | 07 | Stop/cleanup giữ kết quả và asset chưa ACK | 9–10, 17, 30, 33 (giữ kết quả) | 06; E1.2 | Discard/purge/reconcile không xóa outbox; quarantine không publish | Người dùng cho chuyển tiếp; không gửi output test riêng |
| [x] | 08 | Outbox có backpressure khi lỗi lưu trữ | 16, 30, 36 (lỗi lưu trữ) | 07; quota/retention được duyệt; E1.2 | Disk-full mô phỏng, không false SUCCESS/nhận thêm | Cho chuyển tiếp qua hội thoại |
| [x] | 09 | Reconnect/restart đối chiếu trước nhận task | 18, 25–27, 30, 51–52 (recovery) | 08; D4, policy offline; E1.3 | Crash/mạng mất, không recrawl chỉ vì mất ACK | Cho chuyển tiếp qua hội thoại |
| [x] | 10 | Nghiệm thu reliability chung | 13–18, 25–27, 30–31, 49 (nghiệm thu nhóm) | 02–09; G1 | PG race + hai agent fixture qua HTTP/WSS + regression | Cho chuyển tiếp qua hội thoại; giới hạn trong báo cáo Task 10 |

Task 05 chốt contract receipt/result ID phía server; Task 06 migrate agent dùng contract đó. Mọi ACK/disposition mới phải tương thích agent trong test hoặc có adapter; không xóa spool cũ khi triển khai giữa hai task. Task 09 chỉ dùng control hiện có; control ledger mới được tích hợp và test lại ở Task 21.

### B. Identity và bảo mật

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | 11 | Chốt identity/auth/state compatibility | 2–6, 23–24, 51 (chốt contract) | 10; D1/D5/D6; E0.2/E2 | Ma trận agent cũ/mới, quyền local stop, naming states | Đã duyệt qua yêu cầu chuyển tiếp |
| [x] | 12 | Operator authorization và audit nền | 23–24, 48 (quyền operator/audit) | 11; E2.1 | Admin allowed, agent/anonymous denied; audit không secret | Đã duyệt qua yêu cầu chuyển tiếp |
| [x] | 13 | Tạo key chỉ hiển thị raw một lần | 3, 23–24 (tạo key) | 12; E2.1 | Hash/verifier, expiry/capacity, không raw log | Đã cho chuyển tiếp qua yêu cầu triển khai Task 14–19 |
| [ ] | 14 | Register idempotent, server cấp identity | 2, 4–5, 19 (register/identity) | 13; E2.1 | Mất register response không sinh ID trùng | Restart và đối chiếu ID |
| [ ] | 15 | Setup URL/key và OS credential storage | 2, 4, 23, 51 (setup/secret) | 14; E2.2 | Identity/secret không lệch, không vào Git/log | Setup agent test và mở lại |
| [ ] | 16 | HTTP agent xác thực và kiểm ownership | 19, 23–24 (HTTP auth) | 15; E2.3 | Upload/assets/lease: key A không dùng task B | Chạy negative API demo |
| [ ] | 17 | WSS session bị kiểm quyền cả khi đang mở | 6–7, 23–24 (session auth) | 16; E2.3 | Key invalid/revoke không claim; giữ outbox | Quan sát agent test chuyển NEED_REAUTH |
| [ ] | 18 | Rotate/revoke/rebind/reinstall an toàn | 3–5, 23 (key lifecycle) | 17; E2.1–2.2 | Copy DB không giả danh, rotate không mất outbox | Thử key test, identity và reinstall theo policy |
| [ ] | 19 | Nghiệm thu auth qua public test URL | 2–5, 19, 23–24 (nghiệm thu nhóm) | 11–18; G2 | Nginx routes, internal path blocked, compatibility matrix | Duyệt enrollment và phạm vi cutover; chưa bật VPS |

Task 17 dùng thao tác revoke qua fixture/backend đã bảo vệ để test; Task 18 hoàn thiện lifecycle và UI. Chỉ bật auth bắt buộc cho deployment thật sau phê duyệt riêng, không coi gate này là lệnh deploy.

### C. Điều khiển bền vững và worker an toàn

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [x] | 20 | Command ledger server và agent bền vững | 8, 20, 45, 48 (command ledger) | 19; E3.1 | Persist trước gửi/tác động, ACK khác completion | QA tự động được người dùng chấp thuận thay kiểm tra thủ công |
| [x] | 21 | Replay/priority/expiry và startup gate đúng | 20, 33–34, 51–52 (replay/ordering) | 20; E3.1 | Restart, duplicate, sequence gaps, offline-before-lease | QA tự động được người dùng chấp thuận thay kiểm tra thủ công |
| [x] | 22 | PAUSE/RESUME có desired/applied state | 6–9, 21, 42 (pause/resume) | 21; E3.1 | Pause không claim; resume không vượt auth/health gate | QA tự động được người dùng chấp thuận thay kiểm tra thủ công |
| [x] | 23 | Global admission gate bền vững | 11, 22, 42 (global gate) | 22; D7/D8 đã duyệt; E3.2 | Stop/lease race, server restart giữ gate | QA code theo lựa chọn người dùng |
| [ ] | 24 | Soft stop hoàn tất running, không nhận mới | 9, 32 (soft stop) | 23; E3.2 | Online/offline, không purge result; local stop không hủy job khác | Demo stop mềm và pending confirmations |
| [ ] | 25 | Chốt thiết kế isolation và ownership worker | 28–29, 35, 52 (thiết kế worker) | 24; E4.2 | Audit thread/process/IPC, Windows/CAPTCHA constraints | Duyệt phạm vi refactor nếu cần |
| [ ] | 26 | Worker crash không làm chết agent/control loop | 27–28, 52 (worker recovery) | 25; E4.2 | Kill child test, worker khác và outbox sống | Xem agent vẫn online và recovery |
| [ ] | 27 | Watchdog xử lý hang/crash storm đúng phạm vi | 6, 28–29, 36 (watchdog) | 26; E4.2 | Kill đúng process tree; bounded restart/degraded | Browser khác/ChatGPT không bị đóng |
| [ ] | 28 | Hard stop/cancel task chỉ tác động đúng scope | 8–9, 32, 35 (hard stop/cancel task) | 27; E3.2–3.3 | Per-task cancellation, grace/escalation, late results | Dừng một task; task khác không bị hủy |
| [ ] | 29 | Cancel job không bị hồi sinh sau reconnect | 12–13, 35, 46 (cancel job) | 28; E3.3 | Queued/running/late results, downstream boundary | Hủy job mẫu, xem lý do/giới hạn tác động |
| [ ] | 30 | Purge pending không đụng running/outbox | 9–10, 17, 33, 48 (purge pending) | 29; E3.4 | Mixed queues, repeat/offline command, audit | Xác nhận counts trước/sau purge |
| [ ] | 31 | Purge all theo scope giữ kết quả chưa ACK | 9–10, 17, 33, 48 (purge all) | 30; E3.4 | Optional running cancel, offline replay, confirmation | Thử PURGE dữ liệu test và quarantine |
| [ ] | 32 | RESTART_WORKERS/RESTART_AGENT xác nhận sau phục hồi | 8, 20, 27–28, 51 (restart commands) | 31; E3/E4.2 | Boot mới ACK completion, không mất identity/outbox | Restart agent test, xem timeline đúng |

Task 20–22 đã được triển khai trên `cua_pro` local: PostgreSQL command ledger và event history phía server, SQLite inbox bền vững phía agent, replay theo sequence/expiry, nút PAUSE/RESUME sau đăng nhập operator và admission gate lúc khởi động. Người dùng chấp thuận nghiệm thu bằng QA code thay cho thao tác UI thủ công. Ngày 2026-10-05, kiểm tra tự động đạt: `npm test` (engine 481 tests/13 skipped, Review Image 34, Pinterest 22; toàn lệnh exit 0), `npm run typecheck`, `npm run build`, và test tập trung command/recovery (16/16). Các skip là test opt-in theo môi trường; không được tính là đã chạy. Đây là nghiệm thu source/test local, không xác nhận Docker/VPS production, không push hay cutover.

Task 23 hoàn tất trên `cua_pro` local. Coordinator migration 8 bổ sung trạng thái admission gate đơn lẻ bền vững cùng audit/idempotency event; mọi claim lease khóa gate chia sẻ trong cùng transaction, còn STOP/OPEN lấy khóa độc quyền nên thao tác stop được sắp xếp nguyên tử với việc cấp lease. Gate STOPPED chặn lease mới sau khi stop commit, không thu hồi task đã lease/chạy; đúng scope D7 đã duyệt, không tự dừng SEO/Shopify. Operator Basic-only API và UI crawler cho phép xem trạng thái, ghi lý do và OPEN/STOPPED; PAUSED vẫn resumable, CANCELLED terminal, không thêm Job STOPPED (D8). QA code 2026-10-05: `npm test` exit 0 (web 906; engine 489, 15 skipped; Review Image 34; Pinterest 22; các nhóm còn lại cũng pass), `npm run typecheck`, `npm run build`; PostgreSQL 17 concurrency/persistence test chạy hai lần trong schema cách ly, đều pass; `git diff --check` pass. Skip là test opt-in theo môi trường, không được tính là chạy. Đây là nghiệm thu source/test local, không rebuild/restart Docker, không push/cutover. Task 24 chưa làm.

Đưa isolation trước hard stop/cancel task để không hứa khả năng kill riêng worker khi executor chưa hỗ trợ. Nếu crash/hang chỉ chứng minh trên simulator, ghi giới hạn; chưa tick nghiệm thu Windows thực tế.

### D. Retry, quan sát và gate MVP

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | 33 | Taxonomy lỗi và retry budget thống nhất | 36–37 (errors/retry) | 32; E4.1 | Permanent/transient, Retry-After, restart giữ budget | Xem lỗi và lịch retry có lý do |
| [ ] | 34 | Attempt history/version và retention đúng | 44–45, 48 (attempt history) | 33; D9; E4.1 | Không ghi đè lịch sử, cleanup không mất evidence cần giữ | Theo dõi một task qua nhiều attempts |
| [ ] | 35 | DLQ có requeue/delete được phân quyền | 38, 48 (DLQ) | 34; E4.1 | Hết budget vào DLQ, requeue không duplicate; delete có audit | Retry một task/bulk nhỏ và xác nhận scope |
| [ ] | 36 | Dashboard thống nhất states/commands/backlog | 3, 6–7, 21–22, 47–48 (UI/heartbeat) | 35; E4.3 | Pagination, error/loading, offline không giả stopped | Duyệt màn agent/job/key/command hiện có |
| [ ] | 37 | Regression consumers chung và runtime | 49, 56 (regression; thêm ràng buộc FFP) | 36; G3/G4 | Amazon Reviews/Pinterest/Review Studio/pipeline/internal routes; đúng ba container | Smoke các màn/flow liên quan trên test instance |
| [ ] | 38 | Nghiệm thu MVP 20-agent fault scenario | 49, 53, 58 (nghiệm thu MVP/DoD) | 37; spec 53/58; G4 | Kill5, server outage, purge/revoke/restart, đối chiếu DB/outbox | Xem báo cáo + demo, phân biệt giả và máy thật |

UI tối thiểu đi kèm từng task từ trước; Task 36 chỉ thống nhất và lấp khoảng thiếu, không dồn toàn bộ khả năng quan sát tới cuối. Nếu thiếu máy/tài nguyên cho Task 38, ghi CHỜ ĐIỀU KIỆN; không dùng test nhỏ để tự tick MVP.

### E. Vận hành và cập nhật

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | 39 | Config version và RELOAD_CONFIG giữ last-good | 7–8, 39 (config) | 38; E5.1 | Validate/ACK/rollback, timeout relationships | Đổi config test hợp lệ và không hợp lệ |
| [ ] | 40 | DRAIN báo đúng khi hết running | 6, 8–9 (drain) | 39; E5.2 | Timeout không purge, outbox policy | Drain agent test, xem DRAINING/DRAINED |
| [ ] | 41 | RUN_SELF_TEST không tạo tác động nghiệp vụ thật | 8, 41 (self-test) | 40; E5.2 | PASS/DEGRADED/FAIL, auth/disk/worker/serialize | Chạy self-test, đọc từng nguyên nhân |
| [ ] | 42 | Rà nhánh updater và chốt phần tái sử dụng | 40, 54 (audit updater) | 41; E0.3/E5.3, owner xác nhận | Diff/compatibility/topology, không tự merge | Duyệt reuse/gap và scope tích hợp |
| [ ] | 43 | Artifact/manifest được xác minh trước thực thi | 23, 40 (xác minh artifact) | 42; E5.3 | Hash/signature/version, partial download, disk-full | Xem artifact sai bị từ chối, bản cũ còn |
| [ ] | 44 | UPDATE_AGENT giữ identity/data và ACK sau boot | 8, 40, 51 (update) | 43; E5.3 | Drain/install/reboot journal/self-test, outbox nguyên vẹn | Update agent test, đối chiếu trước/sau |
| [ ] | 45 | ROLLBACK_AGENT tương thích schema và dữ liệu | 8, 40 (rollback) | 44; E5.3 | Bản mới lỗi, rollback an toàn, backup recovery | Demo rollback test, không mất credential/profile |
| [ ] | 46 | Clean-machine installer và canary rehearsal | 2, 5, 40, 54 (installer/canary) | 45; D10; G5 | Signed release trên Windows sạch, upgrade/uninstall; staged rollout | Nghiệm thu trên VM/máy sạch; release thật cần duyệt riêng |

Task 42 là review sâu đúng lúc tích hợp; trong Task 01 chỉ ghi nhận nhánh/owner liên quan nếu cần, không tự làm luôn task updater. Thiếu chứng thư/máy sạch không được thay bằng test giả rồi công bố đạt.

### F. Quy mô và kết thúc audit

| Đạt | ID | Một kết quả cần đạt | Mục trong đặc tả gốc / phần xử lý | Phụ thuộc / map | Assistant kiểm tra | Người dùng kiểm tra |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | 47 | Groups/permissions và global filters đúng scope | 22, 24, 42–43 (groups) | 46; E6 | Job affinity/allowed crawler, bulk scope, không vượt key rights | Giao việc nhóm A/B và kiểm nút bulk |
| [ ] | 48 | Scheduler health/capacity/fairness được đo | 6, 18, 42 (scheduler) | 47; E6 | Agent nhanh/chậm, không starvation/capacity overflow | Xem phân phối task và số liệu |
| [ ] | 49 | Auto concurrency có giới hạn/hysteresis | 7, 39, 42, 54 (auto concurrency) | 48; E6 | CPU/RAM/quota fixtures, không dao động hoặc vượt cap | Xem tăng/giảm capacity có lý do |
| [ ] | 50 | Fleet circuit breaker với bounded probes | 50 (fleet circuit breaker) | 49; E6 | Parser lỗi hàng loạt, half-open, admin stop thắng | Demo OPEN/HALF_OPEN/CLOSED trên fixture |
| [ ] | 51 | Batch result delivery giữ receipt từng kết quả | 19, 30–31, 54 (batch results) | 50; spec 54; E6 | Partial success, duplicate/conflict, giới hạn payload | Gửi lại batch lỗi không nhân kết quả |
| [ ] | 52 | Metrics/load/soak và giới hạn thực tế | 7, 47, 54, 57 (metrics/scale) | 51; G6 | Tải tăng dần, p95/p99/backlog/DB; không claim500 chưa đo | Duyệt báo cáo tài nguyên và ngưỡng vận hành |
| [ ] | 53 | Đối chiếu spec và đóng audit | 1–58 (đối chiếu cuối; không tự triển khai phần thiếu) | 52; spec 1–58 | Mỗi tiêu chí có evidence hoặc ngoại lệ được duyệt; rollback/runbook | Ký xác nhận kết quả, TODO còn lại và phạm vi release |

53 task ở đây không tương ứng 1:1 với số mục spec. Một hàng vẫn có thể cần tách nhỏ sau audit code; dùng hậu tố như `26a/26b`, giữ ID cũ và xin duyệt trước khi tách. Không thêm mục lớn vào task đang chạy chỉ vì cùng file.

## 5. Các quyết định cần duyệt đúng thời điểm

| Trước task | Quyết định cần chốt | Không tự suy diễn |
| --- | --- | --- |
| 01 | Môi trường test và phạm vi kiểm chứng | Không được tác động DB/job thật |
| 02 | D2: current-lease-only, expiry và receipt | Duyệt tài liệu không tự đổi hành vi cũ |
| 06–08 | D3/D9: giữ/quarantine kết quả, quota và retention | Không tự xóa outbox để giải phóng disk |
| 09 | D4: WSS/pull và offline policy | Không đổi transport toàn bộ |
| 11 | D1/D5/D6: auth, quyền agent, bind/rebind | Không mặc định quyết định no-auth cũ đã bị hủy |
| 23–24 | D7/D8: scope stop và lifecycle job | Không hứa đảo ngược Shopify write |
| 25 | Worker process/refactor Windows | Không thêm container hoặc kill Chrome ngoài scope |
| 42–46 | Owner updater, signing, máy sạch, release channel | Không tự merge/publish/canary VPS |
| 47–52 | Tải mục tiêu, phần cứng, quota và ngưỡng | Không dùng thông số ví dụ như SLA đã cam kết |

Chỉ hỏi các câu cần cho task sắp bắt đầu. Người dùng có thể xem trước D1–D10 trong kế hoạch, nhưng không bắt trả lời toàn bộ để bắt đầu Task 01.

## 6. Phiếu bắt đầu và nghiệm thu — dùng lại cho từng task

```text
Task ID / tên:
Trạng thái:
Baseline commit / nhánh:
Ngày và nội dung người dùng cho phép bắt đầu:
Spec sections / nhóm E / test R liên quan:
Điều khoản cụ thể trong từng mục gốc được task này xử lý:
Kết quả đối chiếu: chỉ kiểm chứng / đáp ứng một phần / đủ toàn bộ mục (kèm bằng chứng):
Phần của mục gốc còn lại và task sẽ xử lý tiếp:
Phụ thuộc đã nghiệm thu:
Quyết định đã duyệt:
Hiện trạng: đã đúng / thiếu test / thiếu tính năng / khác hợp đồng
Mục tiêu và tiêu chí đạt:
Files/folders được sửa:
Không được sửa / không được tác động:
Database/process/container bị ảnh hưởng:
Contract/schema/env/route changes:
Môi trường và dữ liệu test:

Assistant test:
- Command thực tế, exit code, PASS/FAIL/SKIP:
- Expected / actual và bằng chứng:
- Regression đã chạy / phần chưa chạy:
- Lỗi có sẵn và lỗi mới:

Người dùng test:
- Chuẩn bị:
- Các bước/lệnh đã được assistant thử trước:
- Kết quả mong đợi từng bước:
- Cách trả lại môi trường test:
- Kết quả/feedback thực tế: CHƯA CÓ

Commit/files bàn giao:
Rollback/compatibility notes:
TODO/rủi ro/điều kiện còn thiếu:
Xác nhận nghiệm thu của người dùng: CHƯA CÓ
Cho phép chuyển task tiếp theo: CHƯA CÓ
```

Lưu phiếu đã điền/bằng chứng text đã loại secret trong `docs/audits/distributed-crawler/` khi task thực sự bắt đầu. Chưa tạo hàng chục báo cáo trống. SQLite/PG dumps, logs nhạy cảm và generated artifacts không commit; ghi đường dẫn local nếu cần.

## 7. Bảng trạng thái hiện tại

| Nội dung | Trạng thái |
| --- | --- |
| Kế hoạch tổng thể và checklist | Đã soạn, chờ người dùng đọc/duyệt |
| Task đang chạy | Task 14–19: source/local checks; G2 còn phần nghiệm thu và tương thích runtime |
| Task 01 | Đã nghiệm thu baseline; không đồng nghĩa hoàn thành mục 15 |
| Task 02 | Đã nghiệm thu final result |
| Task 03 | Đã nghiệm thu product streaming |
| Task 04 | Đã nghiệm thu qua yêu cầu chuyển tiếp; xem báo cáo Task 04 |
| Task 05 | Người dùng đã test thành công, nghiệm thu |
| Task 06 | Đã nghiệm thu qua yêu cầu chuyển tiếp; xem báo cáo Task 06 |
| Task 07 | Đã nghiệm thu qua yêu cầu chuyển tiếp; xem báo cáo Task 07 |
| Task 08 | Đã triển khai ngưỡng 1 GiB/10.000 records/2 GiB trống, cảnh báo 24 giờ, chặn admission khi lỗi lưu trữ |
| Task 09 | Đã nghiệm thu qua yêu cầu chuyển tiếp; xem báo cáo Task 09 |
| Task 10 | Đã nghiệm thu qua yêu cầu chuyển tiếp; xem giới hạn fixture trong báo cáo |
| Task 11 | Contract được duyệt qua yêu cầu chuyển tiếp |
| Task 12 | Đã duyệt qua yêu cầu chuyển tiếp; chưa bật runtime |
| Task 13 | Đã cho chuyển tiếp qua hội thoại |
| Task 14–18 | Source và test local đã bổ sung; xem báo cáo batch, chưa tick nghiệm thu |
| Task 19 | Local Docker Compose/Nginx/PostgreSQL and public HTTPS readiness pass; public crawler-agent auth and production cutover remain pending |
| Task 20–53 | Chưa làm |
| Runtime/deployment đang chạy | Không rebuild/restart; không migration DB ứng dụng |
| Push/deploy/release được thực hiện | Không |

**Điểm dừng hiện tại:** chạy `python scripts/audits/audit_lease_baseline.py --proxy-auth` để kiểm tra local, đọc [báo cáo batch](audits/distributed-crawler/task-14-19-auth-local-gate.md) và chốt các gate còn lại. Chưa bật auth trên VPS, chưa publish installer; không tự push/deploy hoặc chuyển Task 20.

Follow-up acceptance: [Step 02 Crawler operator UI](audits/distributed-crawler/step-02-crawler-operator-ui.md)
adds an isolated browser test and manual instructions. This is partial Task 19 evidence;
user UI acceptance, Pinterest/Review Studio and public/composed-runtime gates remain pending.

2026-10-04 follow-up: user accepted the Crawler UI check. Pinterest operator-session
compatibility is implemented and locally tested; see the Pinterest follow-up section
in the batch report. User Pinterest acceptance and remaining integration gates are pending.

Next follow-up: user accepted the Pinterest sandbox. Review Studio's bridge/operator
boundary is repaired and checked using isolated fixtures plus the actual composed
PostgreSQL factory. See the Review Studio section in the batch report for commands
and limits; real ChatGPT/public TLS and remaining Task 19 gates are not marked complete.

2026-10-04 local Compose QA: rebuilt only the staging `server`; all three containers
healthy. Review Studio loaded three configured stores and 131 templates, with the
extension reconnected after restart. Public HTTPS readiness returned 200. Local/staging
prerequisites are sufficient to begin Task 20; this does not accept production cutover.
