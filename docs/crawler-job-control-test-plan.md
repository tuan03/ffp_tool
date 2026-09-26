# Crawler Job Control — Test Plan

Tài liệu này kiểm thử luồng phân phối task, Stop, Run again, Delete, reconnect và quản lý trạng thái agent.

> Chỉ chạy các case có Shopify mutation trên development store. Hệ thống giữ nguyên dữ liệu đã ghi lên Shopify và không tự rollback khi job bị hủy.

## Quy ước mức độ ưu tiên

| Mức độ | Ý nghĩa |
| --- | --- |
| P0 | Bắt buộc đạt trước khi sử dụng thực tế. Lỗi có thể khiến task tiếp tục chạy hoặc ghi dữ liệu sau khi người dùng đã Stop/Delete. |
| P1 | Quan trọng cao. Liên quan đến tính ổn định, nhiều agent, reconnect và trải nghiệm vận hành. |
| P2 | Edge case và kiểm thử độ bền. |

## Chuẩn bị môi trường

- Chạy `npm run dev`.
- Có ít nhất một agent protocol v4 đang online.
- Với test nhiều agent, chuẩn bị hai máy hoặc hai cấu hình agent có client ID khác nhau.
- Dùng danh sách URL đủ lớn để job không hoàn thành trước khi thao tác Stop.
- Dùng Shopify development store cho các case pipeline.
- Ghi lại job ID, cancellation ID, task ID và lease ID khi cần đối chiếu.

---

## P0 — Bắt buộc phải đạt

### P0-01: Stop job đang chạy trên agent online

Các bước:

1. Khởi động coordinator, pipeline và ít nhất một agent.
2. Tạo job có nhiều URL.
3. Chờ agent bắt đầu xử lý task.
4. Nhấn **Stop**.
5. Quan sát Job Manager và trạng thái agent.

Kết quả mong đợi:

- [ ] Job chuyển từ `running` sang `cancelling`.
- [ ] Agent nhận tín hiệu hủy và dừng task hiện tại.
- [ ] Task chưa chạy bị hủy ngay.
- [ ] Job chỉ chuyển sang `cancelled` sau khi agent và pipeline đã ACK.
- [ ] UI không báo đã dừng an toàn khi vẫn còn thành phần chưa ACK.
- [ ] Không có product mới tiếp tục đi qua pipeline sau khi hủy.

### P0-02: Stop khi agent offline

Các bước:

1. Tạo job và chờ agent nhận task.
2. Ngắt mạng agent hoặc tắt coordinator để agent mất kết nối.
3. Bật lại coordinator nhưng chưa bật lại agent.
4. Nhấn **Stop**.

Kết quả mong đợi:

- [ ] Job giữ trạng thái `cancelling`.
- [ ] Job không tự chuyển `cancelled` chỉ vì lease hết hạn.
- [ ] Job Manager hiển thị agent đang chờ xác nhận hủy.
- [ ] Agent offline không xuất hiện trong danh sách **Crawler clients**.

### P0-03: Agent reconnect sau khi job đã bị Stop

Tiếp tục từ P0-02:

1. Bật lại agent.
2. Chờ agent reconnect.
3. Theo dõi job và log agent.

Kết quả mong đợi:

- [ ] Agent gửi inventory task local lên coordinator.
- [ ] Coordinator yêu cầu discard task cũ.
- [ ] Agent không chạy tiếp task đã bị hủy.
- [ ] Dữ liệu/result local của task bị loại bỏ.
- [ ] Agent gửi ACK cancellation.
- [ ] Job chuyển từ `cancelling` sang `cancelled`.
- [ ] Agent trở lại online và nhận được task mới.

### P0-04: Reject kết quả gửi muộn sau Stop

Các bước:

1. Cho agent nhận một task.
2. Stop job.
3. Giả lập hoặc để agent gửi progress, product hoặc result cũ sau thời điểm Stop.

Kết quả mong đợi:

- [ ] Coordinator từ chối kết quả muộn.
- [ ] Task không quay lại `running` hoặc `completed`.
- [ ] Không tạo product pipeline item mới.
- [ ] Không phát sinh Shopify mutation từ kết quả muộn.
- [ ] Job vẫn ở `cancelling` hoặc `cancelled`.

