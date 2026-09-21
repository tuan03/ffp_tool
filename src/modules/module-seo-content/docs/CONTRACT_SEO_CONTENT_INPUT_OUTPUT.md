# TÀI LIỆU TOÀN DIỆN CHO MODULE MAIN & ORCHESTRATOR: HỢP ĐỒNG API & INPUT/OUTPUT CONTRACT CHO MODULE SEO + CONTENT

> **Dành cho:** Thành viên phụ trách Module **MAIN** (UI/UX & Luồng ứng dụng), Module **ORCHESTRATOR** (Điều phối Workflow), Module **Pinterest POD**, và Developer tích hợp.  
> **Phiên bản:** v1.0 (Chuẩn hóa 100% theo mã nguồn TypeScript `types.ts`, `service.ts` và Kiến trúc Node.js thực tế)  
> **Ngày cập nhật:** 21/09/2026  
> **Nguồn tham chiếu gốc:** `src/modules/module-seo-content/types.ts` & `src/modules/module-seo-content/docs/CONTRACT_MAIN_TO_PINTEREST_POD.md`  

---

## 1. Cơ chế Đường dẫn & Dữ liệu Tương thích (Relative URL & Binary Support)

Tương tự như Module Pinterest POD, Module **SEO + Content** được thiết kế để hoạt động linh hoạt cả trong môi trường trình duyệt (Browser React SPA) và môi trường Node.js backend:

### 1.1. Đường dẫn tương đối trên Web (Web Relative URL)
* Dữ liệu ảnh đầu vào và ảnh WebP thành phẩm có thể truy cập qua đường dẫn tương đối:
  ```text
  /api/pinterest-pod/assets/:jobId/:filename
  /api/seo-content/assets/:jobId/:filename
  ```
* Không hardcode domain hay port `http://127.0.0.1:8765`, giúp giao diện chạy ở bất kỳ cổng nào (5173, 3000, production) đều không bị gãy link hay lỗi CORS (do Vite proxy đảm nhiệm).

### 1.2. Đường dẫn tệp cục bộ trên Ổ đĩa (Local File Path)
* Module hỗ trợ trường `localFilePath` để đọc/ghi file trực tiếp trên ổ cứng bằng Node.js `fs` mà không cần tốn thời gian tải qua HTTP:
  - Thư mục ảnh đầu vào từ Pinterest POD: `temp/pinterest_pod/:jobId/:filename` hoặc `data/pinterest_pod/output/:runId/:filename`
  - Thư mục ảnh WebP tối ưu của SEO Content: `temp/seo_content/:jobId/assets/:filename` hoặc `data/seo_content/output/:filename`
* Tăng tốc độ chuyển đổi định dạng ảnh (WebP conversion) và đọc Vision/OCR gấp 5–10 lần nhờ truy xuất file cục bộ trực tiếp.

### 1.3. Định dạng Dữ liệu Linh hoạt (Flexible Input & Binary Asset Support)
Trường ảnh trong `images` của Input và Output chấp nhận:
1. **Web URL / Relative URL**: `https://...` hoặc `/api/...` hoặc `/mockups/...`
2. **Local File Path**: `temp/...` hoặc `data/...` hoặc đường dẫn tuyệt đối trên máy chủ.
3. **Base64 Data URL**: `data:image/jpeg;base64,...` (khi người dùng kéo thả file từ máy tính).
4. **Binary Data (In-Memory)**: `Buffer | Uint8Array | Blob` trong trường `webp.data` khi truyền tải in-memory qua TypeScript function call.

---

## 2. Tổng quan Pipeline Xử lý 6 Bước (B1 – B6)

Khi nhận dữ liệu từ MAIN hoặc Orchestrator, Module SEO + Content tự động thực hiện chuỗi 6 công đoạn:

