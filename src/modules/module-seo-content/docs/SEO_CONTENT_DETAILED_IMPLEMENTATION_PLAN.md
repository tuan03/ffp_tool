# SEO + Content Module — Detailed Implementation Plan

> Mục tiêu của tài liệu này là biến kế hoạch tổng quát thành một lộ trình triển khai có thể giao cho AI Agent hoặc developer thực hiện theo từng phase.
>
> Tài liệu tập trung vào:
> - việc cần làm;
> - yêu cầu nghiệp vụ;
> - yêu cầu kỹ thuật;
> - output/deliverable của từng phase;
> - test/điều kiện hoàn thành.
>
> Public contract hiện tại của module:
>
> **Input**
> - product images
> - niche
> - current product title
> - current product description
> - current product handle
>
> **Output**
> - product title
> - product description
> - product SEO title
> - product SEO description
> - product image alt
> - product image as WebP
> - product handle

---

# 1. Nguyên tắc triển khai

SEO + Content phải được triển khai như **một business module độc lập**.

Các module khác chỉ được biết:

```text
SeoContentInput
      ↓
SEO + Content
      ↓
SeoContentOutput
```

Không expose trực tiếp B1–B6 ra ngoài module trừ khi sau này có quyết định kiến trúc mới.

Flow nội bộ:

```text
Input
  ↓
B1 Product Understanding
  ↓
B2 Audience / Buying Context
  ↓
B3 Search Suggestion Collection
  ↓
B4 SEO Conflict Control
  ↓
B5 Search Intent + Content Generation
  ↓
B6 Image Processing
  ↓
Output
```

SEO + Content không tự ghi dữ liệu lên Shopify nếu project vẫn giữ Shopify API là module riêng.

---

# 2. Phase 0 — Chuẩn bị module và chốt contract

## Mục tiêu

Biến `module-seo-content` từ scaffold hiện tại thành module có contract nghiệp vụ thật, nhưng chưa cần triển khai logic B1–B6 ngay.

## Việc cần làm

1. Xóa/đổi toàn bộ tên placeholder còn sót từ Module B.
2. Tạo public input/output type đúng nghiệp vụ.
3. Tạo status/error types nếu cần.
4. Chuẩn hóa cách module được gọi:
   ```ts
   runSeoContent(input): Promise<SeoContentOutput>
   ```
5. Tạo mock input/output đại diện.
6. Đảm bảo real runner và mock runner dùng cùng contract.
7. Chỉ export public API cần thiết qua `index.ts`.

## Yêu cầu nghiệp vụ

Input tối thiểu phải biểu diễn được:

```text
- images
- niche
- title
- description
- handle
```

Output tối thiểu phải biểu diễn được:

```text
- productTitle
- productDescription
- productSeoTitle
- productSeoDescription
- images[].alt
- images[].webp
- productHandle
```

Không thêm các field bắt buộc chưa được thống nhất với leader.

Có thể có metadata nội bộ nhưng không làm thay đổi public contract nếu chưa cần consumer sử dụng.

## Yêu cầu kỹ thuật

Đề xuất public types:

```ts
interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string;
}

interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
}

interface SeoContentWebpAsset {
  readonly filename: string;
  readonly localFilePath?: string;            // Đường dẫn trên đĩa (để Node.js fs đọc/ghi trực tiếp)
  readonly url?: string;                      // Relative URL để UI hiển thị (/api/...)
  readonly data?: Buffer | Uint8Array | Blob; // Hỗ trợ Buffer của Node.js hoặc Blob
}

interface SeoContentImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: SeoContentWebpAsset;
}

interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  readonly productHandle: string;
}
```

> **Xác nhận môi trường từ Leader & Hợp đồng dự án**:
> Theo xác nhận từ Leader và quy chuẩn tại [`docs/CONTRACT_MAIN_TO_PINTEREST_POD.md`](../../../../docs/CONTRACT_MAIN_TO_PINTEREST_POD.md) (mục 1.2), hệ thống hỗ trợ đọc/ghi trực tiếp file trên ổ đĩa bằng **Node.js `fs`** và xử lý dữ liệu nhị phân qua **`Buffer`**.
> 
> Do đó, `SeoContentWebpAsset` được định nghĩa toàn diện:
> - `localFilePath`: để các module Node.js/Python đọc/ghi trực tiếp trên ổ đĩa (`temp/` hoặc `data/`) nhanh hơn 10 lần mà không cần truyền tải qua HTTP;
> - `url`: relative URL (`/api/...`) để giao diện web hiển thị ảnh;
> - `data`: chứa trực tiếp `Buffer` của Node.js hoặc `Blob`.

## Files dự kiến

```text
src/modules/module-seo-content/
├── index.ts
├── types.ts
├── service.ts
├── runtime.ts
├── mocks/
│   ├── data.ts
│   └── runner.ts
└── __tests__/
    └── service.test.ts
```

## Test

- input mock hợp lệ;
- output mock đúng public shape;
- mock runner không mutation fixture;
- service trả đúng output type;
- không còn tên `ModuleB*` trong module.

