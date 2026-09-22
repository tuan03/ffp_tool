# CONTRACT MAIN ↔ PRODUCT CRAWLER
## Kế hoạch thiết kế UI & Hợp đồng tích hợp cho Module MAIN

> **Mục tiêu:** Làm mới phần UI của tool cào sản phẩm theo kiến trúc mới:  
> **MAIN UI** là lớp trung gian nhận thao tác người dùng → gửi input cho **Product Crawler Module** → theo dõi job → nhận output → hiển thị kết quả → cho phép chọn sản phẩm để bàn giao sang module tiếp theo.
>
> **Nguyên tắc:** MAIN không chứa logic crawl Amazon, parse variant, crawl customize, retry, captcha hay xử lý proxy. Tất cả logic đó thuộc Product Crawler Module.

---

# 1. Kiến trúc tổng thể

```text
USER
  ↓
MAIN UI
  ↓
Product Crawler Contract
  ↓
PRODUCT CRAWLER MODULE
  ↓
Amazon / nguồn dữ liệu
  ↓
PRODUCT CRAWLER MODULE xử lý
  ↓
Crawler Job Output
  ↓
MAIN UI
  ↓
Review / Select Products
  ↓
Module tiếp theo
(SEO + Content / Shopify / ...)
```

### Vai trò của MAIN

MAIN chịu trách nhiệm:

1. Nhận input từ user.
2. Validate input cơ bản.
3. Gửi request tạo crawl job.
4. Giữ `jobId`.
5. Polling trạng thái job.
6. Hiển thị progress / logs / warning.
7. Hiển thị danh sách sản phẩm crawl được.
8. Cho user xem chi tiết từng sản phẩm.
9. Cho user chọn một hoặc nhiều sản phẩm.
10. Bàn giao sản phẩm đã chọn sang module tiếp theo.

### Vai trò của Product Crawler

Crawler chịu trách nhiệm:

1. Nhận input từ MAIN.
2. Chuẩn hóa ASIN / Amazon URL.
3. Crawl product.
4. Crawl source variants.
5. Crawl final variants.
6. Crawl customization nếu có.
7. Crawl media.
8. Retry / captcha / cache / proxy.
9. Trả trạng thái tiến độ.
10. Trả product output chuẩn cho MAIN.

---

# 2. Workflow UI đề xuất

MAIN nên có 3 giai đoạn rõ ràng:

```text
[1. Nhập nguồn]  →  [2. Đang cào]  →  [3. Kết quả & Bàn giao]
```

## Giai đoạn 1 — Nhập nguồn

User nhập sản phẩm Amazon cần crawl.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PRODUCT CRAWLER                                                     │
│ [1. Nhập nguồn] → [2. Đang cào] → [3. Kết quả]                    │
├────────────────────────────────┬─────────────────────────────────────┤
│ INPUT                          │ CẤU HÌNH                            │
│                                │                                     │
│ Amazon URL / ASIN              │ Crawl Mode                          │
│ ┌────────────────────────────┐ │ (•) Exact ASIN                     │
│ │ B0XXXXXXXX                │ │ ( ) Variant Group                   │
│ │ https://amazon.com/dp/... │ │                                     │
│ └────────────────────────────┘ │ Advanced ▾                          │
│                                │ ZIP: 10001                          │
│ Có thể nhập nhiều dòng         │ Headless: Off                       │
│                                │                                     │
│ [Validate]                     │                                     │
│                                │                                     │
│ [▶ Start Crawl]                │                                     │
└────────────────────────────────┴─────────────────────────────────────┘
```

### UI input bắt buộc

- Amazon URL hoặc ASIN.
- Crawl Mode:
  - `exact`: chỉ crawl đúng ASIN được nhập.
  - `group`: crawl cả nhóm variant của sản phẩm.

### Advanced Settings

Không nên hiện tất cả setting kỹ thuật ở màn hình chính.

Có thể cho vào `Advanced Settings`:

- `profileSlug`
- `productThreads`
- `variantThreads`
- `urllibThreads`
- `browserProfiles`
- `browserTabs`
- `headless`
- `amazonZip`
- `captchaTimeoutSeconds`
- `maxMatrixVariants`

MAIN có thể dùng default của Crawler nếu user không mở Advanced.

---

# 3. Input Contract: MAIN → Product Crawler

## 3.1. Request tạo Crawl Job

### Đề xuất endpoint

```http
POST /api/product-crawler/jobs
Content-Type: application/json
```

### Payload

```json
{
  "source": "amazon",
  "inputs": [
    {
      "type": "asin",
      "value": "B0GQ33XWW7"
    }
  ],
  "crawlMode": "group",
  "options": {
    "profileSlug": "default",
    "amazonZip": "10001",
    "headless": false
  }
}
```

### TypeScript Contract

```ts
export interface ProductCrawlerJobInput {
  source: "amazon";

