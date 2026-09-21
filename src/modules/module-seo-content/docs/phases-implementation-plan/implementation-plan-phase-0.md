# Kế Hoạch Triển Khai: Phase 0 — Chuẩn Hóa Public Contract & Khung Module SEO Content

Tài liệu này là bản kế hoạch hành động chi tiết cho **Phase 0** của module `SEO + Content` (thư mục: [`src/modules/module-seo-content/`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/)), được xây dựng dựa trên:
1. Đặc tả kỹ thuật tại [`docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md).
2. Quy tắc kiến trúc & ranh giới module tại [`AGENTS.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/AGENTS.md).
3. Hợp đồng dữ liệu tổng thể và cơ chế truy xuất ổ đĩa tại [`docs/CONTRACT_MAIN_TO_PINTEREST_POD.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/docs/CONTRACT_MAIN_TO_PINTEREST_POD.md) và [`docs/CONTRACT_PINTEREST_POD_TO_SEO.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/docs/CONTRACT_PINTEREST_POD_TO_SEO.md).
4. Xác nhận từ Leader về khả năng chạy môi trường Node.js backend và sử dụng thư viện `node:fs` / `Buffer`.

---

## 1. Mục Tiêu Cốt Lõi Của Phase 0

- **Xóa sạch mã scaffold cũ**: Loại bỏ toàn bộ các định danh và logic tạm thừa kế từ `Module B` (`ModuleBInput`, `ModuleBOutput`, `runModuleB`, `getModuleBRunner`, `moduleBMockData`).
- **Thiết lập Hợp đồng Công khai (Public Contract) thực tế**: Khai báo các interface chuẩn mực cho module trong `types.ts`, bảo đảm module là một "hộp đen độc lập" theo công thức:
  $$\text{SeoContentInput} \longrightarrow \mathbf{\text{SEO + Content}} \longrightarrow \text{SeoContentOutput}$$
- **Hỗ trợ toàn diện cả Node.js Backend & Web Client**: Định nghĩa `SeoContentWebpAsset` và `SeoContentImageInput` đa năng với `localFilePath` (để Node.js `fs` đọc/ghi cực nhanh trên đĩa), `url` (để web UI hiển thị), và `data` (`Buffer` hoặc `Blob`).
- **Xây dựng Mock Runner chuẩn xác**: Cung cấp dữ liệu mẫu đại diện (sản phẩm thảm Halloween/Rug) và runner giả lập có tính bất biến (immutability) để Main UI và Orchestrator có thể dev song song.
- **Bảo đảm chất lượng kỹ thuật**: Viết mới bộ unit test độc lập, cam kết pass 100% tất cả các lệnh kiểm thử hệ thống: `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock`.

---

## 2. Chi Tiết Các Thay Đổi Mã Nguồn (Proposed Changes)

Phạm vi tác động: **100% nằm trong `src/modules/module-seo-content/`**, không thay đổi bất kỳ file nào bên ngoài.

```text
src/modules/module-seo-content/
├── types.ts              # [MODIFY] Hợp đồng dữ liệu nghiệp vụ chính thức
├── service.ts            # [MODIFY] Service cơ sở (baseline runner)
├── runtime.ts            # [MODIFY] Bộ chọn runner theo môi trường (mock vs real)
├── index.ts              # [MODIFY] Public exports duy nhất của module
├── mocks/
│   ├── data.ts           # [MODIFY] Fixture dữ liệu mẫu thực tế
│   └── runner.ts         # [MODIFY] Mock runner độc lập, bất biến
└── __tests__/
    └── service.test.ts   # [MODIFY] Unit tests kiểm thử contract và mock/real parity
```

---

### Chi tiết từng file:

#### 1. [types.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/types.ts)
Định nghĩa các interface công khai chuẩn TypeScript strict mode:
```ts
export interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string; // Đường dẫn trên ổ đĩa để Node.js fs đọc trực tiếp
}

export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
}

export interface SeoContentWebpAsset {
  readonly filename: string;                  // Tên file WebP chuẩn SEO (kebab-case)
  readonly localFilePath?: string;            // Đường dẫn file trên ổ đĩa
  readonly url?: string;                      // Relative URL (/api/...) để web view hiển thị
  readonly data?: Buffer | Uint8Array | Blob; // Hỗ trợ Buffer của Node.js hoặc Blob
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

#### 2. [service.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/service.ts)
- Thay thế hàm `runModuleB` bằng:
  ```ts
  export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput>
  ```
- Khởi tạo xử lý cơ sở (baseline transformation):
  - Chuyển tiếp an toàn các trường văn bản `title`, `description`, `handle`.
  - Thiết lập giá trị ban đầu cho `productSeoTitle` và `productSeoDescription`.
  - Ánh xạ mảng ảnh `images` sang cấu trúc đầu ra có `alt` và asset `webp` hợp lệ.
  - Ghi chú TODO cấu trúc rõ ràng trỏ tới các Phase tiếp theo (Pipeline B1 $\rightarrow$ B6).

#### 3. [mocks/data.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/mocks/data.ts)
- Xóa bỏ `moduleBMockData`.
- Xây dựng bộ fixture mẫu thực tế đại diện cho sản phẩm POD (Ví dụ Thảm Halloween phong cách cổ điển):
  - `seoContentMockInput`: Chứa danh sách ảnh (kèm cả `url` và `localFilePath`), niche `vintage distressed rug`, tiêu đề thô, mô tả thô và handle ban đầu.
  - `seoContentMockData`: Dữ liệu đầu ra mẫu hoàn chỉnh gồm tiêu đề tối ưu chuẩn SEO, mô tả HTML 5 khối, SEO Title (<58 ký tự), SEO Description (140-155 ký tự), danh sách ảnh kèm `alt` riêng cho từng góc và WebP asset.

#### 4. [mocks/runner.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/mocks/runner.ts)
- Thay thế `runMockModuleB` bằng:
  ```ts
  export async function runMockSeoContent(input: SeoContentInput): Promise<SeoContentOutput>
  ```
- Thực hiện cơ chế sao chép độc lập (fresh clone/deep copy) để đảm bảo không làm biến đổi fixture tĩnh trong `data.ts`.
- Ánh xạ động `productHandle` theo input nếu có, trả về kết quả dự đoán được (deterministic).

#### 5. [runtime.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/runtime.ts)
- Thay thế `getModuleBRunner` bằng:
  ```ts
  export function getSeoContentRunner(environment: AppEnvironment): typeof runSeoContent {
    return environment === "mock" ? runMockSeoContent : runSeoContent;
  }
  ```
- Bảo đảm module tự quản lý việc lựa chọn runner mà không làm rò rỉ logic ra ngoài.

#### 6. [index.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/index.ts)
- Xuất khẩu công khai danh sách API sạch sẽ:
  ```ts
  export { seoContentMockData, seoContentMockInput } from "./mocks/data";
  export { runMockSeoContent } from "./mocks/runner";
  export { getSeoContentRunner } from "./runtime";
  export { runSeoContent } from "./service";
  export type {
    SeoContentImageInput,
    SeoContentImageOutput,
    SeoContentInput,
    SeoContentOutput,
    SeoContentWebpAsset,
  } from "./types";
  ```

#### 7. [__tests__/service.test.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/__tests__/service.test.ts)
- Viết mới các bài unit test độc lập sử dụng `node:test` và `node:assert/strict`:
  - `Test 1`: `runSeoContent` tiếp nhận `SeoContentInput` và trả về `SeoContentOutput` hợp lệ, đầy đủ các trường bắt buộc.
  - `Test 2`: `runMockSeoContent` trả về dữ liệu mẫu khớp 100% với hợp đồng công khai mà không làm thay đổi fixture tĩnh.
  - `Test 3`: `getSeoContentRunner` chọn đúng runner theo môi trường (`mock` $\rightarrow$ mock runner; `development`/`production` $\rightarrow$ real service).
  - `Test 4`: Kiểm tra toàn diện, khẳng định không còn bất kỳ dấu vết nào của `Module B` cũ.

---

## 3. Lộ Trình Tổng Thể Các Chặng Tiếp Theo (Roadmap)

Sau khi hoàn thành Phase 0, các chặng tiếp theo sẽ được triển khai theo các cụm Milestone logic:

| Chặng (Milestone) | Nội dung & Nhiệm vụ nghiệp vụ |
| :--- | :--- |
| **Phase 0 (Hiện tại)** | **Chuẩn hóa Public Contract, Mock Runner & Khung Module** |
| **Milestone 1 (B1 + B2)** | **Thấu hiểu Sản phẩm & Ngữ cảnh Mua hàng**<br>- Trích xuất văn bản từ HTML thô, nhận diện thực thể & chủ đề.<br>- Abstraction OCR & Vision cho hình ảnh.<br>- Phân tích đối tượng người mua, người nhận, dịp tặng quà. |
| **Milestone 2 (B3 + B4)** | **Mở rộng Tìm kiếm & Chống Xung đột SEO**<br>- Bộ sinh từ khóa mầm (Seed Keyword Builder).<br>- Tích hợp Google Autocomplete API thu thập gợi ý tìm kiếm thực tế.<br>- Thuật toán phát hiện xung đột từ khóa Exact & Semantic (Embedding). |
| **Milestone 3 (B5)** | **Phân loại Ý định & Sinh Nội dung Sản phẩm**<br>- Phân loại Search Intent (Transactional / Commercial / Informational).<br>- Lập kế hoạch phân bổ từ khóa (`ContentPlan`).<br>- Sinh Title (50-65 chars), Description HTML 5 khối, SEO Meta, Handle.<br>- Validator kiểm duyệt chống bịa đặt dữ liệu (Anti-hallucination). |
| **Milestone 4 (B6)** | **Xử lý Ảnh Chuẩn SEO**<br>- Sinh `alt text` cá nhân hóa theo từng góc chụp và không gian phòng.<br>- Chuyển đổi định dạng sang WebP và đặt tên file thân thiện SEO bằng Node.js `fs` / `Buffer`. |
| **Milestone 5 (Integration)** | **Lắp Ráp Service, Xử Lý Lỗi & Tích Hợp Orchestrator**<br>- Kết nối tuần tự B1 $\rightarrow$ B6 trong `service.ts`.<br>- Bọc mã lỗi chuẩn `SEO_CONTENT_*` qua `AppError`.<br>- Tích hợp với Orchestrator để nhận gói `PinterestPodDeliverables`. |

---

## 4. Kế Hoạch Xác Minh & Kiểm Thử (Verification Plan)

Trước khi nghiệm thu Phase 0, toàn bộ các lệnh sau bắt buộc phải chạy và pass 100%:

```powershell
# 1. Chạy riêng bài kiểm thử của module SEO Content
npx tsx --test src/modules/module-seo-content/__tests__/*.test.ts

# 2. Chạy toàn bộ test suite của cả dự án
npm test

# 3. Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript strict mode
npm run typecheck

# 4. Kiểm tra build bản sản xuất
npm run build

# 5. Kiểm tra build chế độ mock
npm run build:mock
```

Đồng thời kiểm tra `git status` và `git diff` để đảm bảo:
- Không có bất kỳ file nào ngoài `src/modules/module-seo-content/` bị chỉnh sửa ngoài ý muốn.
- Không còn bất kỳ từ khóa `ModuleB*` nào trong toàn bộ thư mục module.