## Done khi

```text
npm test
npm run typecheck
npm run build
npm run build:mock
```

đều pass.

---

# 3. Phase 1 — Tạo internal pipeline và domain types

## Mục tiêu

Tạo skeleton B1 → B6 trước khi viết logic thật để từng bước có input/output nội bộ rõ ràng.

## Việc cần làm

1. Tạo các internal types cho từng stage.
2. Tạo pipeline function chạy tuần tự B1 → B6.
3. Không expose các internal type qua `index.ts`.
4. Xác định dữ liệu nào cần truyền từ stage trước sang stage sau.
5. Tạo error boundary giữa các stage.

## Yêu cầu nghiệp vụ

Module phải đảm bảo dữ liệu từ input gốc không bị mất trong pipeline.

Ví dụ:

```text
niche
title
description
handle
images
```

vẫn có thể được sử dụng ở B5/B6 dù B1/B2 đã tạo thêm dữ liệu phân tích.

## Yêu cầu kỹ thuật

Có thể tổ chức:

```text
internal/
├── pipeline.ts
├── domain-types.ts
├── b1-product-understanding.ts
├── b2-shopping-context.ts
├── b3-search-suggestions.ts
├── b4-conflict-control.ts
├── b5-content-generation.ts
└── b6-image-processing.ts
```

Không bắt buộc đúng tên trên, nhưng phải giữ rõ responsibility.

Đề xuất internal pipeline context:

```ts
interface SeoPipelineContext {
  readonly source: SeoContentInput;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly searchResearch?: SearchResearchResult;
  readonly conflictResult?: ConflictResult;
  readonly contentResult?: ContentResult;
  readonly imageResult?: ImageProcessingResult;
}
```

Không dùng `any`.

## Test

- pipeline gọi đúng thứ tự;
- stage lỗi thì pipeline dừng và trả error phù hợp;
- stage không mutate input;
- dependency của stage có thể inject để test.

---

# 4. Phase 2 — B1 Product Understanding

## Mục tiêu

Đọc ảnh sản phẩm và dữ liệu text gốc để tạo structured product understanding.

## Việc cần làm

### 4.1 Phân tích text hiện tại

Từ:

```text
title
description
niche
handle
```

rút ra các tín hiệu có ích:

- loại/chủ đề sản phẩm;
- personalization terms;
- entities chính;
- từ mô tả style/theme;
- các cụm có thể hỗ trợ B2/B3.

Nếu description là HTML:

1. extract meaningful text;
2. bỏ markup không cần thiết khi phân tích;
3. không làm mất nội dung quan trọng;
4. không render HTML không an toàn trong React.

### 4.2 Phân tích ảnh

B1 cần hỗ trợ:

- OCR text trên design;
- visual entities;
- colors;
- theme/style;
- personalization signals.

Ví dụ:

```text
Image:
black cat + full moon + "The Smith Family"

Output:
ocrText = "The Smith Family"
entities = ["black cat", "full moon"]
themes = ["Halloween"]
personalization = ["family name"]
```

### 4.3 Tạo structured result

B1 không generate SEO title/content.

Chỉ tạo facts/context.

## Yêu cầu nghiệp vụ

- Không hallucinate text OCR.
- Nếu OCR không chắc chắn, phải có confidence/uncertainty hoặc để trống.
- Không tự đổi niche do upstream truyền vào.
- Có thể bổ sung sub-theme nhưng niche gốc phải được giữ.
- Phân tích ảnh nào phải liên kết được với ảnh nguồn đó.

## Yêu cầu kỹ thuật

Tạo abstraction cho vision/OCR:

```ts
interface ProductVisionAnalyzer {
  analyze(
    images: readonly SeoContentImageInput[],
    context: ProductVisionContext,
  ): Promise<ProductVisualAnalysis>;
}
```

Không hardcode provider vào business logic.

Provider có thể là:

```text
AI Vision API
OCR engine
future local vision service
```

Chưa chọn provider thì implement interface + fake adapter trước.

Nếu dùng external API:

- validate response;
- timeout;
- retry có giới hạn;
- không log secrets;
- error code rõ ràng.

## Output nội bộ B1

Ví dụ:

```ts
interface ProductUnderstanding {
  readonly niche: string;
  readonly sourceTitle: string;
  readonly sourceDescriptionText: string;
  readonly visualEntities: readonly string[];
  readonly detectedText: readonly DetectedText[];
  readonly themes: readonly string[];
  readonly colors: readonly string[];
  readonly styles: readonly string[];
  readonly personalizationSignals: readonly string[];
}
```

## Test

- description HTML được extract đúng;
- OCR empty vẫn chạy;
- multiple images được merge đúng;
- không duplicate entity;
- provider error được wrap;
- không mutation input.

---

# 5. Phase 3 — B2 Audience & Buying Context

## Mục tiêu

Biến facts từ B1 thành shopping context.

## Việc cần làm

Phân tích:

- recipient/user;
- potential buyer;
- relationship;
- occasion;
- gift context;
- use context.

