# Kế hoạch triển khai FFP Tool lên VPS với ba container

## 1. Kiến trúc triển khai bắt buộc

> [!IMPORTANT]
> Đây là **ràng buộc kiến trúc bắt buộc**, không phải phương án tham khảo. Agent thực hiện các đầu việc trong file này không được tự đổi số container, tách thêm server, tạo thêm database hoặc triển khai mỗi module thành một service/container riêng.

### 1.1. Topology đích

Toàn bộ FFP Tool phải được build và khởi động bằng đúng một lệnh:

```bash
docker compose up -d --build
```

Lệnh trên phải tạo đúng topology sau:

```text
Một lệnh deploy
docker compose up -d --build
          │
          ├── client container
          │     ├── Nginx
          │     ├── React SPA / Main UI
          │     └── public entry point duy nhất của hệ thống
          │
          ├── database container
          │     └── PostgreSQL 17
          │           └── database phía server duy nhất cho tất cả module
          │
          └── server container
                  ├── Main Gateway :3001 (internal)
                  ├── Crawler Coordinator :8766 (internal)
                  ├── Pinterest POD :8768 (internal)
                  └── Pipeline Worker (không mở port)
```

### 1.2. Ý nghĩa của “một server”

Trong tài liệu này, “một server” có nghĩa là **một `server` container duy nhất được khởi động bởi Docker Compose**. Bên trong container này được phép có nhiều tiến trình con:

1. Main Gateway lắng nghe cổng nội bộ 3001.
2. Crawler Coordinator lắng nghe cổng nội bộ 8766.
3. Pinterest POD lắng nghe cổng nội bộ 8768.
4. Pipeline Worker chạy nền và không lắng nghe cổng.

Các tiến trình con phải được quản lý bởi một process supervisor. Việc có bốn tiến trình con trong cùng `server` container **không** có nghĩa là hệ thống có bốn server container.

### 1.3. Các quy tắc không được thay đổi

- [ ] Chỉ có đúng ba container production: `client`, `database`, `server`.
- [ ] Không tạo container thứ tư cho Gateway, Coordinator, Pinterest, Worker hoặc bất kỳ module nào.
- [ ] Không tạo Compose service riêng cho từng module.
- [ ] Chỉ `client` được publish cổng HTTP/HTTPS ra VPS.
- [ ] Các cổng 3001, 8766, 8768 và 5432 chỉ được truy cập qua Docker network hoặc loopback bên trong container phù hợp.
- [ ] Tất cả module phía server dùng chung một PostgreSQL database trong `database` container.
- [ ] Không dùng SQLite/JSON/local file làm nguồn dữ liệu production chính cho trạng thái quan hệ cần lưu bền vững.
- [ ] File ảnh, ZIP và binary lớn được lưu trong durable volume/object storage; PostgreSQL lưu metadata và path.
- [ ] Main UI không gọi trực tiếp backend port; mọi request từ browser phải đi qua Nginx trong `client`.
- [ ] Một lệnh `docker compose up -d --build` phải khởi động toàn bộ hệ thống, không yêu cầu chạy thêm lệnh để mở một module/backend khác.

### 1.4. Vị trí bắt buộc của các thành phần

| Thành phần | Container bắt buộc | Process/cổng | Có publish ra VPS không? |
| --- | --- | --- | --- |
| Main UI | `client` | Nginx phục vụ React SPA | Có, qua HTTP/HTTPS |
| Nginx reverse proxy | `client` | Cổng 80/443 hoặc cổng client được cấu hình | Có |
| Main Gateway | `server` | `:3001` | Không |
| Crawler Coordinator | `server` | `:8766` | Không |
| Pinterest POD | `server` | `:8768` | Không |
| Pipeline Worker | `server` | Không mở port | Không |
| PostgreSQL | `database` | `:5432` | Không |

### 1.5. Luồng request bắt buộc

```text
Browser / Crawler Agent
          │
          │ HTTPS + WebSocket
          ▼
client container / Nginx
          │
          ├── Gateway API ───────────────► server:3001
          ├── Crawler API/WebSocket ─────► server:8766
          └── Pinterest POD API ─────────► server:8768

server child processes
          │
          └── dữ liệu quan hệ ───────────► database:5432
```

Pipeline Worker giao tiếp nội bộ với Gateway tại `127.0.0.1:3001` và Coordinator tại `127.0.0.1:8766`. Pipeline Worker không được mở public API hoặc listening port riêng.

### 1.6. Cách các module ánh xạ vào kiến trúc

| Module | Nơi chạy trong topology đích |
| --- | --- |
| Main UI | React SPA trong `client` container |
| Amazon Crawler | Crawler Coordinator `:8766` trong `server` container; agent chạy ở máy crawler bên ngoài VPS |
| Product Crawler | Dùng Coordinator hiện có; không tạo server riêng |
| Pinterest POD | Pinterest process `:8768` trong `server` container |
| Auto SEO | Gateway handler và Pipeline Worker trong `server` container |
| SEO Content | Pipeline Worker trong `server` container |
| Custom GPT SEO | Gateway handler và Pipeline Worker trong `server` container |
| Customization Manager | UI trong `client`; backend đi qua Gateway trong `server` |
| Customization Normalizer | Library được Pipeline Worker gọi; không có process riêng |
| Shopify Sync | Library được Pipeline Worker gọi qua Gateway; không có process riêng |
| Module API | Contract/client library; không có process riêng |
| Orchestrator | Library điều phối; không có process riêng |