  inputs: Array<{
    type: "asin" | "url";
    value: string;
  }>;

  crawlMode: "exact" | "group";

  options?: {
    profileSlug?: string;
    productThreads?: number;
    variantThreads?: number;
    urllibThreads?: number;
    browserProfiles?: number;
    browserTabs?: number;
    headless?: boolean;
    amazonZip?: string;
    captchaTimeoutSeconds?: number;
    maxMatrixVariants?: number;
  };
}
```

### MAIN không gửi

MAIN không nên gửi:

- trạng thái captcha hiện tại;
- fetch mode;
- cache result;
- retry attempts;
- customization fingerprint;
- diagnostics;
- internal browser state.

Đây là dữ liệu nội bộ của crawler.

---

# 4. Response ngay sau khi tạo Job

Crawler không cần trả toàn bộ sản phẩm ngay.

Nó chỉ cần trả:

```json
{
  "ok": true,
  "jobId": "bd817fbad4394851",
  "status": "running"
}
```

MAIN giữ `jobId`.

```text
jobId = mã phiên crawl
```

Mọi request tiếp theo dùng `jobId`.

---

# 5. Giai đoạn 2 — Đang Crawl

Sau khi có `jobId`, MAIN chuyển UI sang trạng thái Running.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Product Crawl                                                       │
│ Job: bd817fbad4394851                             ● Running          │
├──────────────────────────────────────────────────────────────────────┤
│ Progress                                                            │
│ ███████████████████░░░░░░░░ 68%                                    │
│                                                                      │
│ ✓ Validate input                                                    │
│ ✓ Fetch Amazon product                                              │
│ ✓ Crawl source variants                                             │
│ ● Crawl variants & customization                                    │
│ ○ Finalize products                                                 │
│                                                                      │
│ Products: 7 / 10                                                    │
│                                                                      │
│ ▼ Logs                                                              │
│ [20:44:15] Fetch product B0GQ33XWW7                                 │
│ [20:44:42] Found variant C01                                        │
│ [20:45:10] Customization parsed                                     │
│                                                                      │
│ [Cancel Job]                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

# 6. Polling Contract

### Đề xuất endpoint

```http
GET /api/product-crawler/jobs/:jobId
```

MAIN polling khoảng:

```text
1.5 – 2 giây / lần
```

### Trạng thái chuẩn

```ts
export type ProductCrawlerJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
```

### Response khi đang chạy

```json
{
  "ok": true,
  "jobId": "bd817fbad4394851",
  "status": "running",

  "stepper": {
    "currentStep": 3,
    "percent": 68,
    "currentMessage": "Đang crawl variants và customization..."
  },

  "summary": {
    "requestedInputs": 1,
    "productsFound": 7,
    "productsCompleted": 5,
    "productsFailed": 0
  },

  "logs": [
    "Fetch product...",
    "Found variant...",
    "Customization parsed..."
  ]
}
```

MAIN chỉ render:

- `status`
- `stepper.percent`
- `stepper.currentMessage`
- `summary`
- `logs`

MAIN không tự tính tiến độ crawler.

---

# 7. Cancel Job

### Endpoint đề xuất

```http
POST /api/product-crawler/jobs/:jobId/cancel
```

Response:

```json
{
  "ok": true,
  "status": "cancelled"
}
```

MAIN chuyển UI:

```text
Status: Cancelled
```

Không xóa dữ liệu đã crawl được nếu backend vẫn còn kết quả partial.

---

# 8. Giai đoạn 3 — Output cuối của Product Crawler

Khi:

```text
status = completed
```

Crawler trả output job.

Cấu trúc tổng quát:

```ts
export interface ProductCrawlerJobOutput {
  version: string;