Ví dụ:

```text
"Best Grandma Ever" blanket

recipient:
grandma

buyer:
daughter / son / grandchild

occasion:
birthday / Mother's Day / Christmas

shopping context:
gift for grandma
```

## Yêu cầu nghiệp vụ

B2 không phải Search Intent.

B2 trả lời:

```text
Ai dùng?
Ai mua?
Mua cho ai?
Mua vào dịp nào?
Dùng trong hoàn cảnh nào?
```

Không trả lời:

```text
Transactional / Informational / Commercial
```

vì đó thuộc B5.

Không thêm audience vô lý chỉ để tạo nhiều keyword.

Context phải liên quan trực tiếp tới B1 + niche + product text.

## Yêu cầu kỹ thuật

Tạo abstraction:

```ts
interface ShoppingContextAnalyzer {
  analyze(
    understanding: ProductUnderstanding,
  ): Promise<ShoppingContext>;
}
```

Có thể dùng rules + AI provider.

Nếu dùng AI:

- yêu cầu structured JSON output;
- validate schema;
- normalize values;
- dedupe;
- giới hạn số lượng category hợp lý.

## Output nội bộ B2

```ts
interface ShoppingContext {
  readonly recipients: readonly string[];
  readonly potentialBuyers: readonly string[];
  readonly relationships: readonly string[];
  readonly occasions: readonly string[];
  readonly useContexts: readonly string[];
  readonly giftContexts: readonly string[];
}
```

## Test

- grandma example;
- sản phẩm không phải gift vẫn không ép gift context;
- duplicate values được loại;
- empty context vẫn không làm pipeline crash.

---

# 6. Phase 4 — Seed Keyword Builder

## Mục tiêu

Trước khi gọi Google Autocomplete cần có seed keywords đủ tốt.

## Việc cần làm

Kết hợp dữ liệu:

```text
niche
product type/theme
visual entities
OCR/personalization
recipient
buyer
occasion
use context
```

để tạo seed.

Ví dụ:

```text
black cat + Halloween + rug
→ black cat halloween rug

personalization + Halloween + rug
→ personalized halloween rug

cat lover + Halloween gift
→ halloween gift for cat lover
```

## Yêu cầu nghiệp vụ

Seed phải:

- có liên quan trực tiếp đến sản phẩm;
- không quá dài;
- không tạo hàng trăm biến thể vô nghĩa;
- ưu tiên cụm có khả năng dùng để search;
- giữ trace seed sinh ra từ context nào nếu cần debug.

## Yêu cầu kỹ thuật

Tách logic này khỏi Google client:

```ts
interface SeedKeywordBuilder {
  build(
    understanding: ProductUnderstanding,
    shoppingContext: ShoppingContext,
  ): readonly SeedKeyword[];
}
```

Đây nên là logic deterministic để test dễ.

## Test

- same input → same seeds;
- deduplicate;
- normalization whitespace/case;
- không tạo seed rỗng;
- giới hạn số lượng seed theo config.

---

# 7. Phase 5 — B3 Google Autocomplete API

## Mục tiêu

Lấy search suggestions thực tế từ seed keywords.

Đây là **focus chính hiện tại của B3**.

## Việc cần làm

1. Tạo Google Autocomplete client.
2. Nhận từng seed keyword.
3. Gửi request tới endpoint/provider đã thống nhất.
4. Parse suggestions.
5. Normalize.
6. Dedupe.
7. Giữ relation:
   ```text
   seed → source → suggestion
   ```
8. Merge thành SearchResearchResult.
9. Xử lý timeout/rate limit/error.

## Yêu cầu nghiệp vụ

B3 không tự chọn final keyword.

B3 chỉ thu thập:

```text
seed keyword
→ search suggestions
```

Output phải biết suggestion đến từ đâu.

Ví dụ:

```json
{
  "seedKeyword": "personalized halloween rug",
  "source": "google_autocomplete",
  "suggestions": [
    "personalized halloween rug with name",
    "personalized halloween area rug"
  ]
}
```

## Yêu cầu kỹ thuật

Tạo interface:

```ts
interface SearchSuggestionProvider {
  getSuggestions(
    seed: string,
  ): Promise<readonly SearchSuggestion[]>;
}
```

Google adapter:

```text
GoogleAutocompleteSuggestionProvider
```

### Browser/CORS decision

Project hiện tại là React/Vite browser app.

Vì vậy trước khi implement request thật phải xác nhận:

```text
Google endpoint có gọi trực tiếp từ browser được không?
```

Nếu CORS hoặc anti-bot chặn:

```text
Browser
  ↓
server/proxy endpoint
  ↓
Google Autocomplete
```

Không nhúng secret proxy/API key vào `VITE_` variables.

### Retry

Chỉ retry các lỗi transient.

Không retry vô hạn.

Ví dụ:

```text
timeout
429
5xx
```

có thể retry theo policy.

4xx invalid request không retry mù quáng.

## Output nội bộ B3