### P0-05: Stop trong lúc pipeline đang xử lý Shopify

Các bước:

1. Chạy một job tới bước SEO, image processing hoặc Shopify.
2. Nhấn Stop khi pipeline đang xử lý.
3. Theo dõi heartbeat pipeline và Shopify requests.

Kết quả mong đợi:

- [ ] Pipeline phát hiện cancellation trong khoảng heartbeat, hiện tại khoảng 2 giây.
- [ ] Pipeline không bắt đầu Shopify mutation tiếp theo sau khi nhận cancellation.
- [ ] Pipeline gửi ACK về coordinator.
- [ ] Job chỉ chuyển `cancelled` sau ACK.
- [ ] Mutation đang gửi dở có thể hoàn thành, nhưng bước tiếp theo không được chạy.
- [ ] Dữ liệu đã ghi lên Shopify được giữ nguyên.

### P0-06: Delete job đang chạy

Các bước:

1. Tạo job và chờ agent nhận task.
2. Trong Job Manager, chọn **Delete**.
3. Xác nhận hộp thoại.
4. Để agent cũ tiếp tục chạy hoặc reconnect sau đó.

Kết quả mong đợi:

- [ ] Job biến mất khỏi Job Manager và API danh sách job.
- [ ] Task, attempt, event và product item của job bị xóa.
- [ ] Tombstone được tạo trong 30 ngày.
- [ ] Agent nhận tín hiệu discard.
- [ ] Upload/result cũ bị từ chối.
- [ ] Sản phẩm đã tạo trên Shopify không bị xóa.
- [ ] Delete lại cùng job ID không làm dữ liệu sống lại.

### P0-07: Delete khi agent đang offline

Các bước:

1. Cho agent nhận task.
2. Ngắt kết nối agent.
3. Delete job trên UI.
4. Bật lại agent.

Kết quả mong đợi:

- [ ] Job bị xóa ngay trên coordinator.
- [ ] Agent reconnect nhận yêu cầu discard từ tombstone.
- [ ] Task cũ không được resume.
- [ ] Agent không upload product/result của job đã xóa.
- [ ] Agent vẫn nhận được job mới bình thường.

### P0-08: Stop & Run again

Các bước:

1. Chạy một job đang xử lý.
2. Nhấn **Run again**.
3. Quan sát job cũ và replacement job.

Kết quả mong đợi:

- [ ] Job cũ chuyển sang `cancelling`.
- [ ] Một replacement job mới được tạo.
- [ ] Replacement có `replacementOfJobId` trỏ tới job cũ.
- [ ] Replacement dùng URL/settings hiện tại; nếu form không có URL thì dùng URL job cũ.
- [ ] Hai job có ID khác nhau.
- [ ] Kết quả muộn của job cũ không được nhập vào job mới.
- [ ] Replacement được phân phối trước các job thường đang chờ.

### P0-09: Stop không bị mất sau restart server

Các bước:

1. Stop một job khi vẫn còn ACK đang chờ.
2. Tắt toàn bộ `npm run dev`.
3. Khởi động lại server.
4. Kiểm tra Job Manager.
5. Cho agent reconnect.

Kết quả mong đợi:

- [ ] Job vẫn là `cancelling`, không trở lại `queued` hoặc `running`.
- [ ] Cancellation ID vẫn được giữ.
- [ ] Agent được yêu cầu discard task cũ.
- [ ] Sau ACK, job chuyển `cancelled`.
- [ ] Task đã hủy không được lease lại.

### P0-10: Server dừng nhưng agent hoàn thành task local

Các bước:

1. Cho agent nhận task.
2. Tắt server trong lúc agent xử lý.
3. Để agent tiếp tục xử lý ở local.
4. Bật server lại và Stop/Delete job trước khi agent reconnect, hoặc dùng Stop local từ tray.
5. Cho agent reconnect.

Kết quả mong đợi:

- [ ] Nếu job vẫn active, kết quả local hợp lệ được tiếp tục upload.
- [ ] Nếu job đã Stop/Delete, kết quả local bị discard.
- [ ] Không tạo task trùng hoặc pipeline item trùng.
- [ ] Agent không bị kẹt trong vòng retry vô hạn.

### P0-11: Tray “Stop & discard local work”

Các bước:

1. Cho agent nhận một hoặc nhiều task.
2. Mất kết nối coordinator.
3. Trên tray chọn **Stop & discard local work**.
4. Khởi động lại agent khi coordinator vẫn offline.
5. Sau đó bật coordinator.

Kết quả mong đợi:

- [ ] Agent tạo cancel intent bền vững trong SQLite.
- [ ] Task local đang chờ bị xóa.
- [ ] Task đang chạy nhận cancel event.
- [ ] Restart agent không làm task cũ chạy lại.
- [ ] Khi reconnect, cancel intent được gửi lên coordinator.
- [ ] Coordinator hủy job liên quan và ACK intent.
- [ ] Cancel intent local được xóa sau ACK.

### P0-12: Agent protocol cũ bị từ chối

Các bước:

1. Thử kết nối agent protocol v2 hoặc v3.
2. Kiểm tra WebSocket và danh sách agent.
3. Kết nối agent v4.

Kết quả mong đợi:

- [ ] Agent cũ bị đóng kết nối với lý do protocol không hỗ trợ.
- [ ] Agent cũ không nhận task.
- [ ] Agent v4 kết nối và nhận task bình thường.
- [ ] Không có hai phiên cùng xử lý một lease.

---

## P1 — Quan trọng cao

### P1-01: Pause/Resume agent

Các bước:

1. Agent online nhưng chưa có task.
2. Chọn **Pause**.
3. Tạo job mới.
4. Restart agent để kiểm tra trạng thái bền vững.
5. Chọn **Resume**.

Kết quả mong đợi:

- [ ] Paused agent vẫn hiển thị vì còn kết nối.
- [ ] Agent báo 0 slot và không nhận task mới.
- [ ] Pause được giữ sau restart.
- [ ] Resume khôi phục slot và agent nhận task.
- [ ] Task đang chạy trước Pause được phép hoàn thành; Pause không tương đương Stop.

### P1-02: Chỉ hiển thị agent đang kết nối

Các bước:

1. Có một agent online và một số bản ghi agent offline trong database.
2. Mở trang Amazon Crawler.
3. Tắt agent online và đợi chu kỳ refresh 5 giây.
4. Bật lại agent.

Kết quả mong đợi:

- [ ] Ban đầu chỉ agent đang kết nối được hiển thị.
- [ ] Agent offline lịch sử không xuất hiện.
- [ ] Sau khi agent hiện tại offline, card biến mất.
- [ ] Empty state hiển thị “Chưa có client online”.
- [ ] Khi reconnect, card xuất hiện trở lại.
- [ ] Bộ đếm chỉ ghi số agent “đang kết nối”.

### P1-03: Agent busy, waiting CAPTCHA và paused vẫn hiển thị

Kiểm tra lần lượt các trạng thái `busy`, `waiting_captcha` và `paused`.

Kết quả mong đợi:

- [ ] Cả ba trạng thái vẫn hiển thị nếu `isConnected=true`.
- [ ] `offline` hoặc `isConnected=false` không hiển thị.
- [ ] Màu và nhãn trạng thái đúng.

### P1-04: Stop được gọi nhiều lần

Các bước:

1. Nhấn Stop liên tục hoặc gửi nhiều request cancel cùng job.
2. Quan sát cancellation ID và trạng thái.

Kết quả mong đợi:

- [ ] Không tạo nhiều cancellation ID.
- [ ] Không tạo event hoặc task phụ trùng.
- [ ] Trạng thái nhất quán.
- [ ] Job đã `cancelled` trả về snapshot hiện tại.

### P1-05: Delete được gọi nhiều lần

Các bước:

1. Delete một job.
2. Gửi lại DELETE cùng job ID.

Kết quả mong đợi:

- [ ] Không lỗi database.
- [ ] Tombstone không bị tạo trùng.
- [ ] Job không xuất hiện lại.
- [ ] Upload cũ tiếp tục bị discard trong thời gian tombstone còn hiệu lực.