  jobId: string;

  status: "completed" | "partial";

  startedAt: string;
  completedAt: string;

  products: CrawlerProduct[];

  errors: CrawlerError[];
  warnings: string[];

  statistics: {
    requestedInputs: number;
    acceptedInputs: number;
    rejectedInputs: number;
    products: number;
    sourceVariants: number;
    finalVariants: number;
    durationMs: number;
  };
}
```

---

# 9. Product Output mà MAIN nhận

Mỗi product của crawler nên giữ đầy đủ dữ liệu nghiệp vụ.

```ts
export interface CrawlerProduct {
  id: string;

  parentAsin?: string;

  canonicalUrl: string;

  sourceTitle?: string;

  title: string;

  description?: string;

  bulletPoints?: string[];

  categories?: string[];

  productDetails?: Record<string, string>;

  media: CrawlerMedia[];

  sourceVariants: SourceVariant[];

  variants: ProductVariant[];

  variantMatrix?: VariantMatrix;

  customization?: ProductCustomization | null;

  splitContext?: SplitContext;

  warnings?: string[];

  diagnostics?: CrawlerDiagnostics;
}
```

Dữ liệu thực tế crawler hiện đã có các nhóm:

```text
Product
├── id
├── parentAsin
├── canonicalUrl
├── sourceTitle
├── title
├── description
├── bulletPoints
├── categories
├── productDetails
├── media[]
├── sourceVariants[]
├── variants[]
├── variantMatrix
├── customization
├── splitContext
├── warnings[]
└── diagnostics
```

---

# 10. Media

```ts
export interface CrawlerMedia {
  url: string;

  kind: "image" | "video";

  sourceAsin?: string;
}
```

MAIN dùng:

```text
media.filter(item => item.kind === "image")
```

để render ảnh.

UI không cần download ảnh về trước.

---

# 11. Variants

Crawler trả `variants[]`.

Ví dụ:

```json
{
  "id": "B0GQ3JQ144-...",
  "sku": "B0GQ3JQ144-...",
  "sourceAsin": "B0GQ3JQ144",

  "options": {
    "Would you like to purchase a matching Leather Long Wallet?": "No",
    "Choose Leather Bag Size": "Medium"
  },

  "price": {
    "amount": 39.95,
    "currency": "USD"
  },

  "surcharge": {
    "amount": 12,
    "currency": "USD"
  }
}
```

MAIN không cần hiểu cách crawler tạo variant.

MAIN chỉ hiển thị:

```text
Medium
$39.95
Wallet: No
Size: Medium
```

---

# 12. Customization

Customization là output của crawler, không phải logic MAIN.

MAIN chỉ kiểm tra:

```ts
product.customization !== null
```

để hiện:

```text
🟢 Có Customize
```

hoặc:

```text
⚪ Không Customize
```

### Dữ liệu customization có thể gồm

```text
source
product image
surfaces
optionGroups
textInputs
imageInputs
fontGroups
colorGroups
placements
pricing
assets
```

MAIN không tự build lại customization logic.

Trong Product Detail có thể render dạng:

```text
Customize
────────────────────────────

Custom Name
Required: Yes
Placeholder: Sophia

Confirmation
○ Yes, Confirm
○ No, Need support

Paid Options
Wallet:
No       +$0
Yes      +$26

Size:
Minisize +$0
Medium   +$12
Large    +$32
X-Large  +$62
```

Có thêm tab:

```text
[Raw JSON]
```

cho Developer/Debug.

---

# 13. UI Results

Sau khi crawl xong, MAIN chuyển sang Results.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CRAWL RESULT                                                               │
│ 10 Products                     73 Variants                    Completed ✓  │
├───┬──────────────┬──────────┬──────────┬────────────┬────────────┬──────────┤
│   │ Product      │ ASIN     │ Variants │ Customize  │ Warning    │ Status   │
├───┼──────────────┼──────────┼──────────┼────────────┼────────────┼──────────┤
│ ☑ │ [img] C01   │ ...      │ 8        │ ✓          │ -          │ Success  │
│ ☑ │ [img] C04   │ ...      │ 8        │ ✓          │ -          │ Success  │
│ ☐ │ [img] C06   │ ...      │ 1        │ ! Failed   │ Warning    │ Partial  │
└───┴──────────────┴──────────┴──────────┴────────────┴────────────┴──────────┘

[Select All] [Clear]

Selected: 2

[View Selected]
[Send Selected to SEO + Content]
```