### 1.7. Những kết quả không được chấp nhận

Agent không được xem task là hoàn thành nếu tạo ra một trong các mô hình sau:

- Bốn hoặc nhiều container production.
- Một container riêng cho Pinterest, Coordinator, Gateway hoặc Pipeline Worker.
- Mỗi module là một Docker service/server riêng.
- Nhiều PostgreSQL database container hoặc tiếp tục dùng nhiều SQLite production độc lập.
- Browser gọi `VPS_IP:3001`, `VPS_IP:8766` hoặc `VPS_IP:8768`.
- Phải chạy thêm `npm run ...`, `python ...` hoặc một Compose file khác sau lệnh deploy chính.
- Chỉ kiểm tra text trong YAML mà chưa khởi động và kiểm chứng container/process thật.

### 1.8. Hướng dẫn cho Agent thực hiện tài liệu này

Khi nhận một đầu việc bên dưới, Agent phải:

1. Giữ nguyên topology tại mục 1.1.
2. Xác định module thuộc `client`, child process nào của `server`, hoặc `database` trước khi sửa code.
3. Không tạo thêm server/container để giải quyết nhanh một module.
4. Cập nhật test để kiểm tra topology và runtime thật, không chỉ dùng regex kiểm tra file cấu hình.
5. Ghi rõ đầu việc đã ảnh hưởng container/process/database nào trong phần handoff.
6. Chỉ đánh dấu hoàn thành khi tiêu chí của module và Definition of Done cuối tài liệu đều không bị vi phạm.

## 2. Danh sách module hiện tại

### 2.1. Module sản phẩm và workflow

| Module                   | Vị trí hiện tại                                          | Trách nhiệm trong production                                                   | Runtime mục tiêu                                       |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Main UI                  | `src/app`, `src/pages`, `src/layouts`                    | Ghép nối ứng dụng React, định tuyến và giao diện vận hành                      | `client`                                               |
| Amazon Crawler           | `src/modules/amazon-crawler`                             | Crawl phân tán, agent, lease, API duyệt sản phẩm và xử lý ảnh                  | Coordinator trong `server`                             |
| Product Crawler          | `src/modules/product-crawler`                            | Client và route UI crawler kiểu cũ/local                                       | Quyết định giữ làm client của Coordinator hoặc loại bỏ |
| Pinterest POD            | `src/modules/pinterest-pod`                              | Xác thực Pinterest, khám phá xu hướng, sản xuất POD và quản lý asset           | Dịch vụ Pinterest trong `server`                       |
| Auto SEO                 | `src/modules/auto-seo` và các Gateway handler            | Workflow SEO tự động và dữ liệu backup để rollback                             | Gateway và Pipeline Worker trong `server`              |
| SEO Content              | `src/modules/seo-content`                                | Phân tích, tạo nội dung SEO, kiểm soát xung đột, checkpoint và chuẩn bị review | Pipeline Worker trong `server`                         |
| Custom GPT SEO           | `src/modules/custom-gpt-seo` và `gateway/custom-gpt-seo` | GPT Action API, queue, delivery, review và đồng bộ                             | Gateway và Pipeline Worker trong `server`              |
| Customization Manager    | `src/modules/customization-manager`                      | Giao diện và thao tác quản lý tùy biến sản phẩm                                | Client kết hợp lời gọi Gateway/Module API              |
| Customization Normalizer | `src/modules/customization-normalizer`                   | Chuẩn hóa sản phẩm crawler/customization trước khi đồng bộ                     | Thư viện của Pipeline Worker                           |
| Shopify Sync             | `src/modules/shopify-sync`                               | Ghi sản phẩm, media và metadata đã chuẩn hóa lên Shopify                       | Thư viện của Pipeline Worker                           |
| Module API               | `src/modules/module-api`                                 | Contract có kiểu dữ liệu cho client Shopify/Gateway                            | Thư viện phía client/server gọi Gateway                |
| Orchestrator             | `src/modules/orchestrator`                               | Sắp xếp và tổng hợp workflow xuyên module                                      | Thư viện phía client/server, không có server độc lập   |

### 2.2. Module hỗ trợ và không thuộc production

| Module   | Vị trí hiện tại        | Quyết định cần đưa ra                                                                    |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Module A | `src/modules/module-a` | Module demo/tham chiếu; loại khỏi navigation production hoặc chính thức đưa vào sản phẩm |
| Module B | `src/modules/module-b` | Module demo/tham chiếu; loại khỏi navigation production hoặc chính thức đưa vào sản phẩm |
| Module C | `src/modules/module-c` | Module demo/tham chiếu; loại khỏi navigation production hoặc chính thức đưa vào sản phẩm |

Các module này không cần container hoặc server riêng.

## 3. Kế hoạch công việc được nhóm theo từng module

Phần này là danh sách công việc chính. Mỗi module trong mục 2.1 có một nhóm riêng để người phụ trách có thể nhận và hoàn thành độc lập. Các đầu việc thật sự dùng chung cho nhiều module nằm ở mục 4.

### 3.1. Module Main UI

**Vai trò:** Cung cấp giao diện React trong container `client`; mọi API đi qua Nginx bằng cùng domain với UI.