```text
       ┌────────────────────────────────────────────────────────┐
       │                 INPUT (SeoContentInput)                │
       │  • images (URLs / Local paths / Base64)                │
       │  • niche (Ví dụ: "halloween rug")                      │
       │  • title (Raw product title từ Pinterest / Designer)   │
       │  • description (Mô tả gốc thô sơ nếu có)               │
       │  • handle (Handle ban đầu nếu có)                      │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B1: HIỂU SẢN PHẨM & THỊ GIÁC (Vision & OCR Analysis)                        │
 │ • OCR nhận diện chữ trên thiết kế, phát hiện phong cách (vintage, modern)   │
 │ • AI Vision phân tích màu sắc chủ đạo, họa tiết, bối cảnh phòng             │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B2: BỐI CẢNH MUA SẮM & KHÁCH HÀNG (Shopping Context & Buyer Persona)        │
 │ • Xác định đối tượng người mua (homeowners, cat lovers, gift buyers)        │
 │ • Xác định dịp sử dụng (Halloween, housewarming, seasonal decor)             │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B3: MỞ RỘNG TỪ KHÓA THỰC TẾ (Google Autocomplete & Search Suggestions)       │
 │ • Tạo seed keywords từ B1 & B2                                              │
 │ • Quét Google Autocomplete API để lấy long-tail search queries thực tế      │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B4: LỌC TRÙNG LẶP & XUNG ĐỘT TỪ KHÓA (Keyword Cannibalization Filter)       │
 │ • Lọc bỏ từ khóa trùng lặp hoặc quá sát nghĩa gây tự cạnh tranh nội bộ      │
 │ • Phân nhóm từ khóa chính (primary) và từ khóa phụ (secondary/LSI)          │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B5: SÁNG TẠO NỘI DUNG TỐI ƯU SEO (AI Copywriting & Meta Generation)          │
 │ • Product Title: Tối ưu chuyển đổi, chứa từ khóa chính, độ dài 50-80 ký tự  │
 │ • Product Description: Chuẩn HTML giàu thông tin (Story, Specs, Care, FAQ) │
 │ • Google SEO Title: 55-65 ký tự, tối ưu Click-Through-Rate (CTR)           │
 │ • Google Meta Description: 145-160 ký tự, lời kêu gọi hành động (CTA)       │
 │ • Product Handle: Chuẩn kebab-case, sạch ký tự đặc biệt                     │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ B6: TỐI ƯU HÓA HÌNH ẢNH SẢN PHẨM (WebP Conversion & Semantic Alt Text)      │
 │ • Chuyển đổi toàn bộ ảnh sang định dạng WebP (giảm 60-80% dung lượng)       │
 │ • Đổi tên file ảnh chuẩn SEO (chứa keyword + ngữ cảnh góc nhìn)             │
 │ • Sinh Alt text ngữ nghĩa phục vụ SEO Google Hình Ảnh & chuẩn Accessibility │
 └─────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │                OUTPUT (SeoContentOutput)               │
       │  • productTitle (Tên hiển thị bán hàng)                │
       │  • productDescription (Mô tả HTML giàu chi tiết)       │
       │  • productSeoTitle (Meta Title Google)                 │
       │  • productSeoDescription (Meta Description Google)     │
       │  • productHandle (URL Slug chuẩn)                      │
       │  • images[] (Danh sách ảnh WebP + Alt text chuẩn SEO)   │
       └────────────────────────────────────────────────────────┘
```

---

## 3. Bản vẽ Giao diện Xem & Tinh chỉnh trên MAIN (UI Wireframe)