---

# 14. Product Row — Dữ liệu MAIN thực sự cần

Không render toàn bộ JSON vào Table.

MAIN tạo UI projection:

```ts
export interface CrawlerProductListItem {
  id: string;

  title: string;

  thumbnailUrl?: string;

  asin?: string;

  variantCount: number;

  hasCustomization: boolean;

  warningCount: number;

  status: "success" | "partial" | "failed";
}
```

Ví dụ:

```ts
const item = {
  id: product.id,
  title: product.title,
  thumbnailUrl: firstImage,
  asin: product.productDetails?.ASIN,
  variantCount: product.variants.length,
  hasCustomization: product.customization !== null,
  warningCount: product.warnings?.length ?? 0
};
```

Full JSON vẫn giữ nguyên trong state/store.

---

# 15. Product Detail UI

Khi user click Product:

```text
┌──────────────────────────────────────────────────────────────┐
│ Product Detail                                             X │
├──────────────────────────────────────────────────────────────┤
│ [Overview] [Media] [Variants] [Customize] [Details] [JSON] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Ảnh]                                                        │
│                                                              │
│ Custom Christian Leather Handbag ...                         │
│                                                              │
│ ASIN: B0...                                                  │
│ Source: Amazon                                               │
│ URL: amazon.com/...                                          │
│                                                              │
│ Variants: 8                                                  │
│ Customize: Yes                                               │
│ Warnings: 0                                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Tabs

#### Overview

Hiện:

- title
- description
- bullet points
- canonical URL
- source title

#### Media

Hiện:

- images
- videos

#### Variants

Hiện:

- variant name/options
- price
- surcharge
- SKU
- source ASIN

#### Customize

Hiện customization đã parse.

#### Details

Hiện `productDetails`.

#### JSON

Hiện full raw product JSON.

---

# 16. Filter / Search

Results nên có:

```text
Search Product
[________________]

Filter:
[All]
[Success]
[Partial]
[Has Customize]
[Warning]
[No Customize]
```

Filter chỉ làm ở MAIN.

Không cần gọi crawler lại.

---

# 17. Warning / Partial Product

Crawler hiện có trường hợp:

```text
Amazon indicates customization,
but its widget payload could not be parsed.
```

Do đó MAIN phải hỗ trợ:

```text
Success
Partial
Failed
```

Không nên coi một customization parse lỗi là toàn bộ product bị mất.

Ví dụ:

```text
Product C06

Product data:       ✓
Images:             ✓
Variants:           Partial
Customization:      ✕
Warning:            1

Status: Partial
```

User vẫn có thể xem/select sản phẩm nếu business cho phép.

---

# 18. Error Contract

```ts
export interface CrawlerError {
  code: string;

  message: string;

  input?: string;

  productId?: string;

  retryable: boolean;

  details?: unknown;
}
```

MAIN render:

```text
Crawl Failed

Input:
B0XXXXXXXX

Reason:
Amazon product unavailable

[Retry]
```

Không hiện stack trace cho user thường.

Có thể có:

```text
View Technical Details
```

trong Developer Mode.

---

# 19. Bàn giao sang SEO + Content

Đây là ranh giới rất quan trọng.

Crawler **không gọi trực tiếp SEO + Content**.

Luồng đúng:

```text
Crawler
  ↓
CrawlerProduct[]
  ↓
MAIN
  ↓
User chọn products
  ↓
MAIN Adapter
  ↓
SeoContentInput[]
  ↓