### P1-06: Nhiều agent cùng xử lý một job rồi Stop

Các bước:

1. Khởi động ít nhất hai agent.
2. Tạo job đủ lớn để cả hai nhận task.
3. Stop job.

Kết quả mong đợi:

- [ ] Tất cả agent nhận cancel.
- [ ] UI liệt kê đúng từng agent còn chờ ACK và số task tương ứng.
- [ ] Job chỉ `cancelled` sau khi tất cả agent và pipeline ACK.
- [ ] Agent ACK sớm không làm che mất agent còn đang xử lý.

### P1-07: Một agent ACK, một agent offline

Các bước:

1. Hai agent cùng nhận task.
2. Giữ agent A online và cho agent B offline.
3. Stop job.

Kết quả mong đợi:

- [ ] Task của A được xác nhận hủy.
- [ ] Job vẫn `cancelling` vì B chưa ACK.
- [ ] Job Manager chỉ rõ B đang chờ xác nhận.
- [ ] B không xuất hiện trong danh sách crawler online.
- [ ] Khi B reconnect và discard task, job chuyển `cancelled`.

### P1-08: Replacement được ưu tiên

Các bước:

1. Tạo nhiều job thường đang `queued`.
2. Stop & Run again một job.
3. Giải phóng một slot agent.

Kết quả mong đợi:

- [ ] Replacement được lease trước các job thường cũ hơn.
- [ ] Priority không làm agent vượt giới hạn slot.
- [ ] Job cũ không được lease thêm task.

### P1-09: Khôi phục active job sau refresh trình duyệt

Các bước:

1. Tạo job đang chạy.
2. Refresh hoặc đóng/mở lại tab trong cùng browser session.
3. Chờ Job Manager polling.

Kết quả mong đợi:

- [ ] `activeJobId` được khôi phục.
- [ ] UI tiếp tục cập nhật progress.
- [ ] Có thể Stop job sau refresh.
- [ ] Khi job hoàn tất, output được tải lại.
- [ ] Khi job bị hủy, `activeJobId` được xóa.

### P1-10: Coordinator mất kết nối trong lúc nhấn Stop

Các bước:

1. Chạy job.
2. Tắt coordinator.
3. Nhấn Stop.
4. Bật coordinator lại.

Kết quả mong đợi:

- [ ] UI không báo “đã dừng an toàn” khi request chưa được xác nhận.
- [ ] Job ID vẫn được giữ.
- [ ] UI hiển thị lỗi rõ ràng.
- [ ] Sau khi coordinator hoạt động, người dùng có thể Stop lại.
- [ ] Không mất khả năng quản lý job.

### P1-11: Không có agent online thì không tạo job

Các bước:

1. Tắt toàn bộ agent.
2. Nhấn Start.

Kết quả mong đợi:

- [ ] Không gửi request tạo crawl job.
- [ ] UI báo chưa có crawler online.
- [ ] Bản ghi agent offline không làm điều kiện kiểm tra pass nhầm.

### P1-12: Chống upload trùng sau reconnect

Các bước:

1. Agent hoàn thành product nhưng mất mạng trước ACK.
2. Agent reconnect và gửi lại product/result.
3. Lặp lại reconnect thêm một lần.

Kết quả mong đợi:

- [ ] Chỉ một pipeline item được tạo cho mỗi source key.
- [ ] Duplicate được ACK an toàn.
- [ ] Không tạo trùng sản phẩm Shopify.
- [ ] Local spool được xóa sau khi server ACK.

---

## P2 — Edge case và độ bền

### P2-01: Stop job chưa được lease

- [ ] Tạo job rồi Stop ngay lập tức.
- [ ] Task queued chuyển `cancelled` ngay.
- [ ] Job hoàn tất cancellation mà không cần agent ACK.

### P2-02: Stop job đã hoàn thành

- [ ] Stop job `completed` hoặc `partial`.
- [ ] Dữ liệu không thay đổi.
- [ ] Không tạo cancellation giả.

### P2-03: Run again từ job completed hoặc cancelled