```ts
interface SearchSuggestion {
  readonly seed: string;
  readonly query: string;
  readonly source:
    | "google_autocomplete"
    | "etsy_suggest"
    | "paa";
}

interface SearchResearchResult {
  readonly suggestions: readonly SearchSuggestion[];
}
```

## Test

Không gọi Google thật trong unit test.

Inject fake fetch/provider.

Test:

- parse response;
- empty response;
- malformed response;
- duplicate suggestions;
- timeout;
- network error;
- 429;
- source provenance;
- batch seeds.

---

# 8. Phase 6 — B3 Etsy Suggest Scraper và PAA extension point

## Mục tiêu

Chuẩn bị kiến trúc để thêm Etsy Suggest + PAA mà không sửa B3 core.

## Việc cần làm

Không nhất thiết implement full ngay nếu scope hiện tại chỉ focus Google.

Nhưng phải đảm bảo B3 không hardcode chỉ một provider.

Thiết kế:

```text
SearchSuggestionProvider
├── GoogleAutocomplete
├── EtsySuggest
└── PAA
```

Aggregator:

```text
seed
 ↓
provider(s)
 ↓
normalize
 ↓
dedupe
 ↓
SearchResearchResult
```

## Yêu cầu nghiệp vụ

Nguồn phải được giữ lại.

Không merge thành plain string list làm mất provenance.

PAA output chủ yếu là question query.

Etsy Suggest là marketplace search suggestion, không đồng nghĩa hoàn toàn với Google search intent.

## Yêu cầu kỹ thuật

Etsy/PAA adapter có thể để:

```text
TODO adapter / disabled config
```

nhưng không để TODO mơ hồ.

Ví dụ:

```text
TODO: Implement Etsy suggestion adapter after endpoint stability and
browser/proxy execution environment are approved.
```

Playwright chỉ được thêm nếu scraper thực sự cần browser automation.

Không cài Playwright chỉ để chuẩn bị trước.

---

# 9. Phase 7 — B4 SEO Conflict Control

## Mục tiêu

Ngăn nhiều URL/product target cùng một hoặc gần như cùng một query.

## Việc cần làm

### 9.1 Exact conflict

Kiểm tra exact normalized keyword.

Ví dụ:

```text
Product A:
personalized halloween rug

Product B:
personalized halloween rug
```

→ conflict.

### 9.2 Semantic conflict

Kiểm tra các query có meaning quá gần.

Ví dụ:

```text
black cat halloween rug
halloween rug with black cat
```

### 9.3 URL/keyword ownership mapping

Lưu mapping kiểu:

```text
keyword/query
→ product/URL owner
```

### 9.4 Conflict result

Phân loại:

```text
accepted
conflicting
avoid
needs_review
```

## Yêu cầu nghiệp vụ

B4 không generate final title/description.

B4 chỉ quyết định candidate nào:

- dùng được;
- conflict;
- cần tránh;
- cần review.

Không loại keyword chỉ vì có vài từ giống nhau.

Collection-level target và product-level target có thể coexist nếu intent/specificity khác nhau.

## Yêu cầu kỹ thuật

Tạo repository abstraction:

```ts
interface SeoTargetRepository {
  findExact(query: string): Promise<readonly SeoTargetRecord[]>;
  findSimilar(
    query: string,
    limit: number,
  ): Promise<readonly SimilarSeoTarget[]>;
}
```

Embedding abstraction:

```ts
interface EmbeddingProvider {
  embed(text: string): Promise<readonly number[]>;
}
```

Không hardcode vector DB.

Có thể support:

```text
in-memory adapter for test
real DB/vector adapter later
```

Semantic threshold phải configurable.

Không hardcode magic number rải rác.

## Output nội bộ B4

```ts
interface ConflictResult {
  readonly accepted: readonly CandidateQuery[];
  readonly conflicts: readonly SeoConflict[];
}
```

## Test

- exact match;
- case/whitespace normalization;
- semantic high similarity;
- semantic low similarity;
- same product owner không tự conflict sai;
- repository failure;
- configurable threshold.

---

# 10. Phase 8 — B5 Search Intent Classification

## Mục tiêu

Phân loại candidate query để biết query đó phù hợp dùng ở đâu.

## Việc cần làm

Classify tối thiểu:

```text
transactional
commercial
informational
navigational
unknown
```

Ví dụ:

```text
personalized halloween rug
→ transactional

best halloween rug for living room
→ commercial

how to wash halloween rug
→ informational
```

## Yêu cầu nghiệp vụ

Search Intent được xử lý tại B5.

Không nhầm B2 shopping context với Search Intent.

Không bắt buộc mọi query phải được dùng trong final content.

Query `unknown` phải được bỏ qua hoặc đưa review tùy policy.

## Yêu cầu kỹ thuật

Tạo:

```ts
interface SearchIntentClassifier {
  classify(
    candidates: readonly CandidateQuery[],
  ): Promise<readonly ClassifiedQuery[]>;
}
```

Có thể dùng rules + AI.

Structured output phải validate.

## Test

- transactional examples;
- informational questions;
- commercial patterns;
- unknown;
- batch classification;
- invalid provider response.