Khi kết quả SEO hoàn thành, MAIN có thể render giao diện chuyên nghiệp cho người dùng duyệt và chỉnh sửa trước khi đồng bộ lên Store:

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  [1. Pinterest POD] ➔ [2. Tối Ưu SEO & Content (Active)] ➔ [3. Đẩy lên Shopify]                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ⚡ TIẾN ĐỘ TỐI ƯU SEO: [ 100% - Hoàn tất ]   │  Niche: [ Halloween Home Decor               ] │
├────────────────────────────────────────────────┬───────────────────────────────────────────────┤
│  CỘT TRÁI: NỘI DUNG SẢN PHẨM (SHOPIFY STORE)   │  CỘT PHẢI: GOOGLE SEARCH SNIPPET & ẢNH WEBP   │
│                                                │                                               │
│  Tên sản phẩm hiển thị (Product Title) *       │  🔍 XEM TRƯỚC HIỂN THỊ GOOGLE (SERP PREVIEW)  │
│  ┌───────────────────────────────────────────┐ │  ┌─────────────────────────────────────────┐  │
│  │ Vintage Distressed Black Cat Halloween    │ │  │ 🌐 https://mystore.com/products/vintage-..│  │
│  │ Rug - Spooky Gothic Home Decor            │ │  │ Vintage Distressed Black Cat Halloween  │  │
│  └───────────────────────────────────────────┘ │  │ Rug | Spooky Gothic Home Decor          │  │
│  (69/80 ký tự - Tối ưu)                        │  │ Transform your space with this vintage   │  │
│                                                │  │ black cat rug. High-traction non-slip...│  │
│  Đường dẫn sản phẩm (Handle/Slug) *            │  └─────────────────────────────────────────┘  │
│  [ vintage-distressed-black-cat-halloween-rug] │                                               │
│                                                │  Google SEO Title (55-65 chars):              │
│  Mô tả chi tiết sản phẩm (Rich HTML)           │  [ Vintage Distressed Black Cat Halloween...] │
│  ┌───────────────────────────────────────────┐ │                                               │
│  │ <b>Transform Your Room With Spooky Charm!</b>│ Google Meta Description (145-160 chars):     │
│  │ <h3>Key Highlights:</h3>                  │  [ Transform your room with this vintage...]  │
│  │ • Premium low-pile velvety surface        │                                               │
│  │ • Non-slip latex backing for wooden floors│  🖼️ DANH SÁCH ẢNH WEBP ĐÃ TỐI ƯU (3 ảnh)       │
│  │ <h3>Dimensions & Specifications:</h3>     │  ┌──────────────┐ ┌──────────────┐            │
│  │ ...                                       │  │ [ẢNH WEBP 1] │ │ [ẢNH WEBP 2] │            │
│  └───────────────────────────────────────────┘ │  │ Living Room  │ │ Closeup    │            │
│                                                │  │ 72 KB (WebP) │ │ 65 KB (WebP) │            │
│                                                │  │ Alt: Vintage..│ Alt: Non-slip│            │
│                                                │  └──────────────┘ └──────────────┘            │
├────────────────────────────────────────────────┴───────────────────────────────────────────────┤
│  Hành động: [🔄 Tạo lại nội dung]  [💾 Lưu bản nháp]  ➔  [🚀 ĐẨY SẢN PHẨM LÊN SHOPIFY STORE]     │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Hợp đồng Input Chi Tiết (`SeoContentInput`)

### 4.1. TypeScript Interface
```typescript
export interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string;
}

export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
}
```

### 4.2. Bảng Mô tả Chi tiết Từng Trường Dữ liệu Đầu vào