- [x] **UI-01:** Cho tất cả API client trên browser sử dụng URL tương đối cùng origin trong production.
- [x] **UI-02:** Xóa mọi giả định browser có thể truy cập trực tiếp `localhost`, cổng 3001, 8766 hoặc 8768 trên VPS.
- [x] **UI-03:** Kiểm tra và sửa các route UI cho Amazon Crawler, Product Crawler, Pinterest POD, Auto SEO, Customization, Custom GPT SEO và SEO Review.
- [x] **UI-04:** Xử lý đầy đủ trạng thái loading, empty, error và reconnect khi từng backend con tạm thời không khả dụng.
- [x] **UI-05:** Bảo đảm không secret nào nằm trong biến `VITE_`, JavaScript bundle hoặc browser storage.
- [x] **UI-06:** Xác định và loại các route Module A/B/C khỏi production navigation nếu chúng chỉ là demo.
- [x] **UI-07:** Thêm smoke test production mở từng màn hình chính qua public client URL.
- [x] **UI-08:** Kiểm tra API 404 trả JSON, còn route UI không tồn tại hiển thị trang Not Found thay vì lỗi proxy.

**Hoàn thành khi:** người dùng chỉ cần truy cập domain của `client`; không màn hình nào yêu cầu gọi trực tiếp một backend port.

### 3.2. Module Amazon Crawler

**Vai trò:** Coordinator quản lý job, agent, lease, WebSocket, product review và image processing trên cổng nội bộ 8766.

- [ ] **CRAWLER-01:** Giữ Crawler Coordinator chạy tại `0.0.0.0:8766` trong `server` container và không publish cổng ra host.
- [ ] **CRAWLER-02:** Bảo đảm toàn bộ API cần thiết được Nginx proxy đúng, gồm health, metrics, crawl jobs, clients, worker, product reviews, image profiles và internal pipeline.
- [ ] **CRAWLER-03:** Giữ WebSocket upgrade cho `/api/v1/worker/connect` qua Nginx.
- [ ] **CRAWLER-04:** Thêm xác thực cho kết nối HTTP/WebSocket của remote crawler agent trước khi deploy công khai.
- [ ] **CRAWLER-05:** Cấu hình CORS production theo domain cụ thể, không dùng wildcard quá rộng.
- [ ] **CRAWLER-06:** Dùng PostgreSQL cho job, lease, agent, product review, lifecycle state và Pinterest distributed job phía Coordinator.
- [ ] **CRAWLER-07:** Kiểm tra lease recovery, retry, cancellation và agent reconnect sau khi Coordinator restart.
- [ ] **CRAWLER-08:** Chuyển file tải về và file xử lý ảnh sang mounted runtime path; PostgreSQL chỉ lưu metadata/path.
- [ ] **CRAWLER-09:** Đặt retention policy cho job hoàn thành, event, cache và file tạm.
- [ ] **CRAWLER-10:** Thêm liveness/readiness endpoint kiểm tra được PostgreSQL và trạng thái Coordinator.
- [ ] **CRAWLER-11:** Thêm end-to-end test với một agent test, một crawl job và một lần restart/recovery.

**Hoàn thành khi:** agent kết nối qua public HTTPS/WebSocket, job sống qua restart và không cần mở trực tiếp cổng 8766.

### 3.3. Module Product Crawler

**Vai trò:** Flow crawler cũ/local; phải được hợp nhất với Amazon Crawler hoặc loại bỏ khỏi production.

- [ ] **PRODUCT-CRAWLER-01:** Xác nhận với product owner đây còn là flow production hay chỉ là legacy.
- [ ] **PRODUCT-CRAWLER-02:** Nếu giữ lại, chuyển toàn bộ thao tác crawl sang submit job cho Crawler Coordinator.
- [ ] **PRODUCT-CRAWLER-03:** Xóa dependency vào backend server riêng hoặc cổng riêng.
- [ ] **PRODUCT-CRAWLER-04:** Nếu loại bỏ, xóa route khỏi production navigation và chỉ rõ Amazon Crawler là flow thay thế.
- [ ] **PRODUCT-CRAWLER-05:** Thêm test xác nhận flow còn được hỗ trợ hoạt động qua Nginx/Coordinator.

**Hoàn thành khi:** module không yêu cầu process, container hoặc database riêng.

### 3.4. Module Pinterest POD

**Vai trò:** Xác thực Pinterest, khám phá xu hướng, sản xuất POD và phục vụ asset trên cổng nội bộ 8768.

- [ ] **POD-01:** Khởi động Pinterest server tại `0.0.0.0:8768` bằng supervisor trong `server` container.
- [ ] **POD-02:** Không publish cổng 8768 ra VPS; mọi request từ browser phải đi qua Nginx.
- [ ] **POD-03:** Chọn bên sở hữu chính thức cho create/status/cancel/log/assets của Pinterest job.
- [ ] **POD-04:** Xóa hoặc ủy quyền rõ route đang chồng lấn giữa Pinterest service và Coordinator.
- [ ] **POD-05:** Giữ endpoint auth, OAuth, trend discovery và production trong Pinterest service, trừ khi có thiết kế mới được tài liệu hóa.
- [ ] **POD-06:** Cấu hình output và temp path dưới `/app/.runtime/pinterest-pod` hoặc durable volume tương đương.
- [ ] **POD-07:** Lưu job metadata bền vững vào PostgreSQL; lưu ảnh/ZIP/binary trong volume hoặc object storage.
- [ ] **POD-08:** Kiểm tra server image có đủ Python package, Chromium, image-processing và rendering dependency cần thiết.
- [ ] **POD-09:** Thiết kế flow xác thực Pinterest phù hợp VPS headless, không phụ thuộc desktop browser trên VPS.
- [ ] **POD-10:** Thêm liveness, readiness và graceful shutdown cho Pinterest server.
- [ ] **POD-11:** Thêm test qua public URL cho auth, discovery, production, status, asset download, cancel và restart recovery.