---

# 11. Phase 9 — B5 Keyword Allocation / Content Plan

## Mục tiêu

Quyết định query/keyword nào được dùng cho field nào trước khi generate text.

## Việc cần làm

Tạo internal content plan:

```text
primary target
secondary targets
entities
title terms
description terms
SEO title terms
SEO description terms
handle terms
image terms
```

Ví dụ:

```text
Primary:
personalized black cat halloween rug

Secondary:
custom halloween rug
black cat area rug

Informational:
how to clean halloween rug
```

Allocation:

```text
Product title
→ primary

SEO title
→ primary + relevant modifier

SEO description
→ primary + secondary

Product description
→ entities + secondary + useful informational context

Handle
→ concise primary phrase
```

## Yêu cầu nghiệp vụ

- Không keyword stuffing.
- Không dùng cùng exact phrase ở mọi sentence.
- Không đưa query không liên quan chỉ vì search suggestion có nó.
- Primary target phải phản ánh đúng sản phẩm.
- Handle phải ngắn, ổn định và readable.
- Không tự đổi nghĩa personalization/product type.

## Yêu cầu kỹ thuật

Tạo deterministic plan object trước khi gọi generator:

```ts
interface SeoContentPlan {
  readonly primaryTarget: string;
  readonly secondaryTargets: readonly string[];
  readonly titleTerms: readonly string[];
  readonly descriptionTerms: readonly string[];
  readonly seoTitleTerms: readonly string[];
  readonly seoDescriptionTerms: readonly string[];
  readonly handleTerms: readonly string[];
}
```

Plan và generated content phải tách nhau để debug được.

---

# 12. Phase 10 — B5 Content Generation

## Mục tiêu

Generate đúng 5 text output public:

```text
productTitle
productDescription
productSeoTitle
productSeoDescription
productHandle
```

## Việc cần làm

### Product title

- mô tả đúng sản phẩm;
- dùng primary target tự nhiên;
- không lặp vô nghĩa;
- giữ các product attribute quan trọng.

### Product description

- viết lại từ dữ liệu gốc + product understanding;
- giữ factual product information;
- bổ sung context SEO phù hợp;
- nếu output yêu cầu HTML thì tạo HTML sạch, predictable.

### Product SEO title

- tập trung target chính;
- dễ đọc;
- không keyword stuffing.

### Product SEO description

- mô tả trang/product rõ ràng;
- dùng target/secondary tự nhiên;
- không invent thông tin sản phẩm.

### Handle

- lowercase;
- kebab-case;
- bỏ ký tự không phù hợp;
- dựa trên target/product identity;
- tránh thay đổi handle vô lý nếu handle cũ đã tốt.

## Yêu cầu nghiệp vụ

AI không được invent:

- material;
- size;
- shipping;
- discount;
- personalization option;
- product feature

nếu input/B1 không có evidence.

Nếu source description có factual data thì phải giữ.

Nếu không chắc chắn phải bỏ claim thay vì hallucinate.

## Yêu cầu kỹ thuật

Tạo generator abstraction:

```ts
interface SeoContentGenerator {
  generate(
    input: SeoGenerationInput,
  ): Promise<GeneratedSeoContent>;
}
```

Provider response phải structured và validate.

Tạo validation layer sau generation:

```text
generated content
      ↓
validator
      ↓
valid / regenerate / fail
```

Validation có thể check:

- required field không empty;
- handle format;
- unsupported claims nếu detect được;
- duplicated exact phrase quá mức;
- malformed HTML;
- field length nếu team có rule chính thức.

Không tự hardcode SEO character limit nếu leader chưa chốt; để config.

## Test

- all fields generated;
- HTML description;
- invalid handle;
- empty output;
- hallucinated required facts scenario;
- provider error;
- deterministic fake provider.

---

# 13. Phase 11 — B6 Image Alt Generation

## Mục tiêu

Generate alt text cho từng ảnh dựa trên nội dung ảnh thật và context sản phẩm.

## Việc cần làm

Mỗi ảnh cần có:

```text
source image
→ image-specific analysis
→ alt text
```

Không dùng cùng alt cho mọi ảnh nếu ảnh khác nhau.

## Yêu cầu nghiệp vụ

Alt text:

- mô tả ngắn, đúng ảnh;
- có thể chứa relevant product term;
- không keyword stuffing;
- không thêm chi tiết không nhìn thấy;
- ảnh decorative có thể cần policy riêng nếu UI/store hỗ trợ.

## Yêu cầu kỹ thuật

Tận dụng B1 per-image analysis nếu đã có.

Không gọi vision provider lại nếu B1 đã đủ dữ liệu.

Tạo:

```ts
interface ImageAltGenerator {
  generate(
    image: ProductImageAnalysis,
    contentPlan: SeoContentPlan,
  ): Promise<string>;
}
```

## Test

- multiple images → distinct alt khi context khác;
- empty OCR;
- alt không empty;
- no unsupported claim.

---

# 14. Phase 12 — B6 WebP Conversion + Filename

## Mục tiêu