SEO + Content
```

Ví dụ MAIN chọn:

```text
☑ Product C01
☑ Product C04
```

Sau đó bấm:

```text
[Send 2 Products to SEO + Content]
```

MAIN dùng adapter:

```ts
function crawlerProductToSeoInput(
  product: CrawlerProduct
): SeoContentInput {
  // mapping contract
}
```

Không đặt logic mapping SEO vào Product Crawler.

---

# 20. Dữ liệu Crawler nên chuyển cho SEO Adapter

Tối thiểu:

```text
id
title
description
bulletPoints
media images
productDetails
canonicalUrl
customization
```

Tùy SEO Content contract, MAIN adapter sẽ chọn field phù hợp.

Ví dụ:

```ts
{
  productId: product.id,

  title: product.title,

  description: product.description,

  images: product.media
    .filter(x => x.kind === "image")
    .map(...),

  sourceUrl: product.canonicalUrl,

  sourceContext: {
    bulletPoints: product.bulletPoints,
    productDetails: product.productDetails,
    customization: product.customization
  }
}
```

---

# 21. State MAIN cần quản lý

```ts
interface ProductCrawlerUiState {
  inputs: CrawlInputRow[];

  crawlMode: "exact" | "group";

  jobId?: string;

  status:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "cancelled";

  stepper?: CrawlStepper;

  logs: string[];

  products: CrawlerProduct[];

  selectedProductIds: string[];

  errors: CrawlerError[];

  warnings: string[];

  statistics?: CrawlStatistics;
}
```

MAIN không lưu state nội bộ của Chromium.

---

# 22. API Summary đề xuất

| Chức năng | Method | Endpoint | MAIN gửi |
|---|---|---|---|
| Start Crawl | `POST` | `/api/product-crawler/jobs` | inputs + crawlMode + options |
| Get Job | `GET` | `/api/product-crawler/jobs/:jobId` | jobId |
| Cancel | `POST` | `/api/product-crawler/jobs/:jobId/cancel` | jobId |
| Retry failed | `POST` | `/api/product-crawler/jobs/:jobId/retry` | failed input/product IDs |
| Export JSON | `GET` | `/api/product-crawler/jobs/:jobId/export` | jobId |

`Retry` và `Export` có thể để Phase sau nếu crawler module chưa hỗ trợ.

---

# 23. Boundary — MAIN được làm gì / không được làm gì

## MAIN được làm

```text
Input UI
Validate cơ bản
Start job
Polling
Progress UI
Logs UI
Product Table
Product Detail
Filter
Select
Review
Handoff
```

## MAIN không làm

```text
Fetch Amazon HTML
Parse Amazon
Resolve ASIN
Crawl variant
Crawl customization
Calculate price surcharge
Solve captcha
Manage proxy
Browser automation
Cache crawl result
Retry network internally
```

---

# 24. Implementation Plan

## Phase 1 — Chốt Contract

Tạo:

```text
src/modules/product-crawler/
  contract.ts
```

Định nghĩa:

```text
ProductCrawlerJobInput
ProductCrawlerJobStatus
ProductCrawlerJobOutput
CrawlerProduct
CrawlerMedia
ProductVariant
ProductCustomization
CrawlerError
```

Không code UI trước khi chốt contract.

### Done khi

- MAIN compile được chỉ bằng contract.
- Crawler owner xác nhận input/output.
- Không import internal crawler code.

---

## Phase 2 — Product Crawler Client

Tạo adapter/client phía MAIN:

```text
src/modules/orchestrator/product-crawler-client.ts
```

Functions:

```ts
startCrawlerJob()
getCrawlerJob()
cancelCrawlerJob()
```

### Done khi

Có thể chạy bằng mock:

```text
Start
→ Running
→ Completed
```

mà chưa cần crawler thật.

---

## Phase 3 — Input UI

Tạo:

```text
ProductCrawlerPage