| Tên trường | Kiểu dữ liệu | Bắt buộc? | Mô tả & Quy chuẩn | Ví dụ giá trị |
| :--- | :--- | :---: | :--- | :--- |
| **`images`** | `SeoContentImageInput[]` | **Có** | Mảng chứa từ 1 đến 10 ảnh sản phẩm (mockup, ảnh phòng, chi tiết). Phải có ít nhất 1 ảnh. | Xem chi tiết bên dưới |
| `images[].url` | `string` | **Có** | Đường dẫn URL của ảnh (Web URL, Relative URL `/api/...` hoặc Base64). | `"/api/pinterest-pod/assets/job_101/mockup_room_01.jpg"` |
| `images[].id` | `string` | *Không* | Mã định danh của ảnh (giúp tracking ảnh gốc). | `"img_lifestyle_01"` |
| `images[].alt` | `string` | *Không* | Alt text gốc ban đầu (nếu có). Module sẽ tối ưu lại. | `"Cat rug in room"` |
| `images[].localFilePath` | `string` | *Không* | Đường dẫn file ảnh trực tiếp trên ổ cứng để Node.js đọc nhanh. | `"temp/pinterest_pod/job_101/mockup_room_01.jpg"` |
| **`niche`** | `string` | **Có** | Ngành hàng / chủ đề sản phẩm để AI định vị bối cảnh và đối tượng tìm kiếm. | `"halloween rug"`, `"boho area rug"` |
| **`title`** | `string` | **Có** | Tên sản phẩm ban đầu (từ Pinterest, crawler hoặc tên phôi thiết kế). | `"Vintage Distressed Black Cat Halloween Rug"` |
| **`description`** | `string` | *Tùy chọn* | Mô tả thô sơ ban đầu nếu có (nếu chưa có, truyền `""`). | `""` hoặc `"Soft velvet floor mat for bedroom."` |
| **`handle`** | `string` | *Tùy chọn* | Handle slug ban đầu (nếu chưa có, truyền `""` hoặc chuỗi slug tạm). | `""` hoặc `"black-cat-rug"` |

### 4.3. Ví dụ Payload Gửi đi (JSON Request)
```json
{
  "niche": "halloween rug",
  "title": "Vintage Distressed Black Cat Halloween Rug",
  "description": "Soft gothic home decor accent floor rug for bedroom and living room.",
  "handle": "vintage-distressed-black-cat-halloween-rug",
  "images": [
    {
      "id": "img_mockup_living_room",
      "url": "/api/pinterest-pod/assets/job_a1b2c3/mockup_room_01.jpg",
      "alt": "Vintage distressed black cat Halloween rug styled in living room",
      "localFilePath": "temp/pinterest_pod/job_a1b2c3/mockup_room_01.jpg"
    },
    {
      "id": "img_mockup_white_bg",
      "url": "/api/pinterest-pod/assets/job_a1b2c3/mockup_white.jpg",
      "alt": "Black cat rug cutout on white background",
      "localFilePath": "temp/pinterest_pod/job_a1b2c3/mockup_white.jpg"
    }
  ]
}
```

---

## 5. Hợp đồng Output Chi Tiết (`SeoContentOutput`)

### 5.1. TypeScript Interface
```typescript
export interface SeoContentWebpAsset {
  readonly filename: string;
  readonly localFilePath?: string;
  readonly url?: string;
  readonly data?: Buffer | Uint8Array | Blob;
}

export interface SeoContentImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: SeoContentWebpAsset;
}

export interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  readonly productHandle: string;
}
```

### 5.2. Bảng Mô tả Chi tiết Từng Trường Dữ liệu Trả về

