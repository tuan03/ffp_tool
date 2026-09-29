# Hướng dẫn Vận hành & Triển khai Thống nhất (3 Containers & 1-Command Crawler Agent)

Tài liệu này hướng dẫn chi tiết về cấu trúc triển khai chuẩn hóa của **FFP Tool** với **3 container duy nhất** và quy trình cài đặt **Agent Crawler 1 lệnh duy nhất**.

---

## PHẦN 1: Kiến trúc Triển khai 3 Container Duy Nhất

Hệ thống được gói gọn trong đúng 3 container phối hợp chặt chẽ qua file gốc [docker-compose.yml](file:///D:/CODE/Code_Clone/ffp_tool/docker-compose.yml):

```text
[ Người dùng / Trình duyệt / Crawler ]
                   ↓
        +----------------------+
        |      1. CLIENT       | (Port 80/3010)
        | (Nginx + React SPA)  |
        +----------------------+
          │                 │
 (Reverse Proxy API)   (Proxy WebSocket & Coordinator)
          ↓                 ↓
        +----------------------+
        |      2. SERVER       |
        |   (Unified Backend)  |
        | - Node.js Gateway    | (Port 3001)
        | - Crawler Coord      | (Port 8766)
        | - Pipeline Worker    |
        +----------------------+
                   ↓
        +----------------------+
        |     3. DATABASE      | (Port 5432)
        |   (PostgreSQL 17)    |
        +----------------------+
```

### 1.1. Chi tiết 3 Container

1. **`database` (PostgreSQL 17 Alpine)**:
   - Cơ sở dữ liệu tập trung duy nhất cho toàn bộ hệ thống (lưu trữ crawler jobs, worker leases, product history, SEO keywords corpus...).
   - Lưu trữ bền vững trên Docker Volume `ffp_postgres_data`.
   - Có healthcheck tự động (`pg_isready`).

2. **`server` (Unified Backend Container)**:
   - Chạy toàn bộ các service backend của mọi module:
     - **FFP Gateway (Node.js 22)**: Xử lý Shopify API GraphQL, Custom GPT SEO Actions (`/api/v1/gpt-seo/...`), Store Registry, Auto SEO, Pinterest POD Handover, Proxy checker.
     - **Crawler Coordinator (Python FastAPI)**: Quản lý hàng đợi cào, phân phối tác vụ cho worker qua WebSocket (`/api/v1/worker/connect`), xử lý kết quả streaming.
     - **Shopify Pipeline Worker**: Tiến trình ngầm xử lý hàng đợi đẩy sản phẩm lên Shopify.
   - Kết nối trực tiếp với container `database` qua biến môi trường `AMAZON_COORDINATOR_DATABASE_URL=postgresql+psycopg://ffp_tool:...@database:5432/ffp_tool`.

3. **`client` (Frontend Web Client Container)**:
   - Chứa bản build tĩnh hoàn chỉnh của React 19 + Vite + Tailwind CSS.
   - Phục vụ người dùng qua Web Server **Nginx Alpine**:
     - Phục vụ giao diện người dùng SPA mượt mà (`try_files $uri $uri/ /index.html;`).
     - Tự động reverse proxy các API sang container `server` (cổng 3001 và 8766).
     - Hỗ trợ kết nối WebSocket hai chiều cho crawler worker (`/api/v1/worker/connect`).
     - Phục vụ sẵn các file cài đặt Agent (`/install-agent.ps1`, `/install-agent.sh`, `/cai-agent.bat`).

---

### 1.2. Khởi chạy toàn bộ hệ thống bằng 1 lệnh duy nhất

Tại thư mục gốc của dự án, chạy lệnh:

```bash
docker compose up -d --build
```

Hệ thống sẽ tự động:
1. Khởi động PostgreSQL và chờ database sẵn sàng (healthy).
2. Build và khởi động unified `server`.
3. Build và khởi động Nginx `client`.
4. Toàn bộ website truy cập được ngay tại `http://localhost:3010` (hoặc domain cấu hình).

---

### 1.3. Sao lưu & Khôi phục Database (Backup & Restore)

#### A. Sao lưu Database (Backup)
- **Trên Linux / VPS**:
  ```bash
  ./scripts/backup-db.sh
  ```
- **Trên Windows (PowerShell)**:
  ```powershell
  .\scripts\backup-db.ps1
  ```
*Kết quả:* Tạo ra file sao lưu timestamped trong thư mục `backups/`, ví dụ `backups/ffp_backup_20260929_120000.sql.gz`.

#### B. Khôi phục Database (Restore)
- **Trên Linux / VPS**:
  ```bash
  ./scripts/restore-db.sh backups/ffp_backup_20260929_120000.sql.gz
  ```
- **Trên Windows (PowerShell)**:
  ```powershell
  .\scripts\restore-db.ps1 -BackupFile backups\ffp_backup_20260929_120000.sql
  ```

---

## PHẦN 2: Cài đặt Agent Crawler bằng 1 Lệnh Duy Nhất

Để máy người cào (máy nhân viên / máy cá nhân) có thể kết nối vào hệ thống và nhận việc cào Amazon & Pinterest:

### Cách 1: Chạy file cài đặt nhanh (Windows)
Tải `cai-agent.bat` từ server rồi mở file. Có thể truyền địa chỉ server làm tham số:
```text
https://ffp.b6-team.site/cai-agent.bat
```
```cmd
cai-agent.bat https://ffp.b6-team.site
```

Trong cùng Wi-Fi, thay domain bằng IP LAN của máy chạy Docker:
```cmd
cai-agent.bat http://192.168.1.10:3010
```

### Cách 2: Chạy trực tiếp qua 1 dòng lệnh PowerShell (Remote 1-Liner)
Người cào mở PowerShell trên Windows và dán 1 dòng lệnh duy nhất:
```powershell
irm https://ffp.b6-team.site/install-agent.ps1 | iex
```

Trong cùng Wi-Fi, người cài dùng địa chỉ LAN được in ra bởi `npm run dev` hoặc IP của máy chạy Docker:

```powershell
$env:FFP_SERVER_URL="http://192.168.1.10:3010"; irm "$env:FFP_SERVER_URL/install-agent.ps1" | iex
```

Máy chạy Docker phải cho phép kết nối TCP vào cổng `3010` trong Windows Firewall. Máy khác Wi-Fi dùng được khi domain HTTPS công khai trỏ tới VPS đang chạy FFP Tool; không cần mở port trên máy worker.

### Cách 3: Chạy trên Linux / macOS
```bash
curl -sSL https://ffp.b6-team.site/install-agent.sh | bash
```

### Bộ cài đặt tự động làm những gì?
1. **Kiểm tra Python:** Tự kiểm tra xem máy đã cài Python >= 3.10 chưa. Nếu chưa có, trên Windows sẽ tự động dùng `winget` để cài Python 3.11.
2. **Tải mã Agent:** Tải gói source tối thiểu từ chính FFP server và xác minh SHA-256 trước khi giải nén.
3. **Khởi tạo môi trường ảo (.venv):** Độc lập hoàn toàn, không gây ảnh hưởng tới các phần mềm khác trên máy.
4. **Cài đặt thư viện:** Tự động cài toàn bộ packages cần thiết (`playwright`, `websockets`, `pillow`, `pystray`, v.v.).
5. **Cài đặt Chromium:** Tự động tải trình duyệt Chromium chuẩn của Playwright.
6. **Khởi tạo cấu hình:** Tự sinh file `config/amazon-crawler-agent.json` trỏ về server đã cung cấp.
7. **Tạo launcher tiện lợi:** Tạo sẵn `chay-agent.bat` trên Windows hoặc `chay-agent.sh` trên Linux/macOS.

---

## PHẦN 3: Đăng nhập Pinterest cho Crawler Agent

Pinterest yêu cầu phiên đăng nhập (session cookies) để cào ảnh chất lượng cao và cuộn vô tận mà không bị chặn bot hay bắt đăng nhập.

### Cách 1: Đăng nhập 1-click từ máy Worker (Khuyên dùng)
Trên máy đã cài Crawler Agent:
1. Nhấp đúp vào file:
   ```text
   dang-nhap-pinterest.bat
   ```
   *(Trên Linux/macOS: chạy `bash scripts/login-pinterest.sh`)*
2. Một cửa sổ trình duyệt Chromium sẽ tự động mở trang đăng nhập Pinterest.
3. Bạn tiến hành đăng nhập tài khoản Pinterest (bằng Google, email/mật khẩu, v.v.).
4. Ngay khi đăng nhập thành công, cửa sổ sẽ **tự động đóng lại** và lưu cookie phiên vào thư mục an toàn `.pinterest_browser_profile/`.
5. Từ thời điểm này, Agent (`chay-agent.bat`) sẽ tự động sử dụng phiên đã đăng nhập để cào dữ liệu mượt mà mà không bao giờ bị hỏi lại.

### Cách 2: Đăng nhập từ Giao diện Web Pinterest POD Studio
Nếu bạn đang chạy ứng dụng trực tiếp trên máy local:
1. Tại góc trên bên phải màn hình Studio, bấm vào nút **`🔑 Xác thực Pinterest`** (hoặc nút **`Crawler chưa login`**).
2. Chuyển sang tab **`🌐 Trình duyệt Cào ảnh`**.
3. Bấm **"Mở cửa sổ đăng nhập Pinterest"**.
4. Trình duyệt sẽ mở ra để bạn đăng nhập và tự động lưu phiên tương tự Cách 1.
