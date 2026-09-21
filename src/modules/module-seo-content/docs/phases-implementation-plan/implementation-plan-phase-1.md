# Kế Hoạch Triển Khai: Phase 1 — Xây Dựng Internal Pipeline & Domain Types

Tài liệu này là bản kế hoạch hành động chi tiết để bắt tay vào code **Phase 1** của module `SEO + Content` (thư mục: [`src/modules/module-seo-content/`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/)), được xây dựng dựa trên:
1. Đặc tả kỹ thuật tại mục **3. Phase 1 — Tạo internal pipeline và domain types** trong [`docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md).
2. Quy chuẩn kiến trúc, quy tắc đóng gói ranh giới module và phong cách code trong [`AGENTS.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/AGENTS.md).
3. Hợp đồng API chuẩn tại [`docs/CONTRACT_SEO_CONTENT_INPUT_OUTPUT.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/docs/CONTRACT_SEO_CONTENT_INPUT_OUTPUT.md).
4. Hiện trạng mã nguồn sau khi hoàn thành Phase 0 (đã có public contract chuẩn trong `types.ts`, `service.ts` baseline và bộ 10 unit tests).

---

## 1. Mục Tiêu Cốt Lõi Của Phase 1

Hiện tại ở Phase 0, `service.ts` đang là một hàm chuyển đổi dữ liệu phẳng (flat baseline mapping). Để chuẩn bị cho các giai đoạn xử lý chuyên sâu về AI Vision, OCR, Google Autocomplete và sinh văn bản (từ Phase 2 đến Phase 13), **Phase 1 có nhiệm vụ xây dựng bộ khung xương (Skeleton) nội bộ vững chắc**:

- **Thiết lập Kiến trúc Pipeline Đa Tầng (Multi-Stage Pipeline)**: Tách luồng xử lý thành 6 stage tuần tự độc lập:
  $$\text{B1 (Understanding)} \longrightarrow \text{B2 (Context)} \longrightarrow \text{B3 (Search)} \longrightarrow \text{B4 (Conflict)} \longrightarrow \text{B5 (Content)} \longrightarrow \text{B6 (Images)}$$
- **Xây dựng Hệ thống Kiểu Nội bộ (Internal Domain Types)**: Định nghĩa kiểu dữ liệu có cấu trúc cho từng stage mà **không để lộ (no leak) ra ngoài `index.ts`**.
- **Bảo toàn Dữ liệu Gốc (No Data Loss)**: Thiết kế `SeoPipelineContext` dạng bất biến (immutable context), tích lũy dần kết quả qua từng bước mà không làm mất hoặc thay đổi các thông tin gốc ban đầu (`images`, `niche`, `title`, `description`, `handle`).
- **Phân định Ranh giới Lỗi (Error Boundaries)**: Xây dựng cơ chế bắt lỗi theo từng stage (`SeoStageError`), phân biệt lỗi nghiêm trọng (Fatal error - dừng pipeline) và lỗi thứ yếu (Recoverable error - kích hoạt fallback an toàn).
- **Khả năng Kiểm thử Độc lập (Testability & Dependency Injection)**: Thiết kế pipeline dạng Factory (`createSeoPipeline`) cho phép inject mock stage handlers để kiểm thử thứ tự chạy, tính bất biến và khả năng cô lập lỗi mà không phụ thuộc vào API bên ngoài.

---

## 2. Cấu Trúc Thư Mục & Phân Chia Trách Nhiệm

Toàn bộ các tệp mới của Phase 1 sẽ nằm gọn trong thư mục `src/modules/module-seo-content/internal/`. Tuyệt đối không can thiệp vào bất kỳ thư mục nào khác trong dự án:

```text
src/modules/module-seo-content/
├── internal/                                # [NEW] Toàn bộ mã nguồn nội bộ của module
│   ├── domain-types.ts                      # [NEW] Kiểu dữ liệu trung gian cho B1–B6 và PipelineContext
│   ├── pipeline-context.ts                  # [NEW] Quản lý khởi tạo & cập nhật Context an toàn, bất biến
│   ├── pipeline-errors.ts                   # [NEW] Error model nội bộ & cơ chế bọc lỗi từng stage
│   ├── pipeline.ts                          # [NEW] Bộ điều phối tuần tự (Pipeline Runner & Factory)
│   └── stages/                              # [NEW] Thư mục chứa baseline handler cho từng công đoạn
│       ├── b1-product-understanding.ts      # [NEW] Baseline Stage B1
│       ├── b2-shopping-context.ts           # [NEW] Baseline Stage B2
│       ├── b3-search-suggestions.ts         # [NEW] Baseline Stage B3
│       ├── b4-conflict-control.ts           # [NEW] Baseline Stage B4
│       ├── b5-content-generation.ts         # [NEW] Baseline Stage B5
│       └── b6-image-processing.ts           # [NEW] Baseline Stage B6
├── service.ts                               # [MODIFY] Chuyển tiếp thực thi qua default pipeline
├── types.ts                                 # [PRESERVE] Giữ nguyên Public Contract Phase 0
├── runtime.ts                               # [PRESERVE] Giữ nguyên Runtime Selector
├── index.ts                                 # [PRESERVE] Giữ nguyên Public API (không export internal/)
├── mocks/                                   # [PRESERVE] Giữ nguyên Mock Fixtures & Runner Phase 0
└── __tests__/
    ├── service.test.ts                      # [PRESERVE] Duy trì 10 tests bảo đảm tính tương thích
    └── pipeline.test.ts                     # [NEW] Bộ unit tests chuyên sâu cho Pipeline Phase 1
```

---

## 3. Đặc Tả Thiết Kế Chi Tiết Từng Tệp Mã Nguồn

### 3.1. `internal/domain-types.ts`
Chứa các interface mô tả dữ liệu đầu ra trung gian của từng stage (B1 $\rightarrow$ B6) và `SeoPipelineContext`:

```typescript
import type { SeoContentInput, SeoContentOutput } from "../types";

/** B1: Kết quả phân tích sản phẩm và hình ảnh (OCR, Vision, Theme) */
export interface ProductUnderstanding {
  readonly ocrTexts: readonly string[];
  readonly detectedEntities: readonly string[];
  readonly dominantColors: readonly string[];
  readonly visualStyle: string;
  readonly productCategory: string;
}

/** B2: Bối cảnh mua sắm, chân dung khách hàng & dịp sử dụng */
export interface ShoppingContext {
  readonly targetAudience: readonly string[];
  readonly suitableOccasions: readonly string[];
  readonly useCases: readonly string[];
  readonly buyerIntentKeywords: readonly string[];
}

/** B3: Tập dữ liệu nghiên cứu từ khóa mở rộng (Google Suggest, Long-tail) */
export interface SearchResearchResult {
  readonly seedKeywords: readonly string[];
  readonly suggestedQueries: readonly string[];
  readonly querySources: Record<string, string>; // query -> "google_suggest" | "niche_seed"
}

/** B4: Kết quả kiểm tra xung đột và trùng lặp từ khóa */
export interface ConflictResult {
  readonly approvedKeywords: readonly string[];
  readonly discardedKeywords: readonly string[];
  readonly conflictReasons: Record<string, string>;
}

/** B5: Kết quả sáng tạo nội dung văn bản (Copywriting) */
export interface ContentResult {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly productHandle: string;
}

/** B6: Kết quả tối ưu hóa hình ảnh (WebP & Alt Text) */
export interface ImageProcessingResult {
  readonly processedImages: SeoContentOutput["images"];
}

/** Context tích lũy chạy xuyên suốt qua 6 Stage của Pipeline */
export interface SeoPipelineContext {
  readonly source: SeoContentInput;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly searchResearch?: SearchResearchResult;
  readonly conflictResult?: ConflictResult;
  readonly contentResult?: ContentResult;
  readonly imageResult?: ImageProcessingResult;
}
```

### 3.2. `internal/pipeline-context.ts`
Cung cấp các hàm nguyên tử (pure helper functions) để khởi tạo và cập nhật context mà không làm biến đổi (mutate) đối tượng cũ:
- `createInitialContext(input: SeoContentInput): SeoPipelineContext`: Đóng băng `source` và trả về context rỗng ban đầu.
- `evolveContext(context: SeoPipelineContext, updates: Partial<Omit<SeoPipelineContext, "source">>): SeoPipelineContext`: Trả về một shallow clone mới được gộp thêm dữ liệu của stage vừa hoàn thành.
- `finalizePipelineOutput(context: SeoPipelineContext): SeoContentOutput`: Trích xuất và định hình lại dữ liệu cuối cùng từ `context.contentResult` và `context.imageResult` thành đúng chuẩn `SeoContentOutput`.

### 3.3. `internal/pipeline-errors.ts`
Định nghĩa hệ thống xử lý lỗi chuyên biệt cho Pipeline:
- Class `SeoStageError` kế thừa từ `AppError` của shared module (hoặc Error chuẩn với mã lỗi ổn định `SEO_STAGE_FAILED`):
  - `stageName: "b1" | "b2" | "b3" | "b4" | "b5" | "b6"`
  - `isRecoverable: boolean`
  - `cause: unknown`
- Hàm `wrapStageError(stageName: string, error: unknown, isRecoverable?: boolean): SeoStageError`

### 3.4. `internal/pipeline.ts`
Trái tim điều phối quy trình thực thi tuần tự:
- Định nghĩa interface Stage:
  ```typescript
  export interface SeoPipelineStage {
    readonly name: "b1" | "b2" | "b3" | "b4" | "b5" | "b6";
    execute(context: SeoPipelineContext): Promise<SeoPipelineContext>;
  }
  ```
- Factory tạo Pipeline:
  ```typescript
  export function createSeoPipeline(customStages?: readonly SeoPipelineStage[]): {
    execute(input: SeoContentInput): Promise<SeoContentOutput>;
  }
  ```
- Cơ chế chạy tuần tự qua vòng lặp `for (const stage of stages)`:
  - Gọi `stage.execute(currentContext)`
  - Kiểm tra tính bất biến: Xác nhận context trả về là đối tượng hợp lệ và không làm mất `source`.
  - Nếu xảy ra lỗi: Bắt lỗi qua Error Boundary, nếu `isRecoverable` thì ghi log cảnh báo và tiếp tục; nếu fatal error thì ném `SeoStageError` để dừng pipeline an toàn.

### 3.5. Các Baseline Stage Handlers trong `internal/stages/`
Tại Phase 1, các stage handler đóng vai trò là "chân đế" chuẩn mực (baseline functional stubs), đảm bảo luồng dữ liệu thông suốt trước khi lắp ghép logic thật ở các Phase sau:
1. **`b1-product-understanding.ts`**: Trích xuất sơ bộ các entity từ `source.title` và `source.niche`, tạo `ProductUnderstanding` mẫu.
2. **`b2-shopping-context.ts`**: Đọc dữ liệu từ `context.productUnderstanding` và `source.niche` để sinh chân dung người mua và ngữ cảnh cơ bản.
3. **`b3-search-suggestions.ts`**: Tạo danh sách query ban đầu từ `source.title` và `context.shoppingContext`.
4. **`b4-conflict-control.ts`**: Lọc bỏ các từ rỗng, chuẩn hóa chữ thường và bàn giao tập từ khóa hợp lệ vào `context.conflictResult`.
5. **`b5-content-generation.ts`**: Sinh nội dung văn bản (kế thừa logic baseline từ Phase 0 với title, description, meta title/description và handle).
6. **`b6-image-processing.ts`**: Chuyển đổi và định dạng danh sách ảnh `source.images` sang chuẩn `SeoContentImageOutput[]` (kế thừa logic baseline từ Phase 0).

### 3.6. Cập nhật `service.ts`
Chuyển đổi `service.ts` thành điểm gọi tinh gọn ủy quyền hoàn toàn cho default pipeline:
```typescript
import { createSeoPipeline } from "./internal/pipeline";
import type { SeoContentInput, SeoContentOutput } from "./types";

const defaultPipeline = createSeoPipeline();

export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return defaultPipeline.execute(input);
}
```

---

## 4. Kế Hoạch Kiểm Thử & Xác Thực (Verification Plan)

### 4.1. Unit Test Mới: `src/modules/module-seo-content/__tests__/pipeline.test.ts`
Xây dựng tối thiểu 7 bài test chuyên sâu cho kiến trúc Pipeline:
1. **Thứ tự thực thi tuần tự (Sequential Order)**: Tạo các spy stage để kiểm tra pipeline gọi chính xác theo thứ tự `b1 -> b2 -> b3 -> b4 -> b5 -> b6`.
2. **Bảo toàn dữ liệu đầu vào (Source Data Preservation)**: Xác nhận đối tượng `context.source` ở Stage B6 vẫn giữ nguyên 100% các trường ban đầu (`images`, `niche`, `title`, `description`, `handle`).
3. **Tính bất biến (Immutability)**: Xác nhận `currentContext !== previousContext` sau mỗi bước xử lý.
4. **Error Boundary - Dừng khi lỗi Fatal**: Bơm vào một stage giả lập ném lỗi nghiêm trọng $\rightarrow$ xác nhận pipeline dừng lại ngay lập tức, trả về `SeoStageError` với đúng `stageName`.
5. **Error Boundary - Khả năng phục hồi (Recoverable Fallback)**: Bơm vào một stage ném lỗi recoverable $\rightarrow$ pipeline ghi nhận fallback và vẫn hoàn tất đến stage cuối cùng.
6. **Kiểm tra Dependency Injection**: Xác minh `createSeoPipeline(customStages)` cho phép tùy biến hoặc hoán đổi bất kỳ stage nào mà không phụ thuộc vào môi trường bên ngoài.
7. **End-to-End Pipeline Baseline Output**: Kiểm tra khi đưa `seoContentMockInput` qua default pipeline thì đầu ra nhận được thỏa mãn toàn bộ cấu trúc của `SeoContentOutput`.

### 4.2. Bảo Lưu và Xác Thực Tests Hiện Có (`service.test.ts`)
- 10 bài unit test đã viết ở Phase 0 trong [`service.test.ts`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/module-seo-content/__tests__/service.test.ts) phải tiếp tục pass 100% mà không cần sửa đổi lớn.

### 4.3. Các Lệnh Kiểm Tra Nghiệm Thu Bắt Buộc (Theo `AGENTS.md`)
```bash
# 1. Chạy toàn bộ unit test của module SEO Content (bao gồm cả service.test.ts và pipeline.test.ts)
npx tsx --test src/modules/module-seo-content/__tests__/*.test.ts

# 2. Chạy toàn bộ test suite dự án (bao gồm Module A, B, C và Orchestrator)
npm test

# 3. Kiểm tra kiểu dữ liệu TypeScript (Strict mode - Không có lỗi type nào)
npm run typecheck

# 4. Kiểm tra Build Production của Vite
npm run build

# 5. Kiểm tra Build Mock của Vite
npm run build:mock
```

---

## 5. Rủi Ro Tiềm Ẩn & Biện Pháp Phòng Ngừa

| Rủi ro | Nguy cơ | Biện pháp phòng ngừa |
| :--- | :--- | :--- |
| **Rò rỉ kiểu nội bộ ra `index.ts`** | Vi phạm quy tắc ranh giới module của `AGENTS.md` | Tuyệt đối không export bất kỳ file nào từ `internal/` trong `src/modules/module-seo-content/index.ts`. Chỉ export public contract từ `types.ts`. |
| **Mutate nhầm dữ liệu context** | Gây side-effects khó debug giữa các stage | Sử dụng `readonly` trên toàn bộ thuộc tính của `SeoPipelineContext` và các domain types; đóng băng đối tượng (freeze/shallow copy) khi chuyển stage. |
| **Lỗi TypeScript `strict` mode** | Bị lỗi khi build hoặc typecheck | Không sử dụng `any`, kiểm tra chặt chẽ `undefined` khi truy xuất các trường tùy chọn trong `context`. |
| **Làm gãy 10 test có sẵn của Phase 0** | Gây hồi quy (regression) | Giữ nguyên logic chuẩn hóa chuỗi và fallback an toàn trong stage B5 và B6 tương đương với `service.ts` của Phase 0. |

---

## 6. Tiêu Chí Hoàn Thành (Definition of Done)

- [ ] Tạo đầy đủ thư mục `internal/` và các tệp: `domain-types.ts`, `pipeline-context.ts`, `pipeline-errors.ts`, `pipeline.ts`, và 6 stage baseline trong `stages/`.
- [ ] Cập nhật `service.ts` để kết nối vào default pipeline.
- [ ] Không chỉnh sửa hoặc thêm export nội bộ vào `index.ts`.
- [ ] Tạo mới `__tests__/pipeline.test.ts` với tối thiểu 7 test cases bao phủ toàn diện.
- [ ] Toàn bộ các lệnh kiểm thử hệ thống: `npx tsx --test ...`, `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock` đều pass 100%.
- [ ] Tạo commit Git có thông điệp rõ ràng tuân thủ `AGENTS.md`: `feature(module-seo): implement Phase 1 internal pipeline and domain types`.