| Tên trường | Kiểu dữ liệu | Mô tả chi tiết & Chuẩn SEO | Mục đích sử dụng |
| :--- | :--- | :--- | :--- |
| **`productTitle`** | `string` | Tên sản phẩm chính thức trên cửa hàng. Độ dài lý tưởng 50–80 ký tự, kết hợp từ khóa chính, phong cách và công năng mà vẫn tự nhiên. | Hiển thị tiêu đề sản phẩm trên Shopify, hóa đơn, giỏ hàng |
| **`productDescription`** | `string` | Đoạn mô tả sản phẩm hoàn chỉnh định dạng HTML ngữ nghĩa (bao gồm `<p>`, `<h3>`, `<ul>`, `<li>`), chia bố cục: Câu chuyện/Điểm nhấn (Story), Đặc tính kỹ thuật (Highlights), Hướng dẫn bảo quản (Care Instructions), Câu hỏi thường gặp (FAQ). | Render vào khung mô tả sản phẩm trên trang chi tiết Shopify |
| **`productSeoTitle`** | `string` | Thẻ Meta Title chuẩn Google Search. Độ dài tối ưu 55–65 ký tự. Chứa từ khóa chính ở đầu, ngăn cách bằng `\|` hoặc `-` kèm thương hiệu. | Điền vào trường `SEO Title` (Meta Title) của Shopify |
| **`productSeoDescription`** | `string` | Thẻ Meta Description chuẩn Google Search. Độ dài tối ưu 145–160 ký tự. Tóm tắt giá trị độc đáo và có lời kêu gọi hành động (Call To Action). | Điền vào trường `SEO Description` (Meta Description) của Shopify |
| **`productHandle`** | `string` | Đường dẫn URL Slug sạch dạng kebab-case, không dấu, không ký tự đặc biệt, chứa từ khóa mục tiêu. | Điền vào trường URL Slug (`handle`) của Shopify |
| **`images`** | `SeoContentImageOutput[]` | Mảng danh sách ảnh đã được tối ưu toàn diện sang định dạng WebP kèm Alt text ngữ nghĩa. | Đẩy vào danh sách Media / Product Images của Shopify |
| `images[].sourceUrl` | `string` | Đường dẫn URL gốc ban đầu để đối chiếu. | Truy vết nguồn ảnh |
| `images[].alt` | `string` | Thẻ Alt Text tối ưu cho ảnh: mô tả chi tiết hình ảnh, màu sắc, bối cảnh phòng phục vụ chuẩn SEO Google Image & Accessibility người khiếm thị. | Thẻ `alt` của ảnh sản phẩm trên Shopify |
| `images[].webp.filename` | `string` | Tên file WebP chuẩn SEO (VD: `vintage-distressed-black-cat-halloween-rug-1.webp`). | Tên file khi tải về hoặc upload |
| `images[].webp.url` | `string` *(Tùy chọn)* | Web relative URL để xem và tải ảnh WebP trực tiếp trên trình duyệt. | Thẻ `<img src="...">` trên giao diện web |
| `images[].webp.localFilePath`| `string` *(Tùy chọn)* | Đường dẫn file WebP đã ghi trên đĩa local. | Truy xuất file nhanh trong backend / Node.js |
| `images[].webp.data` | `Buffer \| Blob` *(Tùy chọn)*| Binary data của ảnh WebP khi chạy in-memory trong Node.js / Browser. | Upload trực tiếp qua Stream/FormData |

### 5.3. Ví dụ Kết quả Trả về (JSON Response)
```json
{
  "productTitle": "Vintage Distressed Black Cat Halloween Rug - Gothic Spooky Home Decor Washable Mat",
  "productDescription": "<p>Embrace timeless spooky elegance with our <strong>Vintage Distressed Black Cat Halloween Rug</strong>. Designed with a captivating antique witchcore aesthetic, this accent floor rug seamlessly blends gothic mystery with cozy everyday comfort.</p><h3>Why You'll Love It:</h3><ul><li><strong>Velvety Soft & Durable:</strong> Crafted with high-density low-pile micro-polyester that feels luxurious underfoot while resisting shedding and daily wear.</li><li><strong>Safe & Non-Slip:</strong> High-traction textured backing ensures secure placement on hardwood, laminate, or tile floors.</li><li><strong>Rich Fade-Resistant Print:</strong> Features a distressed vintage illustration of an arched black cat surrounded by celestial and floral motifs.</li></ul><h3>Care Instructions:</h3><p>Machine wash cold on gentle cycle or vacuum regularly. Lay flat or hang to air dry.</p>",
  "productSeoTitle": "Vintage Distressed Black Cat Halloween Rug | Gothic Floor Decor",
  "productSeoDescription": "Elevate your spooky gothic home decor with our vintage distressed black cat Halloween rug. Soft, non-slip, and washable accent mat. Order yours today!",
  "productHandle": "vintage-distressed-black-cat-halloween-rug",
  "images": [
    {
      "sourceUrl": "/api/pinterest-pod/assets/job_a1b2c3/mockup_room_01.jpg",
      "alt": "Vintage distressed black cat Halloween rug laid out in a cozy rustic living room",
      "webp": {
        "filename": "vintage-distressed-black-cat-halloween-rug-living-room.webp",
        "url": "/api/seo-content/assets/job_a1b2c3/vintage-distressed-black-cat-halloween-rug-living-room.webp",
        "localFilePath": "temp/seo_content/job_a1b2c3/assets/vintage-distressed-black-cat-halloween-rug-living-room.webp"
      }
    },
    {
      "sourceUrl": "/api/pinterest-pod/assets/job_a1b2c3/mockup_white.jpg",
      "alt": "Isolated view of vintage distressed black cat Halloween rug design on white background",
      "webp": {
        "filename": "vintage-distressed-black-cat-halloween-rug-cutout.webp",
        "url": "/api/seo-content/assets/job_a1b2c3/vintage-distressed-black-cat-halloween-rug-cutout.webp",
        "localFilePath": "temp/seo_content/job_a1b2c3/assets/vintage-distressed-black-cat-halloween-rug-cutout.webp"
      }
    }
  ]
}
```