Convert ảnh sang WebP và đặt filename phù hợp.

## Việc cần làm

1. tải/đọc ảnh nguồn;
2. validate image;
3. convert WebP;
4. tạo filename;
5. trả asset theo public output contract.

Filename ví dụ:

```text
personalized-black-cat-halloween-rug.webp
personalized-black-cat-halloween-rug-detail.webp
```

## Yêu cầu nghiệp vụ

- Không dùng filename random nếu có thể tạo tên descriptive.
- Không để nhiều ảnh trùng filename.
- Không tự thay đổi visual content.
- Giữ chất lượng đủ dùng cho e-commerce.
- Không upscale vô lý.

## Yêu cầu kỹ thuật quan trọng

Theo xác nhận từ Leader và quy chuẩn tại [`docs/CONTRACT_MAIN_TO_PINTEREST_POD.md`](../../../../docs/CONTRACT_MAIN_TO_PINTEREST_POD.md) (mục 1.2), dự án hỗ trợ đọc/ghi trực tiếp file trên ổ đĩa bằng **Node.js `fs`** và xử lý dữ liệu qua **Node.js runtime / backend worker**.

### Kiến trúc xử lý WebP

1. **Xử lý phía Node.js runtime / backend worker (Phương án ưu tiên)**:
   - Đọc file ảnh nguồn trực tiếp từ đĩa (`localFilePath`) bằng `node:fs` hoặc tải qua stream/buffer.
   - Chuyển đổi WebP bằng thư viện xử lý ảnh chuyên dụng trên Node.js (ví dụ `sharp` hoặc module Node chuyên dụng).
   - Ghi file WebP thành phẩm ra thư mục đĩa cục bộ (ví dụ: `temp/seo_content/:jobId/:filename.webp` hoặc `data/...`).
   - Trả về `SeoContentWebpAsset` với cả `localFilePath`, `filename`, và `url` relative (`/api/...`).
   - *Ưu điểm*: Tốc độ xử lý cực nhanh, chất lượng in/ảnh cao, không bị giới hạn bộ nhớ RAM của trình duyệt.

2. **Xử lý phía Browser (Fallback)**:
   - Dùng `createImageBitmap` / `canvas.convertToBlob({ type: "image/webp" })` khi cần chạy độc lập trên giao diện client.

> **Lưu ý đóng gói**: Đảm bảo các hàm gọi thư viện native của Node (như `node:fs`, `sharp`) được tách biệt ở tầng server/worker hoặc abstract qua adapter, tránh import trực tiếp vào client browser bundle của Vite.

## Test

- JPEG → WebP;
- PNG → WebP;
- multiple images;
- duplicate filename resolution;
- invalid URL/image;
- corrupted image;
- CORS/backend failure;
- output MIME đúng `image/webp`.

---

# 15. Phase 13 — Final Service Composition

## Mục tiêu

Nối toàn bộ B1–B6 thành real `service.ts`.

## Việc cần làm

Flow:

```text
validate input
  ↓
B1
  ↓
B2
  ↓
seed builder
  ↓
B3
  ↓
B4
  ↓
B5 intent
  ↓
B5 plan
  ↓
B5 generation
  ↓
B6 alt
  ↓
B6 WebP
  ↓
map → SeoContentOutput
```

## Yêu cầu nghiệp vụ

Output cuối phải chỉ chứa dữ liệu của đúng product input.

Không mix dữ liệu giữa các job/products.

Nếu một stage optional fail:

- policy phải rõ là `partial`, fallback hay fail whole job.

Ví dụ B3 Google lỗi:

```text
không tự generate "search data thật" giả
```

Nếu business cho phép fallback AI thì phải flag rõ nguồn/fallback.

## Yêu cầu kỹ thuật

Các dependencies phải inject được:

```ts
interface SeoContentDependencies {
  readonly visionAnalyzer: ProductVisionAnalyzer;
  readonly shoppingContextAnalyzer: ShoppingContextAnalyzer;
  readonly suggestionProviders: readonly SearchSuggestionProvider[];
  readonly targetRepository: SeoTargetRepository;
  readonly intentClassifier: SearchIntentClassifier;
  readonly contentGenerator: SeoContentGenerator;
  readonly imageProcessor: ImageProcessor;
}
```

Real runtime compose real adapters.

Tests compose fakes.

---

# 16. Phase 14 — Error Model

## Mục tiêu

Có error codes rõ ràng để Main/orchestrator biết lỗi ở đâu.

## Đề xuất

```text
SEO_CONTENT_INVALID_INPUT
SEO_CONTENT_IMAGE_ANALYSIS_FAILED
SEO_CONTENT_CONTEXT_ANALYSIS_FAILED
SEO_CONTENT_SEARCH_SUGGESTION_FAILED
SEO_CONTENT_CONFLICT_CHECK_FAILED
SEO_CONTENT_INTENT_CLASSIFICATION_FAILED
SEO_CONTENT_GENERATION_FAILED
SEO_CONTENT_IMAGE_PROCESSING_FAILED
SEO_CONTENT_INVALID_PROVIDER_RESPONSE
```