**Hoàn thành khi:** toàn bộ Pinterest UI hoạt động qua domain client, dữ liệu không mất khi rebuild container và ownership API không còn chồng lấn.

### 3.5. Module Auto SEO

**Vai trò:** Thực thi Auto SEO qua Gateway/Pipeline Worker và giữ snapshot để rollback.

- [ ] **AUTO-SEO-01:** Thay `.local-data/auto-seo.sqlite3` bằng repository PostgreSQL.
- [ ] **AUTO-SEO-02:** Migrate backup, SEO Review record và trạng thái downstream hiện có sang PostgreSQL.
- [ ] **AUTO-SEO-03:** Giữ nguyên unique constraint và idempotency khi migrate.
- [ ] **AUTO-SEO-04:** Chỉ trả response thành công sau khi backup bắt buộc đã được lưu bền vững.
- [ ] **AUTO-SEO-05:** Bảo đảm rollback snapshot sống qua Gateway/server container restart.
- [ ] **AUTO-SEO-06:** Bảo đảm `/api/auto-seo/*` được Nginx chuyển tới Gateway `:3001`.
- [ ] **AUTO-SEO-07:** Thêm integration test PostgreSQL cho run, backup, downstream failure, retry và rollback.

**Hoàn thành khi:** Auto SEO không còn SQLite production và có thể rollback sau một lần restart toàn hệ thống.

### 3.6. Module SEO Content

**Vai trò:** Chạy pipeline SEO, tạo nội dung, quản lý keyword conflict, checkpoint và SEO Review trong Pipeline Worker.

- [ ] **SEO-01:** Chuyển niche cache và persistent review state sang PostgreSQL.
- [ ] **SEO-02:** Chuyển conflict corpus sang PostgreSQL hoặc repository PostgreSQL có transactional reservation.
- [ ] **SEO-03:** Lưu checkpoint B1-B6 gồm input hash, model, prompt version, output, thời gian, retry count và lỗi gần nhất.
- [ ] **SEO-04:** Sau khi Worker restart, tiếp tục từ bước chưa hoàn thành đầu tiên thay vì chạy lại từ B1.
- [ ] **SEO-05:** Lưu SEO output và Review item trước khi đánh dấu completed/phát progress event.
- [ ] **SEO-06:** Thêm timeout riêng theo bước và timeout cho toàn sản phẩm.
- [ ] **SEO-07:** Phân loại lỗi retry/non-retry, thêm jittered backoff và circuit breaker.
- [ ] **SEO-08:** Chỉ truyền variant summary cần thiết vào AI prompt thay vì toàn bộ danh sách variant.
- [ ] **SEO-09:** Xây SEO result cache theo product/image/source/model/prompt/pipeline version.
- [ ] **SEO-10:** Giữ optimistic concurrency với Shopify bằng `shopifyUpdatedAt` và `inputHash` trước khi sync.
- [ ] **SEO-11:** So sánh bộ keyword mới với bộ cũ trước khi thay primary keyword và giải phóng reservation cũ.
- [ ] **SEO-12:** Bảo đảm approved/rejected/synced/rollback state sống qua restart cả ba container.
- [ ] **SEO-13:** Thêm integration test PostgreSQL và crash-recovery test giữa từng bước B1-B6.

**Hoàn thành khi:** pipeline có thể resume chính xác, không mất Review item và không ghi đè dữ liệu Shopify mới hơn.

### 3.7. Module Custom GPT SEO

**Vai trò:** Cung cấp GPT Action API, queue, delivery, review và đồng bộ qua Gateway/Pipeline Worker.

- [ ] **GPT-SEO-01:** Thay `.local-data/custom-gpt-seo.sqlite3` bằng PostgreSQL.
- [ ] **GPT-SEO-02:** Migrate queue, outbox, delivery, review và sync record hiện có.
- [ ] **GPT-SEO-03:** Làm thao tác enqueue/claim/delivery/sync có transaction và an toàn khi Worker restart.
- [ ] **GPT-SEO-04:** Giữ action key riêng cho từng store; không lưu raw secret trong table/log thông thường.
- [ ] **GPT-SEO-05:** Bảo đảm `/api/v1/gpt-seo/*` đi qua Gateway `:3001` và được xác thực đúng.
- [ ] **GPT-SEO-06:** Chỉ cho signed media URL hoạt động qua public HTTPS origin.
- [ ] **GPT-SEO-07:** Thêm integration test PostgreSQL cho enqueue, delivery, retry, review, sync và rollback.

**Hoàn thành khi:** toàn bộ queue/state sống qua restart và Custom GPT không phụ thuộc SQLite.

### 3.8. Module Customization Manager

**Vai trò:** Giao diện và thao tác quản lý tùy biến sản phẩm qua Module API/Gateway.

- [ ] **CUSTOMIZATION-01:** Kiểm tra mọi read/write dùng same-origin Module API/Gateway path.
- [ ] **CUSTOMIZATION-02:** Xác định mọi state cần lưu bền vững; chuyển state đang ở memory/local file sang PostgreSQL.
- [ ] **CUSTOMIZATION-03:** Giữ flow clone/update có tính idempotent.
- [ ] **CUSTOMIZATION-04:** Bảo đảm thao tác đang chạy không bị mất hoặc ghi trùng sau restart.
- [ ] **CUSTOMIZATION-05:** Thêm production integration test đi qua Nginx và Gateway.