---

## 6. Hướng dẫn Ánh xạ Dữ liệu Thực Chiến: Từ Pinterest POD sang SEO Content (Handover Guide)

Khi người dùng bấm nút **`✨ Bàn giao sang Module SEO + CONTENT`** trên giao diện Pinterest POD Studio, Module MAIN hoặc Orchestrator thực hiện ánh xạ dữ liệu theo bảng sau:

### 6.1. Bảng Ánh xạ Trường (Field Mapping Table)

| Trường đầu vào SEO Content | Nguồn dữ liệu từ Pinterest POD (`job` thành phẩm) | Ghi chú xử lý |
| :--- | :--- | :--- |
| **`niche`** | `job.niche` | Truyền nguyên giá trị (VD: `"vintage distressed rug"`). |
| **`title`** | `job.candidates[selectedId].title` | Tên mẫu do AI Pinterest đề xuất hoặc người dùng chỉnh sửa. |
| **`description`** | `job.candidates[selectedId].reason` hoặc `""` | Tạm lấy lý do gợi ý hoặc mô tả ngắn để làm gợi ý cho AI. |
| **`handle`** | Tạo tự động từ `title` (slugify) hoặc `""` | Bỏ khoảng trắng, dấu tiếng Việt, chuyển chữ thường sang dạng kebab-case. |
| **`images`** | Gộp từ `deliverables.lifestyle_mockups`, `product_cutouts_white`, `print_cmyk_images` | Xem đoạn code mẫu bên dưới. |

### 6.2. Đoạn mã TypeScript mẫu để Ánh xạ (Mapping Code Snippet)
```typescript
import type { SeoContentInput, SeoContentImageInput } from '@/modules/module-seo-content';

export function mapPinterestPodToSeoContentInput(
  podJob: any, 
  selectedCandidate: any
): SeoContentInput {
  const images: SeoContentImageInput[] = [];

  // 1. Thêm ảnh Lifestyle Mockup (Phòng khách / Phòng ngủ AI)
  if (podJob.deliverables?.lifestyle_mockups) {
    for (const mockup of podJob.deliverables.lifestyle_mockups) {
      images.push({
        id: `mockup_${mockup.filename}`,
        url: mockup.url,
        alt: mockup.scene_description || selectedCandidate.title,
        localFilePath: mockup.localFilePath
      });
    }
  }

  // 2. Thêm ảnh Phôi cắt nền trắng (Product Cutout White)
  if (podJob.deliverables?.product_cutouts_white) {
    for (const cutout of podJob.deliverables.product_cutouts_white) {
      images.push({
        id: `cutout_${cutout.filename}`,
        url: cutout.url,
        alt: `${selectedCandidate.title} cutout on white background`,
        localFilePath: cutout.localFilePath
      });
    }
  }

  // 3. Fallback: Nếu không có mockup, dùng ảnh gốc candidate
  if (images.length === 0 && selectedCandidate.image_url) {
    images.push({
      id: selectedCandidate.id,
      url: selectedCandidate.image_url,
      alt: selectedCandidate.title
    });
  }

  return {
    niche: podJob.niche || 'general',
    title: selectedCandidate.title || 'Custom POD Design',
    description: selectedCandidate.reason || '',
    handle: (selectedCandidate.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),
    images
  };
}
```