- [ ] Tạo job mới với input hợp lệ.
- [ ] Job cũ không bị thay đổi sai trạng thái.
- [ ] Liên kết replacement đúng job ID.

### P2-04: Delete job không tồn tại

- [ ] Gửi DELETE với ID ngẫu nhiên.
- [ ] API trả `404`.
- [ ] UI báo lỗi an toàn và không crash.

### P2-05: Agent gửi lease ID sai

- [ ] Gửi progress, result hoặc cancel ACK với đúng task ID nhưng sai lease ID.
- [ ] Coordinator trả stale/reject.
- [ ] Task không bị thay đổi.

### P2-06: Restart agent nhiều lần với SQLite local

- [ ] Nhận task rồi restart agent nhiều lần trước/sau Pause hoặc Stop local.
- [ ] Pause state không bị mất.
- [ ] Assignment và cancel intent không bị nhân đôi.
- [ ] Task đã discard không chạy lại.

### P2-07: Tombstone hết hạn

- [ ] Dùng test clock hoặc chỉnh tombstone quá hạn.
- [ ] Chạy cleanup.
- [ ] Tombstone cũ được xóa.
- [ ] Không ảnh hưởng job hoặc tombstone còn hạn khác.

### P2-08: Danh sách job lớn

- [ ] Tạo trên 25 job.
- [ ] UI chỉ tải giới hạn đã cấu hình.
- [ ] Polling không gây giật đáng kể.
- [ ] Action tác động đúng job ID.

### P2-09: Chuyển trạng thái agent nhanh

- [ ] Chuyển `online → busy → paused → online → offline`.
- [ ] UI không giữ card stale quá chu kỳ refresh.
- [ ] UI không hiển thị trùng agent.

### P2-10: Pipeline bị kill cưỡng chế

Các bước:

1. Pipeline đang giữ claim.
2. Kill process mà không gửi ACK.
3. Stop job.
4. Khởi động pipeline lại.

Kết quả mong đợi:

- [ ] Job giữ `cancelling`, không báo hoàn tất giả.
- [ ] Claim cũ không tiếp tục ghi dữ liệu.
- [ ] Delete vẫn có thể xóa cưỡng chế job.
- [ ] Pipeline mới không claim item thuộc job đã hủy.

---

## Smoke test nhanh trước khi dùng thực tế

Chạy tối thiểu theo thứ tự:

1. [ ] P0-01 — Stop agent online.
2. [ ] P0-02 — Stop agent offline.
3. [ ] P0-03 — Reconnect sau Stop.
4. [ ] P0-05 — Stop lúc đang ghi Shopify.
5. [ ] P0-06 — Delete job đang chạy.
6. [ ] P0-08 — Stop & Run again.
7. [ ] P1-02 — Chỉ hiển thị agent online.
8. [ ] P1-06 — Stop job có nhiều agent.

## Biên bản kết quả

| Case | Kết quả | Job ID | Cancellation ID | Ghi chú |
| --- | --- | --- | --- | --- |
| P0-01 | Chưa chạy |  |  |  |
| P0-02 | Chưa chạy |  |  |  |
| P0-03 | Chưa chạy |  |  |  |
| P0-04 | Chưa chạy |  |  |  |
| P0-05 | Chưa chạy |  |  |  |
| P0-06 | Chưa chạy |  |  |  |
| P0-07 | Chưa chạy |  |  |  |
| P0-08 | Chưa chạy |  |  |  |
| P0-09 | Chưa chạy |  |  |  |
| P0-10 | Chưa chạy |  |  |  |
| P0-11 | Chưa chạy |  |  |  |
| P0-12 | Chưa chạy |  |  |  |

## Bằng chứng nên lưu cho mỗi case

- Job ID và trạng thái trước/sau thao tác.
- Cancellation ID.
- Danh sách agent/pipeline đang chờ ACK.
- Task ID và lease ID liên quan.
- Log coordinator, agent và pipeline trong khoảng test.
- Số Shopify mutation xảy ra trước và sau thời điểm Stop.
- Ảnh chụp Job Manager nếu hành vi UI không đúng.