## Yêu cầu kỹ thuật

- dùng repository `AppError` pattern;
- preserve `cause`;
- không log secret;
- không throw raw provider error ra UI;
- có stage context khi wrap.

---

# 17. Phase 15 — Mock Runner hoàn chỉnh

## Mục tiêu

Main UI/orchestrator có thể tích hợp SEO + Content mà không cần gọi API thật.

## Việc cần làm

Tạo fixture thực tế:

```text
Halloween rug
images
niche
title
description
handle
```

Mock output:

```text
optimized title
description
SEO title
SEO description
WebP mock asset
alt
handle
```

## Yêu cầu kỹ thuật

Mock:

- đúng cùng public contract;
- deterministic;
- không network;
- không production data;
- mutable values được clone/fresh copy.

---

# 18. Phase 16 — Unit Test Coverage

## Nhóm test

```text
Contract
B1
B2
Seed Builder
B3 Google Autocomplete
B4 Conflict
B5 Intent
B5 Plan
B5 Generation
B6 Alt
B6 WebP
Service orchestration
Mock runner
Error mapping
```

## Không dùng network thật

Unit tests không được gọi:

```text
Google
Etsy
AI provider
vector DB
Shopify
```

Dùng fake dependency.

## Test runner

Giữ test runner hiện tại của project:

```text
node:test
node:assert/strict
tsx
```

Không cần Jest/Vitest chỉ cho module này.

---

# 19. Phase 17 — Integration Tests

## Mục tiêu

Test các adapter với contract thật mà không biến unit suite thành flaky.

## Có thể có

```text
Google Autocomplete adapter integration test
AI provider contract test
vector repository integration test
image processor integration test
```

Các test này nên:

- tách khỏi default unit suite nếu cần credential/network;
- không chạy bắt buộc trong mọi local test;
- có env flag;
- không chứa secret trong repo.

---

# 20. Phase 18 — Playwright / E2E

## Có cần Playwright cho SEO + Content core không?

Không.

Core module test bằng unit/integration test.

Playwright chỉ cần khi:

```text
Main UI
→ nhập dữ liệu
→ chạy SEO Content
→ review output
```

cần browser E2E.

Hoặc khi một scraper bắt buộc browser automation.

Không thêm Playwright vào phase core nếu chưa có E2E requirement.

---

# 21. Phase 19 — Orchestrator Integration

## Mục tiêu

Đưa SEO + Content vào workflow thật.

## Việc cần làm

1. Orchestrator import SEO module từ `index.ts`.
2. Map upstream result (`PinterestPodDeliverables` từ module Pinterest POD) → `SeoContentInput`.
   - Lấy `trendKeywords`, `originalPinTitle`, `composedMockups` (kèm `detectedSceneDescription`), `cutoutProduct.whiteBgUrl`.
3. Gọi runner `runSeoContent`.
4. Map output (`SeoContentOutput`) → downstream (Shopify Sync Module / Main UI).
5. Wrap error theo workflow (`SEO_CONTENT_FAILED`).

## Yêu cầu nghiệp vụ

Không để SEO module import crawler/Shopify API.

Flow đúng trong dự án:

```text
Pinterest POD (Module A)
      ↓ (PinterestPodDeliverables)
Orchestrator
      ↓ (SeoContentInput)
SEO + Content (Module SEO)
      ↓ (SeoContentOutput)
Orchestrator
      ↓
Shopify Sync (Module Downstream) / Main UI
```

## Test

- mapping input;
- successful output;
- error propagation;
- multiple product jobs nếu supported;
- không mix job.

---

# 22. Phase 20 — Final validation / Definition of Done

Module được xem là hoàn thành khi:

## Public contract

- đúng input/output đã thống nhất;
- không còn scaffold `ModuleB*`;
- public exports sạch.

## B1

- hiểu text/image;
- OCR/vision abstraction hoạt động;
- structured product understanding.

## B2

- recipient/buyer/occasion/context;
- không nhầm Search Intent.

## B3

- Google Autocomplete chạy thật;
- suggestion provenance được giữ;
- Etsy/PAA có extension point;
- Etsy/PAA implement theo scope đã chốt.

## B4

- exact conflict;
- semantic conflict;
- repository abstraction;
- configurable threshold.

## B5

- search intent classification;
- content plan;
- generate title;
- generate description;
- SEO title;
- SEO description;
- handle;
- validation.

## B6

- image alt;
- WebP conversion;
- descriptive unique filenames.

## Runtime

- mock/real parity;
- no silent production fallback.

## Tests

Fresh pass:

```bash
npm test
npm run typecheck
npm run build
npm run build:mock
```

## Architecture

- không cross-import module internals;
- không Shopify sync trực tiếp nếu Shopify API vẫn là module riêng;
- không secret trong browser env;
- không `any`;
- không `@ts-ignore`.

---

# 23. Recommended implementation order

Thứ tự thực hiện thực tế:

```text
01. Contract + rename scaffold
02. Mock runner
03. Internal pipeline skeleton
04. B1 text/image understanding abstraction
05. B2 shopping context
06. Seed builder
07. B3 Google Autocomplete
08. B4 target repository + exact conflict
09. B4 semantic/vector conflict
10. B5 intent classifier
11. B5 content plan
12. B5 content generator + validator
13. B6 alt generator
14. B6 WebP processing
15. Final service composition
16. Error model
17. Unit test hardening
18. Integration tests
19. Orchestrator integration
20. Main UI/E2E integration if required
```

---

# 24. Recommended commit/task split

Không nên giao AI Agent một prompt kiểu:

```text
"Implement toàn bộ SEO Content"
```

Nên chia task nhỏ.

Ví dụ:

```text
Task 01
Replace SEO Content scaffold with real public contract.

Task 02
Add mock runner for SeoContentInput/Output.

Task 03
Create internal B1-B6 pipeline skeleton.

Task 04
Implement product-description parser and B1 domain model.

Task 05
Add ProductVisionAnalyzer abstraction and fake adapter.

Task 06
Implement B2 shopping-context model.

Task 07
Implement seed keyword builder.

Task 08
Implement Google Autocomplete provider.

Task 09
Implement search suggestion aggregator.

Task 10
Implement exact SEO conflict detection.

Task 11
Add semantic conflict abstraction.

Task 12
Implement Search Intent classifier abstraction.

Task 13
Implement SEO content plan.

Task 14
Implement content generator and output validation.

Task 15
Implement image alt generation.

Task 16
Implement chosen WebP processing strategy.

Task 17
Compose final SeoContentService.

Task 18
Integrate SEO Content runner into orchestrator.
```

Mỗi task phải chạy test/typecheck/build trước khi chuyển task tiếp theo.

---

# 25. Technical decisions & trạng thái xác nhận

Danh sách các quyết định kỹ thuật và trạng thái xác nhận từ Leader/dự án:

| # | Quyết định kỹ thuật | Trạng thái / Kết luận đã chốt |
| :- | :--- | :--- |
| **1** | Vision / OCR provider nào? | Dùng Gemini Vision API hoặc adapter AI Vision hiện có trong hệ sinh thái tool Shopify. |
| **2** | AI / Content generation provider? | Google Gemini API (dòng `gemini-2.5-flash` theo cấu hình chung của team). |
| **3** | Google Autocomplete gọi qua đâu? | Gọi qua backend/proxy endpoint để tránh bị chặn CORS/Anti-bot trên browser. |
| **4** | B4 lưu target mapping ở DB nào? | Lưu file JSON / SQLite cục bộ hoặc in-memory adapter trong giai đoạn MVP. |
| **5** | Embedding provider/model nào? | Text-embedding model (Gemini text-embedding hoặc in-memory similarity). |
| **6** | Semantic conflict threshold? | Thiết lập qua file config (mặc định ~0.85 cosine similarity). |
| **7** | **Product description: HTML hay Plain text?** | **ĐÃ CHỐT: Semantic HTML** 5 khối chuẩn (intro `<p>`, highlights `<ul>`, specs `<table>`, care `<table>`, where it works `<p>`). |
| **8** | **WebP processing: Browser hay Backend?** | **ĐÃ CHỐT BỞI LEADER: Hỗ trợ Node.js backend runtime**, dùng được `node:fs` và `Buffer` để xử lý file nhanh và tối ưu. |
| **9** | **WebP output asset format?** | **ĐÃ CHỐT: Đa năng**, gồm `localFilePath` (đường dẫn đĩa cục bộ), `url` (web view relative URL), và `data` (`Buffer` hoặc `Blob`). |
| **10** | **SEO Field length & rules?** | **ĐÃ CHỐT THEO PROFILE CHUẨN**: Title: 50–65 chars; SEO Title: <58 chars; SEO Description: 140–155 chars. |
| **11** | Etsy Suggest / PAA có ở MVP không? | Giữ extension point, ưu tiên Google Autocomplete trước. |
| **12** | External search fail xử lý thế nào? | Fallback tạo seed keywords nội bộ, không làm crash toàn bộ workflow. |

Các quyết định đã chốt được phản ánh trực tiếp vào `types.ts` và logic các Phase tương ứng.

---

# 26. Final module mental model

```text
INPUT
images
niche
title
description
handle
   │
   ▼
B1
Hiểu sản phẩm
   │
   ▼
B2
Hiểu người mua/ngữ cảnh
   │
   ▼
Seeds
   │
   ▼
B3
Lấy search suggestion thật
   │
   ▼
B4
Loại/xử lý conflict
   │
   ▼
B5
Intent → Plan → Generate
   │
   ▼
B6
Alt + WebP
   │
   ▼
OUTPUT
productTitle
productDescription
productSeoTitle
productSeoDescription
images[].alt
images[].webp
productHandle
```

SEO + Content hoàn thành khi downstream chỉ cần truyền đúng `SeoContentInput` và luôn nhận được một `SeoContentOutput` có shape ổn định, không cần biết B1–B6 được triển khai thế nào bên trong.