---

## 7. Giao diện Lập trình (API Endpoints & TypeScript Integration)

Module SEO + Content hỗ trợ 2 phương thức gọi:

### 7.1. Cách 1: Gọi hàm TypeScript trực tiếp (Khuyên dùng trong FFP Tool)
Đây là cách nhanh nhất và an toàn kiểu dữ liệu 100% trong kiến trúc SPA + Node.js:

```typescript
import { getSeoContentRunner } from '@/modules/module-seo-content';
import { getEnvironment } from '@/config/environment';

// 1. Lấy runner tương ứng với môi trường hiện tại (mock / dev / prod)
const environment = getEnvironment();
const runSeoContent = getSeoContentRunner(environment);

// 2. Thực thi xử lý
try {
  const seoResult = await runSeoContent(seoInput);
  console.log('Tối ưu SEO thành công:', seoResult.productTitle);
} catch (error) {
  console.error('Lỗi khi chạy SEO Content:', error);
}
```

### 7.2. Cách 2: Gọi qua HTTP REST API (Nếu tích hợp qua Backend Service)

| Chức năng | Method | URL | Mô tả & Payload |
| :--- | :--- | :--- | :--- |
| **Tối ưu SEO (Đồng bộ)** | `POST` | `/api/seo-content/optimize` | Gửi `SeoContentInput`, nhận lại ngay `SeoContentOutput`. Phù hợp khi số lượng ảnh ít (1–3 ảnh). |
| **Khởi tạo Job SEO (Bất đồng bộ)** | `POST` | `/api/seo-content/jobs` | Gửi `SeoContentInput`, nhận lại `{ ok: true, jobId, status: "running" }`. Dùng khi xử lý nhiều ảnh hoặc OCR nặng. |
| **Polling tiến độ Job** | `GET` | `/api/seo-content/jobs/:jobId` | Nhận tiến độ phần trăm (`stepper.percent`), logs theo thời gian thực và kết quả khi `status === "completed"`. |
| **Tải / Xem ảnh WebP** | `GET` | `/api/seo-content/assets/:jobId/:filename` | Stream ảnh WebP trực tiếp ra trình duyệt. |

#### Ví dụ Request Khởi tạo Job (Async):
* **URL:** `POST /api/seo-content/jobs`
* **Headers:** `Content-Type: application/json`
* **Body:** Đối tượng `SeoContentInput` (xem mục 4.3).
* **Response:**
  ```json
  {
    "ok": true,
    "jobId": "job_seo_98765",
    "status": "running",
    "logs": ["Bắt đầu nhận diện hình ảnh & OCR (B1)..."]
  }
  ```

#### Ví dụ Polling Tiến độ Job:
* **URL:** `GET /api/seo-content/jobs/job_seo_98765`
* **Response khi đang chạy (`running`):**
  ```json
  {
    "ok": true,
    "jobId": "job_seo_98765",
    "status": "running",
    "stepper": {
      "current_step": 3,
      "percent": 50,
      "current_message": "Đang mở rộng từ khóa với Google Autocomplete API..."
    },
    "logs": [
      "[19:30:01] Phân tích OCR hoàn tất: phát hiện chủ đề gothic/halloween.",
      "[19:30:03] Xác định đối tượng mua sắm: pet lovers, gothic decor fans.",
      "[19:30:05] Đang thu thập 15 từ khóa gợi ý thực tế từ Google..."
    ]
  }
  ```