**Hoàn thành khi:** module không gọi backend port trực tiếp và không có state production chỉ tồn tại trong memory/browser.

### 3.9. Module Customization Normalizer

**Vai trò:** Chuẩn hóa dữ liệu trước khi Shopify Sync; đây là thư viện của Pipeline Worker.

- [ ] **NORMALIZER-01:** Giữ module dưới dạng library, không khởi động server hoặc container riêng.
- [ ] **NORMALIZER-02:** Validate payload không tin cậy từ Amazon Crawler và Pinterest POD trước khi normalize.
- [ ] **NORMALIZER-03:** Giữ kết quả deterministic để retry không đổi checksum ngoài dự kiến.
- [ ] **NORMALIZER-04:** Chuẩn hóa cùng một contract đầu ra cho Amazon, Pinterest và Shopify product hiện có.
- [ ] **NORMALIZER-05:** Thêm fixture test cho từng nguồn dữ liệu và trường hợp payload lỗi.

**Hoàn thành khi:** cùng input luôn tạo cùng normalized output/checksum và lỗi được chặn trước Shopify Sync.

### 3.10. Module Shopify Sync

**Vai trò:** Ghi sản phẩm, variant, media và metafield lên Shopify từ Pipeline Worker.

- [ ] **SHOPIFY-SYNC-01:** Chỉ thực hiện Shopify write trong Pipeline Worker qua internal Gateway URL.
- [ ] **SHOPIFY-SYNC-02:** Lưu sync attempt, idempotency key, Shopify checkpoint và rollback state trong PostgreSQL.
- [ ] **SHOPIFY-SYNC-03:** Bảo đảm retry không tạo trùng product, variant, media hoặc metafield.
- [ ] **SHOPIFY-SYNC-04:** Kiểm tra optimistic concurrency trước khi ghi đè sản phẩm hiện có.
- [ ] **SHOPIFY-SYNC-05:** Khi đổi product URL/handle, tạo redirect từ URL cũ sang URL mới.
- [ ] **SHOPIFY-SYNC-06:** Kiểm tra throttling, bounded retry và backoff khi gặp Shopify rate limit/5xx.
- [ ] **SHOPIFY-SYNC-07:** Thêm integration test cho success, partial failure, retry, conflict và rollback.

**Hoàn thành khi:** retry/restart không tạo dữ liệu trùng và không âm thầm ghi đè phiên bản Shopify mới hơn.

### 3.11. Module API

**Vai trò:** Contract và client chung để UI/module gọi Main Gateway.

- [ ] **MODULE-API-01:** Dùng public same-origin Gateway path từ browser.
- [ ] **MODULE-API-02:** Dùng `http://127.0.0.1:3001` từ tiến trình trong server container.
- [ ] **MODULE-API-03:** Xóa fallback có thể gửi request production tới localhost của máy người dùng/developer.
- [ ] **MODULE-API-04:** Giữ authentication header chứa secret ở phía server; browser chỉ nhận credential phù hợp với operator flow.
- [ ] **MODULE-API-05:** Chuẩn hóa error contract để UI phân biệt auth, validation, network, conflict và retryable error.
- [ ] **MODULE-API-06:** Thêm contract test cho đường Client Nginx → Gateway → Shopify.

**Hoàn thành khi:** tất cả consumer dùng một contract thống nhất và không bypass Gateway trong production.

### 3.12. Module Orchestrator

**Vai trò:** Điều phối thứ tự, song song hóa và tổng hợp kết quả xuyên module; không phải server độc lập.

- [ ] **ORCHESTRATOR-01:** Giữ Orchestrator dưới dạng library, không tạo port/process/container riêng.
- [ ] **ORCHESTRATOR-02:** Chỉ gọi public API của từng module, không import file nội bộ của module khác.
- [ ] **ORCHESTRATOR-03:** Truyền workflow ID, job ID và idempotency key xuyên suốt Gateway, Coordinator, Worker và PostgreSQL.
- [ ] **ORCHESTRATOR-04:** Tài liệu hóa bước nào chạy tuần tự, bước nào được chạy song song và bước nào bắt buộc checkpoint.
- [ ] **ORCHESTRATOR-05:** Không giữ trạng thái workflow bền vững chỉ trong memory.
- [ ] **ORCHESTRATOR-06:** Thêm test failure/retry/restart tại từng ranh giới module.

**Hoàn thành khi:** workflow có thể trace end-to-end và tiếp tục an toàn sau restart.

## 4. Công việc hạ tầng dùng chung cho tất cả module

Các đầu việc dưới đây không thuộc riêng một module nên không được lặp lại trong từng nhóm ở mục 3.

### 4.1. Docker Compose và ba container

- [ ] **INFRA-COMPOSE-01:** Quy định root `docker-compose.yml` là manifest production chính thức duy nhất.
- [ ] **INFRA-COMPOSE-02:** Đánh dấu, di chuyển hoặc loại bỏ `compose.prod.yaml` và Compose riêng của Coordinator để không còn topology production mâu thuẫn.
- [ ] **INFRA-COMPOSE-03:** Bảo đảm `docker compose config --services` chỉ trả `database`, `server`, `client`.
- [ ] **INFRA-COMPOSE-04:** Xóa host port mapping 3001, 5432, 8766, 8768; chỉ publish client HTTP/HTTPS.
- [ ] **INFRA-COMPOSE-05:** Thêm resource limit, log rotation, volume và `restart: unless-stopped` cho ba service.
- [ ] **INFRA-COMPOSE-06:** Cung cấp `.env.example` production không chứa secret và tài liệu hóa bước tạo `.env`.
- [ ] **INFRA-COMPOSE-07:** Bảo đảm `docker compose up -d --build` là lệnh duy nhất để khởi động toàn hệ thống sau khi cấu hình `.env`.