CrawlInputForm
CrawlModeSelector
AdvancedCrawlerSettings
```

Features:

- paste nhiều URL/ASIN;
- validate empty/duplicate;
- exact/group;
- start button;
- disable start khi invalid.

---

## Phase 4 — Job Progress UI

Tạo:

```text
CrawlerRunPanel
CrawlerStepper
CrawlerProgress
CrawlerLogs
CrawlerSummary
```

MAIN polling theo `jobId`.

### Done khi

Mock job có thể đổi:

```text
queued
→ running
→ completed
```

UI cập nhật đúng.

---

## Phase 5 — Results UI

Tạo:

```text
CrawlerProductTable
CrawlerProductRow
CrawlerFilters
CrawlerSelectionToolbar
```

Hiển thị:

```text
Image
Title
ASIN
Variants
Customize
Warnings
Status
```

Có checkbox multi-select.

---

## Phase 6 — Product Detail

Tạo:

```text
CrawlerProductDetail
```

Tabs:

```text
Overview
Media
Variants
Customize
Details
JSON
```

### Done khi

Có thể đọc chính xác một product output thật của crawler.

---

## Phase 7 — Handoff

Tạo:

```text
crawlerProductToSeoInput()
```

Flow:

```text
selectedProductIds
→ lấy CrawlerProduct[]
→ adapter
→ SeoContentInput[]
→ gọi SEO + Content
```

Crawler không biết SEO Content tồn tại.

---

## Phase 8 — Error / Partial / Retry

UI phải xử lý:

```text
failed job
partial job
product warning
customization warning
cancelled
network polling error
```

Không mất các product đã crawl thành công.

---

## Phase 9 — Tests

### Unit Test

Test:

- input validation;
- product → table item mapping;
- product → SEO input mapping;
- status mapping;
- warning count;
- hasCustomization.

### Integration Test

Mock:

```text
POST start
→ jobId

GET job
→ running

GET job
→ completed + products
```

Kiểm tra:

- UI progress;
- table render;
- selection;
- product detail;
- handoff.

### Smoke Test

Chạy một ASIN thật:

```text
Input
→ Start
→ Running
→ Completed
→ Product visible
→ Detail visible
→ Select
→ Handoff payload đúng
```

---

# 25. Acceptance Criteria

MAIN UI đạt yêu cầu khi:

- [ ] User nhập được Amazon URL / ASIN.
- [ ] MAIN gửi đúng ProductCrawlerJobInput.
- [ ] MAIN nhận được jobId.
- [ ] MAIN polling được trạng thái.
- [ ] Hiển thị progress.
- [ ] Hiển thị logs.
- [ ] Cancel được job.
- [ ] Nhận được `products[]`.
- [ ] Render được danh sách Product.
- [ ] Xem được Product Detail.
- [ ] Xem được Variants.
- [ ] Xem được Customize.
- [ ] Hiển thị Warning/Partial.
- [ ] Multi-select được Product.
- [ ] Không chứa logic crawl trong UI.
- [ ] Có adapter bàn giao sản phẩm sang SEO + Content.
- [ ] Module crawler không phụ thuộc SEO + Content.
- [ ] MAIN không import internal file của Product Crawler.

---

# 26. Luồng cuối cùng cần đạt

```text
USER
 │
 │ Amazon URL / ASIN
 ▼
MAIN UI
 │
 │ ProductCrawlerJobInput
 ▼
ORCHESTRATOR / PUBLIC CONTRACT
 │
 ▼
PRODUCT CRAWLER
 │
 ├── Product
 ├── Media
 ├── Source Variants
 ├── Variants
 ├── Customize
 └── Diagnostics
 │
 ▼
ProductCrawlerJobOutput
 │
 ▼
MAIN UI
 │
 ├── Progress
 ├── Results
 ├── Product Detail
 ├── Select
 └── Review
 │
 ▼
MAIN Adapter
 │
 ▼
SEO + CONTENT / Module tiếp theo
```

---

# 27. Nguyên tắc chốt

> **Product Crawler là module xử lý dữ liệu. MAIN là module điều phối và hiển thị.**

MAIN không cần biết:

```text
Crawler dùng Python hay Node
Crawler mở Chromium thế nào
Crawler parse Customize thế nào
Crawler retry bao nhiêu lần
```

MAIN chỉ cần biết:

```text
INPUT CONTRACT
      ↓
JOB STATUS
      ↓
PRODUCT OUTPUT CONTRACT
      ↓
USER ACTION
      ↓
HANDOFF
```

Đây là ranh giới cần giữ cố định để sau này thay crawler implementation mà không phải viết lại MAIN UI.