---

## 8. Bảng Mã Lỗi & Xử lý Ngoại lệ (Error Handling & Error Codes)

Module kế thừa chuẩn `AppError` của dự án với các mã lỗi chuẩn xác giúp giao diện hiển thị thông báo thân thiện cho người dùng:

| Mã lỗi (`code`) | Nguyên nhân | Hướng khắc phục gợi ý |
| :--- | :--- | :--- |
| `INVALID_INPUT` | Thiếu trường bắt buộc (`images` rỗng, `niche` rỗng, hoặc `title` rỗng). | Kiểm tra và yêu cầu người dùng điền đầy đủ thông tin trước khi nhấn chạy. |
| `IMAGE_NOT_FOUND` | Không thể đọc file tại `localFilePath` hoặc URL ảnh không phản hồi. | Kiểm tra xem file ảnh có tồn tại trong thư mục `temp/` hoặc đường dẫn có hợp lệ không. |
| `OCR_SERVICE_FAILED` | Dịch vụ phân tích hình ảnh/OCR gặp sự cố hoặc timeout. | Tự động kích hoạt cơ chế fallback: sử dụng title và niche có sẵn để tiếp tục pipeline B2–B6 mà không làm gián đoạn toàn bộ tiến trình. |
| `GOOGLE_SUGGEST_FAILED` | Google Autocomplete API bị chặn hoặc không có kết nối mạng. | Fallback sang bộ từ khóa seed mặc định dựa trên niche và title. |
| `WEBP_CONVERSION_FAILED` | Không thể chuyển đổi file ảnh sang WebP (lỗi codec hoặc file hỏng). | Giữ nguyên định dạng gốc (`.jpg`/`.png`) và ghi nhận cảnh báo trong log. |
| `SEO_CONTENT_FAILED` | Lỗi tổng quát trong quá trình thực thi module. | Kiểm tra `error.cause` trong Live Logs để xem chi tiết lỗi kỹ thuật. |

---

## 9. Bảng Tham Chiếu Nhanh Cho Lập Trình Viên (Cheat Sheet)

```text
┌─────────────────────────┬───────────────────────────────────┬──────────────────────────────────────────┐
│ Tiêu chí                │ Module SEO + Content              │ Module Pinterest POD (Tham chiếu)        │
├─────────────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
│ Đơn vị điều phối        │ src/modules/module-seo-content    │ src/modules/module-pinterest-pod (hoặc B)│
│ File Contract chính     │ types.ts                          │ types.ts                                 │
│ Hàm thực thi chính      │ runSeoContent(input)              │ runPinterestPod(input)                   │
│ Runner Factory          │ getSeoContentRunner(environment)  │ getPinterestPodRunner(environment)       │
│ Định dạng ảnh đầu vào   │ Web URL, Local Path, Base64       │ Web URL, Local Path, Base64              │
│ Định dạng ảnh đầu ra    │ WebP (kèm Alt Text ngữ nghĩa)     │ CMYK 300DPI, RGB 4K, Mockup AI JPG       │
│ Kết nối ra bên ngoài    │ Google Autocomplete, AI Model     │ Pinterest Crawler, Stability/AI Vision   │
│ Tiêu chuẩn đầu ra       │ Shopify Product Schema & Google   │ Xưởng in POD & Bối cảnh phòng AI         │
└─────────────────────────┴───────────────────────────────────┴──────────────────────────────────────────┘
```

---

> **Ghi chú nội bộ cho Team:**  
> Tài liệu này là nguồn chân lý (Single Source of Truth) cho giao tiếp Input/Output giữa các Module. Nếu có bất kỳ đề xuất thay đổi nào đối với cấu trúc `types.ts`, vui lòng thông báo cho Owner của Module SEO Content để phối hợp cập nhật đồng bộ các bài Unit Test và Mock Data.