### 4.2. Server container, Main Gateway và process supervisor

- [ ] **INFRA-SERVER-01:** Sửa lỗi image dùng `npm install --omit=dev` nhưng runtime cần `tsx`.
- [ ] **INFRA-SERVER-02:** Ưu tiên compile Gateway/Pipeline Worker TypeScript thành JavaScript; hoặc chuyển `tsx` thành production dependency.
- [ ] **INFRA-SERVER-03:** Dùng `npm ci` và multi-stage Docker build.
- [ ] **INFRA-SERVER-04:** Dùng `supervisord`, `s6-overlay` hoặc supervisor tương đương để chạy Gateway, Coordinator, Pinterest và Worker.
- [ ] **INFRA-SERVER-05:** Chuyển tiếp signal, graceful shutdown, restart policy và log riêng cho từng child process.
- [ ] **INFRA-SERVER-06:** Khởi động Pipeline Worker mặc định trong topology production.
- [ ] **INFRA-SERVER-07:** Ngăn Worker mở Gateway thứ hai; Worker phải gọi Gateway hiện có tại `127.0.0.1:3001`.
- [ ] **INFRA-SERVER-08:** Gateway bind `0.0.0.0:3001` trong container nhưng không publish ra host.
- [ ] **INFRA-SERVER-09:** Persist mutable store registry/control-plane state của Gateway vào PostgreSQL.
- [ ] **INFRA-SERVER-10:** Thêm aggregate readiness kiểm tra Gateway, Coordinator, Pinterest, Worker heartbeat và PostgreSQL.

### 4.3. Nginx reverse proxy

