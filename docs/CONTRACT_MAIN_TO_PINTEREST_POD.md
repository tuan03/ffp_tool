# TÀI LIỆU TOÀN DIỆN CHO MODULE MAIN: GIAO DIỆN & HỢP ĐỒNG API PINTEREST POD

> **Dành cho:** Người phụ trách Module **MAIN** (UI/Giao diện chính, Luồng người dùng & Tích hợp API)  
> **Phiên bản:** v3.1 (Đã rà soát & chuẩn hóa 100% theo Backend thực tế)  
> **Ngày cập nhật:** 21/09/2026  
> **Nguồn tham chiếu gốc:** `D:\CODE\Code_Clone\tool_shopify\ui\crawler-ui.html` (#pinterestPodSection)  

---

## 1. Cơ chế Đường dẫn Tương đối (Relative URL & File Path)

Hệ thống được thiết kế theo chuẩn **Đường dẫn tương đối (Relative Path)** để các module trong cùng dự án làm việc mượt mà mà không lo xung đột cổng, đổi domain hay lỗi CORS:

### 1.1. Đường dẫn tương đối trên Giao diện Web (Web Relative URL)
* **Quy chuẩn**: Mọi tài nguyên ảnh và file in đều được truy cập qua đường dẫn tương đối:
  ```text
  /api/pinterest-pod/assets/:jobId/:filename
  ```
* **Lợi ích**:
  - Khi render thẻ `<img>`: `<img src="/api/pinterest-pod/assets/job_123/mockup.jpg" />`.
  - Không hardcode domain hay port `http://127.0.0.1:8768`, giúp giao diện chạy ở bất kỳ cổng nào (5173, 3000, production) đều không bị gãy link hay lỗi CORS (do Vite proxy đảm nhiệm).

### 1.2. Đường dẫn file tương đối trên Ổ đĩa (Local File Path)
* Dành cho các module cùng dự án muốn đọc/ghi trực tiếp file trên ổ đĩa (Node.js `fs` hoặc Python) mà không cần tốn thời gian tải qua HTTP:
  - Thư mục thành phẩm: `temp/pinterest_pod/:jobId/:filename` hoặc `data/pinterest_pod/output/:runId/:filename`
* Giúp các module xử lý nhanh gấp 10 lần nhờ truy xuất file cục bộ trực tiếp.

### 1.3. Cơ chế Nạp Ảnh Tham Chiếu từ MAIN (`referenceImages`)
MAIN có thể truyền 1 trong 3 định dạng sau vào trường `url`, backend đều tự động xử lý mượt mà:
1. **Web Relative URL**: `/mockups/room_01.jpg` (ảnh đặt trong thư mục `public/` của dự án).
2. **Local Relative Path**: `data/references/room_01.jpg` (file ảnh lưu trên đĩa trong dự án).
3. **Base64 Data URL**: `data:image/jpeg;base64,...` (khi người dùng kéo thả file trực tiếp từ máy tính vào trình duyệt).

---

## 2. Quản lý Kết nối & Đăng nhập Pinterest (Auth Logic)

Để cào được ảnh full HD mà không bị Pinterest chặn IP / dính Captcha, hệ thống lưu session cookie vĩnh viễn trong profile trình duyệt.

### 2.1. Kiểm tra trạng thái đăng nhập
MAIN gọi khi tải trang để hiển thị Badge trạng thái:
* **Method:** `GET`
* **URL:** `/api/pinterest-pod/auth-status`
* **Response:**
  ```json
  {
    "ok": true,
    "logged_in": true,
    "browser_logged_in": true,
    "status_text": "Pinterest: Đã đăng nhập"
  }
  ```

### 2.2. Bật cửa sổ đăng nhập Pinterest
Khi `logged_in === false`, MAIN hiển thị nút **"🔑 Đăng nhập Pinterest"**. Khi người dùng click:
* **Method:** `POST`
* **URL:** `/api/pinterest-pod/launch-login`
* **Body:** `{"timeout": 600}`
* **Hoạt động:** Backend tự bật một cửa sổ Chromium. Người dùng đăng nhập tài khoản Pinterest trên cửa sổ đó 1 lần duy nhất $\rightarrow$ Session cookie được lưu lại vĩnh viễn trên máy, những lần cào sau không cần đăng nhập lại.

---

## 3. Bản vẽ Khung Giao diện Chi tiết (UI/UX Wireframe)

Giao diện Pinterest POD Studio trên MAIN được thiết kế bám sát 100% UI tham chiếu thực chiến, đồng thời bổ sung thêm khu vực kéo thả ảnh phòng tham chiếu:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [1. Quét Trend] ➔ [2. Duyệt Ứng Viên] ➔ [3. Thành Phẩm]   │  Status: 🟢 Pinterest Đã kết nối  │
├────────────────────────────────┬───────────────────────────────────────────────────────────────┤
│  CỘT TRÁI: FORM KHỞI TẠO       │  CỘT PHẢI: TIẾN ĐỘ & LIVE LOGS                                 │
│                                │                                                               │
│  Từ khóa xu hướng Pinterest *  │  Tiến độ quy trình POD: [ 40% ]                               │
│  [ vintage distressed rug    ] │  [=================>                       ]                  │
│  Chips: [Rug] [Boho] [Nordic]  │                                                               │
│                                │  ✓ 1. Pinterest Trends: Quét từ khóa hot                      │
│  Loại sản phẩm:                │  ✓ 2. Candidate Review: Chờ duyệt 15 mẫu                      │
│  [ Thảm trải sàn (Rug)    ▼ ]  │  ○ 3. CMYK 300DPI: Chuẩn bị file in                           │
│                                │  ○ 4. AI Mockup: Tạo bối cảnh sống động                       │
│  Ảnh phòng tham chiếu (1-5 ảnh)│                                                               │
│  ┌───────────────────────────┐ │  ▼ Live Service Logs (18 dòng)                                │
│  │ 📁 Kéo thả ảnh phòng mẫu  │ │  ┌─────────────────────────────────────────────────────────┐  │
│  │    hoặc click để chọn file│ │  │ [15:24:02] Bắt đầu cào Pinterest niche: vintage rug...  │  │
│  └───────────────────────────┘ │  │ [15:24:08] AI Vision: Lọc thành công 15 mẫu đạt chuẩn... │  │
│  Preview: [Ảnh 1 ✕] [Ảnh 2 ✕]  │  │ [15:24:12] Sẵn sàng duyệt mẫu ứng viên.                 │  │
│                                │  └─────────────────────────────────────────────────────────┘  │
│  [▶ Bắt đầu cào ảnh]  [Dừng]   │                                                               │
├────────────────────────────────┴───────────────────────────────────────────────────────────────┤
│  GIAI ĐOẠN 2: LƯỚI DUYỆT & CHỌN MẪU ỨNG VIÊN (Hiện ra khi status = "ready_for_review")         │
│                                                                                                │
│  🔍 Duyệt & Chọn mẫu ứng viên Pinterest (15 mẫu)                                              │
│  [Chọn tất cả]  [Chỉ chọn mẫu Chuẩn In]  [Bỏ chọn]   ➔   [🚀 Sản xuất File In & Mockup (3)]    │
│                                                                                                │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │ ☑ [ẢNH MẪU 1]   │ │ ☐ [ẢNH MẪU 2]   │ │ ☑ [ẢNH MẪU 3]   │ │ ☐ [ẢNH MẪU 4]   │              │
│  │ ⭐ Khuyên chọn  │ │                 │ │ ⭐ Khuyên chọn  │ │                 │              │
│  │ Điểm nét: 96/100│ │ Điểm nét: 88/100│ │ Điểm nét: 94/100│ │ Điểm nét: 82/100│              │
│  │ Chuẩn in: 94/100│ │ Chuẩn in: 85/100│ │ Chuẩn in: 92/100│ │ Chuẩn in: 80/100│              │
│  │ Độ phẳng: 92/100│ │ Độ phẳng: 86/100│ │ Độ phẳng: 90/100│ │ Độ phẳng: 78/100│              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘              │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│  GIAI ĐOẠN 3: THÀNH PHẨM (Hiện ra khi status = "completed")                                    │
│                                                                                                │
│  🎉 Thành phẩm Job: 3 thiết kế hoàn thiện sẵn sàng xuất xưởng                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ 🖨️ 3 Bản in  │ │ 🏭 3 File in │ │ 🛋️ 6 Mockup  │ │ ✂️ 3 Phôi Cắt│ │ 🖼️ 6 Mockup │         │
│  │ RGB 4K Siêu Nét│ │ CMYK 300 DPI │ │ Phòng Khách AI│ │ Nền Trắng   │ │ Đa Góc      │         │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘         │
│                                                                                                │
│  Tabs: [🖨️ Bản in CMYK]  [🛋️ Mockup Phòng AI]  [✂️ Phôi Cắt]  [🔄 Bảng So Sánh 4 Bước]        │
│                                                                                                │
│  [Bảng So Sánh 4 Bước]:                                                                        │
│  Mẫu #1: [Ảnh gốc Pinterest] ➔ [Phôi bóc tách] ➔ [File CMYK 300DPI] ➔ [Mockup Phòng Khách AI] │
│  Mẫu #2: [Ảnh gốc Pinterest] ➔ [Phôi bóc tách] ➔ [File CMYK 300DPI] ➔ [Mockup Phòng Khách AI] │
│                                                                                                │
│  Hành động: [✨ Bàn giao sang Module SEO + CONTENT]   [Tải toàn bộ file in ZIP ↓]             │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Chi tiết Từng Khối Chức năng trên Giao diện

### 4.1. Header Bar
- **Thanh 3 viên thuốc (Stage Pills)**:
  - `Pill 1: 1. Quét Trend & Chọn lọc` (active ở Bước 1).
  - `Pill 2: 2. Duyệt Ứng viên (Review)` (active ở Bước 2).
  - `Pill 3: 3. Thành phẩm & Bàn giao` (active ở Bước 3).
- **Huy hiệu kết nối**: `[Pinterest: Đã kết nối 🟢]` hoặc `[Pinterest: Chưa đăng nhập 🔴]` kèm nút `🔑 Đăng nhập Pinterest`.

### 4.2. Khối Nhập liệu (Cột Trái)
- **Từ khóa & Chips gợi ý nhanh**: Nhập niche + danh sách chip bấm để điền nhanh (`Rug`, `Boho Rug`, `Floral Blanket`, `Vintage Rug`).
- **Loại sản phẩm**: Dropdown `Thảm trải sàn (Rug)` hoặc `Chăn ném mềm (Blanket)`.
- **Khu vực Kéo thả Ảnh Phòng Tham Chiếu (Reference Dropzone)**:
  - Cho phép người dùng kéo thả 1 đến 5 ảnh phòng khách/phòng ngủ vào.
  - Hỗ trợ cả **URL online** và **Base64 Data URL** khi user upload file từ máy tính.
  - Hiển thị thumbnail kèm nút xóa `✕`.
  - Không cần nhập tên hay phân loại phòng (AI Vision sẽ tự nhận diện khi ghép ảnh).
- **Nút hành động**: `▶ Bắt đầu cào ảnh` (Primary) và `Dừng Job` (Secondary).

### 4.3. Khối Tiến độ & Logs (Cột Phải)
- **Stepper tiến trình**: Đọc trực tiếp từ trường `stepper` của API để cập nhật % và thông điệp trạng thái.
- **Live Logs Drawer**: Bấm để mở rộng xem các dòng log chạy ngầm theo thời gian thực (đọc từ mảng `logs` của API).

### 4.4. Lưới Duyệt Ứng Viên (Candidate Review Grid)
- **Toolbar thao tác nhanh**:
  - Hiển thị tổng số mẫu cào về được: `🔍 Duyệt & Chọn mẫu ứng viên Pinterest (15 mẫu)`.
  - `Chọn tất cả`: Chọn toàn bộ các thẻ.
  - `Chỉ chọn mẫu Chuẩn In (Direct)`: Tự động tick các mẫu có `is_direct_printable: true` hoặc điểm in > 85.
  - `Bỏ chọn`: Bỏ tick toàn bộ.
  - Nút chốt: `🚀 Sản xuất File In & Render Mockup (X mẫu đã chọn)`.
- **Thẻ Ứng viên (Candidate Card)**:
  - Ảnh mẫu thiết kế sắc nét. Checkbox to, rõ ràng.
  - Huy hiệu `⭐ Khuyên chọn` (nền vàng cam nổi bật).
  - Hộp 3 chỉ số AI Vision: `Độ nét`, `Chuẩn in`, `Độ phẳng` (thang điểm 0–100).
  - Link icon: Xem trực tiếp Pin gốc trên Pinterest.

### 4.5. Khối Thành phẩm (Deliverables Showcase)
- **Banner 5 thẻ chỉ số (Showcase Metrics)**:
  - 🖨️ **Bản in 4K (RGB)**: `summary_metrics.rgb_4k_count`
  - 🏭 **File CMYK Xưởng**: `summary_metrics.cmyk_count`
  - 🛋️ **Mockup AI Phòng Khách**: `summary_metrics.lifestyle_mockup_count`
  - ✂️ **Phôi Cắt Sản Phẩm**: `summary_metrics.cutouts_count`
  - 🖼️ **Mockup Đa Góc**: `summary_metrics.mockups_count`
- **4 Sub-tabs chuyển đổi nội dung**:
  - `Tab 1: Bản in CMYK Xưởng`: Danh sách file in kèm nút tải trực tiếp `Tải file in CMYK ↓`.
  - `Tab 2: Phối cảnh Phòng khách AI`: Lưới hiển thị các góc phòng đã được thay phôi bằng AI.
  - `Tab 3: Phôi Cắt Sản Phẩm`: Ảnh sản phẩm nền trắng `#ffffff` chuẩn sàn.
  - `Tab 4: Bảng So Sánh 4 Bước (Comparison Table)`: Bảng hàng ngang đối chiếu từng mẫu qua 4 công đoạn (đọc từ `comparison_rows`).
- **Nút hành động cuối**: `✨ Bàn giao dữ liệu sang Module SEO + CONTENT`.

---

## 5. Hợp đồng API Tích Hợp Chi Tiết

### 🔹 Giai đoạn 1: Bắt đầu cào ảnh & Lấy kho ứng viên

#### 1. Khởi tạo Job Cào ảnh:
* **Method:** `POST /api/pinterest-pod/jobs`
* **Headers:** `Content-Type: application/json`
* **Body gửi đi:**
  ```json
  {
    "niche": "vintage distressed rug",
    "product": "rug",
    "workflow_stage": "crawl_and_review",
    "candidatePoolSize": 15,
    "referenceImages": [
      { 
        "id": "ref_01", 
        "url": "https://storage.my-app.com/refs/room_01.jpg" 
      },
      { 
        "id": "ref_02", 
        "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..." 
      }
    ]
  }
  ```
  *(Lưu ý: `referenceImages` chấp nhận cả URL mạng hoặc chuỗi Base64 Data URL khi user upload từ máy tính).*
* **Response:**
  ```json
  {
    "ok": true,
    "jobId": "job_a1b2c3d4e5",
    "job_id": "job_a1b2c3d4e5",
    "status": "running",
    "logs": ["Khởi tạo job POD (crawl_and_review): vintage distressed rug..."]
  }
  ```

#### 2. Polling lấy danh sách Ứng viên:
* **Method:** `GET /api/pinterest-pod/jobs/:jobId` (polling mỗi 1.5 - 2 giây).
* **Các trạng thái của `status`:**
  - `"running"`: Đang cào và phân tích AI. MAIN cập nhật tiến độ từ trường `stepper.percent`.
  - `"ready_for_review"`: **ĐÃ XONG BƯỚC 1!** Cào thành công kho ứng viên, dừng chờ người dùng duyệt.
  - `"failed"`: Gặp lỗi (hiển thị thông báo từ trường `error`).
* **Response khi `status === "ready_for_review"`:**
  ```json
  {
    "ok": true,
    "jobId": "job_a1b2c3d4e5",
    "status": "ready_for_review",
    "total_candidates": 15,
    "stepper": {
      "current_step": 2,
      "percent": 40,
      "current_message": "Đã quét & chấm điểm Vision AI (15 ứng viên). Mời bạn duyệt mẫu để sản xuất."
    },
    "logs": [
      "Khởi tạo job POD (crawl_and_review)...",
      "Pinterest Trends: Đã phát hiện 8 từ khóa hot...",
      "AI Vision: Đã chấm điểm chất lượng 15 mẫu ứng viên."
    ],
    "candidates": [
      {
        "id": "cand_pin_101",
        "image_id": "cand_pin_101",
        "pin_id": "84090656167812345",
        "title": "Washed Persian Medallion Rug in Earth Tones",
        "query": "vintage rug",
        "trend": "vintage distressed rug",
        "pin_url": "https://pinterest.com/pin/84090656167812345",
        "image_url": "https://i.pinimg.com/originals/.../sample_101.jpg",
        "image_score": 96.0,
        "printability_score": 94.0,
        "flat_artwork_score": 92.5,
        "is_direct_printable": true,
        "recommended": true,
        "reason": "Hoa văn phẳng chuẩn, tương phản cao, in xưởng sắc nét."
      }
    ]
  }
  ```
  MAIN lấy danh sách `candidates` này để render Lưới ảnh cho người dùng tick chọn.

---

### 🔹 Giai đoạn 2: Chốt mẫu & Sản xuất Mockup AI

#### 1. Gọi lệnh sản xuất:
Sau khi người dùng tick chọn các mẫu mong muốn trên màn hình, MAIN gửi danh sách ID đã chọn:
* **Method:** `POST /api/pinterest-pod/jobs/produce`
* **Headers:** `Content-Type: application/json`
* **Body gửi đi:**
  ```json
  {
    "jobId": "job_a1b2c3d4e5",
    "selected_candidates": [
      "cand_pin_101",
      "cand_pin_102",
      "cand_pin_105"
    ]
  }
  ```
  *(Chỉ cần gửi `jobId` và mảng `selected_candidates`. Backend tự động lấy lại ảnh phòng tham chiếu đã lưu ở Bước 1).*
* **Response:** `{ "ok": true, "status": "running" }`

#### 2. Polling lấy Thành phẩm Hoàn Thiện:
* **Method:** `GET /api/pinterest-pod/jobs/:jobId` (polling mỗi 1.5 - 2 giây).
* **Khi xong (`status === "completed"`):**
  ```json
  {
    "ok": true,
    "jobId": "job_a1b2c3d4e5",
    "status": "completed",
    "stepper": {
      "current_step": 4,
      "percent": 100,
      "current_message": "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK."
    },
    "summaryMetrics": {
      "rgb_4k_count": 3,
      "cmyk_count": 3,
      "lifestyle_mockup_count": 6,
      "cutouts_count": 3,
      "mockups_count": 6
    },
    "deliverables": {
      "print_cmyk_images": [
        {
          "filename": "design_01_cmyk_300dpi.jpg",
          "url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_cmyk_300dpi.jpg",
          "download_url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_cmyk_300dpi.jpg"
        }
      ],
      "lifestyle_mockups": [
        {
          "filename": "mockup_room_01_design_01.jpg",
          "url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/mockup_room_01_design_01.jpg",
          "scene_type": "living_room",
          "scene_description": "Modern living room with brown leather couch and sunlight"
        }
      ],
      "product_cutouts_white": [
        {
          "filename": "design_01_white.jpg",
          "url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_white.jpg"
        }
      ],
      "comparison_rows": [
        {
          "index": 1,
          "product_label": "Design #1",
          "source_url": "https://i.pinimg.com/originals/.../sample_101.jpg",
          "cutout_url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_cutout.png",
          "cutout_white_url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_white.jpg",
          "final_print_url": "/api/pinterest-pod/assets/job_a1b2c3d4e5/design_01_cmyk_300dpi.jpg",
          "ai_background_urls": [
            "/api/pinterest-pod/assets/job_a1b2c3d4e5/mockup_room_01_design_01.jpg",
            "/api/pinterest-pod/assets/job_a1b2c3d4e5/mockup_room_02_design_01.jpg"
          ]
        }
      ]
    }
  }
  ```

---

## 6. Danh sách Endpoints Tóm tắt để Lập trình

| Chức năng | Method | URL | Payload / Ghi chú |
| :--- | :--- | :--- | :--- |
| **Kiểm tra đăng nhập** | `GET` | `/api/pinterest-pod/auth-status` | Kiểm tra trước khi bấm tìm kiếm |
| **Mở trình duyệt đăng nhập** | `POST` | `/api/pinterest-pod/launch-login` | Body: `{"timeout": 600}` |
| **Bắt đầu cào kho ảnh** | `POST` | `/api/pinterest-pod/jobs` | Gửi `niche`, `product`, `referenceImages` |
| **Polling tiến độ & Ứng viên**| `GET` | `/api/pinterest-pod/jobs/:jobId` | Check `status === "ready_for_review"` |
| **Chốt mẫu & Sản xuất** | `POST` | `/api/pinterest-pod/jobs/produce` | Gửi `{ jobId, selected_candidates }` |
| **Polling lấy thành phẩm** | `GET` | `/api/pinterest-pod/jobs/:jobId` | Check `status === "completed"` |
| **Hủy tiến trình** | `POST` | `/api/pinterest-pod/jobs/:jobId/cancel` | Dừng job khi user bấm hủy |
| **Tải ảnh / File in** | `GET` | `/api/pinterest-pod/assets/:jobId/:filename` | Đường dẫn stream ảnh trực tiếp |