| Public path                                                          | Backend nội bộ                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/api/shopify`, `/api/stores/*`, `/api/auto-seo/*`, `/api/proxy/*`   | Gateway `server:3001`                                           |
| `/api/v1/gpt-seo/*`, `/api/seo-review/*`                             | Gateway `server:3001`                                           |
| `/api/v1/*` thuộc crawler/review/image/pipeline/worker               | Coordinator `server:8766`                                       |
| `/api/pinterest-pod/handover-seo`, `/api/pinterest-pod/sync-shopify` | Gateway `server:3001`                                           |
| Các `/api/pinterest-pod/*` còn lại                                   | Pinterest `server:8768` hoặc Coordinator theo ownership đã chốt |

- [ ] **INFRA-NGINX-01:** Viết rule cụ thể theo bảng trên; route API không được fallback về SPA.
- [ ] **INFRA-NGINX-02:** Giữ WebSocket upgrade, SSE và timeout dài cần thiết.
- [ ] **INFRA-NGINX-03:** Đặt request body limit phù hợp với upload ảnh/POD asset.
- [ ] **INFRA-NGINX-04:** Thêm proxy integration test cho ít nhất một endpoint của mỗi backend.

### 4.4. PostgreSQL, migration, backup và restore

- [ ] **INFRA-DB-01 — Tạo backup:** Chuẩn hóa một PostgreSQL database và migration chạy trước readiness; import SQLite/JSON phải idempotent, có version, backup nguồn cũ và đối chiếu dữ liệu. Tạo custom-format dump bằng `pg_dump --format=custom --no-owner --no-privileges` vào `*.dump.part`, chỉ atomic rename khi exit code bằng 0; shell dùng `set -Eeuo pipefail`, `trap`, `flock`, PowerShell kiểm tra `$LASTEXITCODE`. Binary lớn nằm trong durable volume/object storage, PostgreSQL chỉ lưu metadata/path.
- [ ] **INFRA-DB-02 — Kiểm tra tính toàn vẹn:** Validate dump bằng `pg_restore --list`, tạo SHA-256 và manifest gồm deployment/database/PostgreSQL/migration version, thời điểm UTC, kích thước và tên file; không ghi credential vào manifest/log và chỉ báo thành công khi dump cùng asset backup hợp lệ.
- [ ] **INFRA-DB-03 — Cấu hình Google Drive:** Cài `rclone` trên VPS host, không thêm container; dùng OAuth client riêng, ưu tiên scope `drive.file`, hỗ trợ authorize cho VPS headless và lưu config ngoài repository với quyền `0600`. Tham chiếu tài liệu chính thức [Google Drive](https://rclone.org/drive/).
- [ ] **INFRA-DB-04 — Mã hóa backup:** Tạo crypt remote bọc đúng thư mục backup trên Drive, mã hóa nội dung/tên file và bảo vệ `rclone.conf`; lưu password/salt phục hồi tách khỏi Google Drive và VPS. Tham chiếu tài liệu chính thức [rclone crypt](https://rclone.org/crypt/).
- [ ] **INFRA-DB-05 — Upload và retention:** Nhận `RCLONE_CONFIG`, `RCLONE_BACKUP_REMOTE`, `DEPLOYMENT_ID`; dùng `copy/copyto` thay vì `sync` để tải dump/checksum/manifest/asset lên `<remote>/<deployment-id>/database/YYYY/MM/DD/`; xác minh object/kích thước bằng `cryptcheck` hoặc tải về kiểm SHA-256, rồi áp dụng retention riêng như 7 daily/4 weekly/12 monthly.
- [ ] **INFRA-DB-06 — Lập lịch:** Chạy backup script đã version hóa bằng `systemd timer` trên VPS host, kèm `flock`, timeout, log và cảnh báo lỗi; không tạo container thứ tư.
- [ ] **INFRA-DB-07 — Restore:** Nhận local path hoặc Google Drive backup ID, tải vào thư mục tạm và xác minh checksum/manifest/dump; tạo safety backup, kiểm tra disk/deployment/database, yêu cầu xác nhận, dừng `server`/`client`, giữ `database`, chạy `pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-privileges`, rồi khởi động lại, chờ readiness và kiểm tra migration/bảng/record; rollback safety backup nếu lỗi.
- [ ] **INFRA-DB-08 — Kiểm thử round-trip:** Tự động test lỗi dump/checksum/upload/download/restore và định kỳ restore từ Google Drive vào deployment sạch, gồm PostgreSQL lẫn asset; tài liệu hóa rotate/revoke OAuth, retention và phục hồi khi mất VPS. Test regex không phải bằng chứng backup/restore thật.

### 4.5. Pipeline Worker

- [ ] **INFRA-WORKER-01:** Chạy đúng một nhóm Worker logic, không mở listening port.
- [ ] **INFRA-WORKER-02:** Dùng `127.0.0.1:8766` cho Coordinator và `127.0.0.1:3001/api/shopify` cho Gateway.
- [ ] **INFRA-WORKER-03:** Giới hạn concurrency theo CPU, RAM và quota API.
- [ ] **INFRA-WORKER-04:** Phát heartbeat để aggregate readiness kiểm tra.
- [ ] **INFRA-WORKER-05:** Khi shutdown, ngừng claim việc mới, hoàn thành hoặc trả lease an toàn rồi mới thoát.
- [ ] **INFRA-WORKER-06:** Persist checkpoint trước khi acknowledge thành công.
- [ ] **INFRA-WORKER-07:** Test crash recovery giữa mọi pipeline stage quan trọng.

### 4.6. Bộ cài remote crawler agent một lệnh

- [ ] **INFRA-AGENT-01 — Chọn nền tảng hỗ trợ:** Ưu tiên Windows x64 vì code đã có PyInstaller, bundled Chromium, Inno Setup, tray và `%PROGRAMDATA%`; Linux/macOS chỉ ở mức experimental tới khi có artifact, launcher/`systemd` và clean-machine test tương đương.
- [ ] **INFRA-AGENT-02 — Build artifact:** Dùng `npm run build:agent:installer` để đóng gói executable, Python runtime, `ms-playwright` và Inno installer; truyền version vào `AppVersion`/`OutputBaseFilename` để tạo `FFP-Amazon-Crawler-Setup-<version>.exe`. Máy crawler không cần Git, repository, Python, pip hoặc tải Chromium.
- [ ] **INFRA-AGENT-03 — Ký và publish artifact:** Ký Authenticode, tạo SHA-256 và publish installer cùng `latest.json` lên GitHub Release/object storage/CDN HTTPS; manifest chứa version, URL, hash, size, signer thumbprint, minimum protocol/server version. CI fail nếu thiếu signature/runtime/browser/artifact; không nhét artifact vào client image đang loại `artifacts/`.
- [ ] **INFRA-AGENT-04 — Viết bootstrap một lệnh:** Giữ `/install-agent.ps1` là bootstrap một dòng, tải manifest/installer vào `%TEMP%` và không phụ thuộc current directory/source repo; bắt buộc HTTPS, file `*.part`, kiểm tra HTTP/size/hash/allowlisted signer rồi mới cài, xóa file tạm và thoát non-zero mà không phá bản cũ nếu lỗi.
- [ ] **INFRA-AGENT-05 — Cấu hình và xác thực agent:** Thêm `/SERVERURL=`, `/DISPLAYNAME=` và enrollment token cho silent install, reject placeholder/non-HTTPS URL; server đổi token ngắn hạn thành credential dài hạn, lưu bằng ACL hạn chế và xác thực WebSocket, không để secret trong URL, command history, artifact hoặc log.
- [ ] **INFRA-AGENT-06 — Cài đặt, upgrade và rollback:** Giữ config/proxy/browser profile/`agent.sqlite3` tại `%PROGRAMDATA%\FFP Amazon Crawler`; dùng HKCU Run/Scheduled Task đúng user khi tray/CAPTCHA cần desktop; install/upgrade phải idempotent, không tạo process/autostart trùng, giữ dữ liệu khi uninstall và rollback binary nếu health check bản mới lỗi.
- [ ] **INFRA-AGENT-07 — Xác minh agent online:** Chỉ báo thành công sau khi chạy `--check-config`, khởi động process và poll API có xác thực `/api/v1/clients` thấy đúng agent có `isConnected=true`, trạng thái `online`, `busy` hoặc `waiting_captcha`; quá timeout trả exit code lỗi và hướng dẫn khắc phục.
- [ ] **INFRA-AGENT-08 — Clean-machine test:** Trên Windows không có Git/Python/Chromium, chạy đúng một dòng rồi xác minh signature/hash, silent install, autostart, WSS qua public domain, nhận job, restart/reconnect, upgrade/rollback/uninstall; chỉ công nhận Linux production khi vượt cùng bộ tiêu chí bằng artifact riêng, không dựa vào source-tree `pip install`.

### 4.7. Bảo mật, logging và vận hành VPS (xem xét khi làm)

- [ ] **INFRA-OPS-01:** Cấu hình DNS và HTTPS tại client Nginx hoặc lớp ngoài VPS/Cloudflare mà không thêm container thứ tư.
- [ ] **INFRA-OPS-02:** Chỉ mở cổng 22 và 80/443 trên firewall theo nhu cầu.
- [ ] **INFRA-OPS-03:** Chạy container bằng non-root user khi phù hợp.
- [ ] **INFRA-OPS-04:** Bảo vệ `.env`/secret bằng quyền file hoặc secret mechanism phù hợp.
- [ ] **INFRA-OPS-05:** Rotate Gateway, operator, crawler agent và GPT action credential trước launch.
- [ ] **INFRA-OPS-06:** Dùng structured log có request/job/workflow ID và tên module; không log token/cookie/payload nhạy cảm.
- [ ] **INFRA-OPS-07:** Theo dõi CPU, RAM, disk, PostgreSQL, Docker log và dung lượng asset.
- [ ] **INFRA-OPS-08:** Tài liệu hóa deploy, rollback, restore, xem log và xử lý sự cố.

## 5. Thứ tự triển khai và phụ thuộc giữa các nhóm

### Giai đoạn 0: Làm ba container khởi động và giao tiếp đúng

1. Hoàn thành `INFRA-COMPOSE-*`, `INFRA-SERVER-*` và `INFRA-NGINX-*`.
2. Hoàn thành `UI-01` đến `UI-04`.
3. Hoàn thành phần runtime/routing của `CRAWLER-*` và `POD-*`.
4. Hoàn thành `INFRA-WORKER-01` đến `INFRA-WORKER-05`.
5. Chạy container smoke test thật.

### Giai đoạn 1: Hợp nhất dữ liệu vào PostgreSQL

1. Hoàn thành phần chuẩn hóa/migration trong `INFRA-DB-01` và các đầu việc migrate của từng module.
2. Migrate theo thứ tự: Amazon Crawler → Auto SEO → Custom GPT SEO → SEO Content → Gateway control plane.
3. Hoàn thành phần persistence của Customization Manager và Shopify Sync.
4. Hoàn thành backup/restore `INFRA-DB-02` đến `INFRA-DB-08`.

### Giai đoạn 2: Hoàn thiện độ bền, bảo mật và vận hành

1. Hoàn thành test restart/retry của từng module.
2. Hoàn thành bộ cài agent `INFRA-AGENT-*`.
3. Hoàn thành bảo mật/vận hành `INFRA-OPS-*`.
4. Diễn tập deploy VPS sạch và disaster recovery đầy đủ.

## 6. Các cổng kiểm chứng bắt buộc

### 6.1. Kiểm tra source

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run build:mock` khi thay đổi mock/runtime
- [ ] Test Python của Coordinator và Pinterest

### 6.2. Kiểm tra container

- [ ] `docker compose config --services` chỉ trả `database`, `server`, `client`.
- [ ] `docker compose build --no-cache` thành công trên môi trường sạch.
- [ ] `docker compose up -d --build --wait` thành công trên môi trường sạch.
- [ ] `docker compose ps` báo cả ba container healthy.
- [ ] Process inspection cho thấy Gateway, Coordinator, Pinterest và Worker chỉ nằm trong `server` container.
- [ ] External port scan xác nhận chỉ HTTP/HTTPS của `client` được mở.

### 6.3. Kiểm tra end-to-end theo module

- [ ] Main UI: tải và điều hướng được qua public domain.
- [ ] Module API/Gateway: health và Shopify read có xác thực thành công.
- [ ] Amazon Crawler: agent kết nối qua WebSocket và hoàn thành một crawl job.
- [ ] Product Crawler: flow giữ lại hoạt động qua Coordinator hoặc đã được loại khỏi production.
- [ ] Pinterest POD: auth/discovery/production/asset hoạt động qua Nginx.
- [ ] Auto SEO: backup và rollback sống qua server restart.
- [ ] SEO Content: resume từ checkpoint và giữ SEO Review state sau restart.
- [ ] Custom GPT SEO: queue/delivery/review sống qua restart.
- [ ] Customization Manager: clone/update không bị trùng sau retry.
- [ ] Customization Normalizer: cùng input tạo cùng output/checksum.
- [ ] Shopify Sync: retry không tạo trùng và conflict không bị ghi đè.
- [ ] Orchestrator: workflow ID trace được xuyên suốt các module.
- [ ] Backup/restore: deployment sạch khôi phục được PostgreSQL và asset.

## 7. Definition of Done cuối cùng

Kiến trúc chỉ hoàn thành khi thỏa mãn tất cả điều kiện sau:

- Một lệnh `docker compose up -d --build` khởi động toàn bộ ứng dụng trên VPS đã cấu hình.
- Chạy đúng ba container: `client`, `server`, `database`.
- Gateway, Coordinator, Pinterest POD và Pipeline Worker là các tiến trình con healthy của `server` container.
- Chỉ `client` có thể truy cập công khai.
- Mỗi module trong mục 2.1 đã hoàn thành toàn bộ checklist thuộc nhóm của mình.
- Mọi trạng thái quan hệ bền vững phía server nằm trong một PostgreSQL database.
- Generated asset nằm trong durable volume/object storage và có trong quy trình recovery.
- Backup/restore đã vượt qua round-trip test thực tế.
- Crawler agent cài trên máy sạch bằng một lệnh và kết nối an toàn.
- Không còn production manifest khác mâu thuẫn với topology ba container chính thức.
