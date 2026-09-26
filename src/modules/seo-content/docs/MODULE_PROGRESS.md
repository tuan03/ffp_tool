# Báo Cáo Tiến Độ Chi Tiết — Module SEO + Content

> **Ngày cập nhật:** 23/09/2026
> **Vị trí module:** `src/modules/seo-content`
> **Trạng thái tổng thể:** Đã hoàn thành pipeline **B1 → B2 → B3 → B4 → B5 → B6**, có 3 adapter chuyên dụng (Customization Normalizer, Auto SEO, Pinterest POD) và Gateway integration. Luôn xác nhận số liệu kiểm thử bằng lần chạy `npm test`, `npm run typecheck`, `npm run build` và `npm run build:mock` hiện tại thay vì dùng số liệu lịch sử trong tài liệu.
> **Quy trình thực hiện:** 2-Agent Workflow (ChatGPT Web: Planner & Reviewer | Antigravity: Worker & Coder) kết hợp nghiêm ngặt quy tắc kiến trúc `AGENTS.md`.

---

## 1. Tổng quan & Ranh giới Kiến trúc

Module **SEO + Content** được đóng gói độc lập theo đúng tiêu chuẩn kiến trúc hộp đen của dự án (`AGENTS.md`):
* **Hộp đen (Black-box)**: Giao tiếp độc quyền qua entry point duy nhất `src/modules/seo-content/index.ts`, không để lộ bất kỳ cấu trúc hay helper nội bộ nào ra ngoài.
* **Public Contract**: 
  * Input: `SeoContentInput` (`images`, `niche`, `title`, `description`, `handle`, `productId`, `url`).
  * Output: `SeoContentOutput` (`productTitle`, `productDescription`, `productSeoTitle`, `productSeoDescription`, `images[]` (WebP + Alt Text), `productHandle`).
* **Hệ thống Adapter Đa Nguồn (Multi-Source Adapters)**:
  * Cung cấp các adapter chuyên dụng độc lập để tiếp nhận dữ liệu từ các module khác trong hệ sinh thái (`customization-normalizer`, `auto-seo`, `pinterest-pod`) và chuyển đổi về chuẩn `SeoContentInput`.
* **Môi trường Runtime & Công nghệ**:
  * Chạy trên **Node.js runtime** (cho phép sử dụng đầy đủ các thư viện chuẩn như `node:fs`, `node:path`, `node:crypto`, `Buffer`).
  * Sử dụng **Google Cloud Vertex AI ADC** (dự án `gemini-image-benchmark`) cho toàn bộ pipeline: Gemini 2.5 Flash (Vision/OCR), Text Embedding 004 (Vector Semantic Similarity), Gemini LLM (SEO Content Writing).
  * Quy tắc bất biến Zero-Network Test: 100% unit tests chạy độc lập offline không phụ thuộc internet hay external API.

---

## 2. Chi tiết các Logic đã triển khai (Toàn bộ Pipeline B1 → B6)

### 🟢 Stage B1 — Phân tích sản phẩm từ hình ảnh (Product Understanding)
* **Mục tiêu**: Đọc hiểu sâu thiết kế, chi tiết đồ họa và thuộc tính của sản phẩm từ ảnh/mockup.
* **Logic cốt lõi**:
  * Tích hợp **Gemini 2.5 Flash Vision** (`@google/genai` Vertex AI client):
    * Nhận batch ảnh theo đúng thứ tự và dùng `niche`/title làm neo để nhận diện đúng sản phẩm được bán.
    * Trả đúng 4 nhóm evidence: **Typography** (text + styling), **Visual Entities** (summary thiết kế), **Scene Context** (không gian đặt sản phẩm) và **Physical Product Identity** (phôi/vật thể vật lý).
    * Không còn frequency-vote màu/background hoặc chọn category theo ảnh đầu tiên; B1 không ghi Shopify taxonomy/category/product type.
  * Hỗ trợ nạp ảnh linh hoạt: Đọc trực tiếp file cục bộ qua `node:fs` hoặc nạp URL/Data URI.
  * Bộ phân tích dự phòng tất định (**Deterministic Heuristic Fallback**): Tự động trích xuất tín hiệu từ `title`, `niche`, `description` khi offline hoặc không có API key.
* **Contract đầu ra**: `context.productUnderstanding`.

### 🟢 Stage B2 — Xác định bối cảnh sản phẩm & Người mua (Shopping Context)
* **Mục tiêu**: Chuyển hóa đặc tính hình ảnh (B1) thành ngữ cảnh thương mại thực tế và ý định mua hàng.
* **Logic cốt lõi**:
  * Phân tích đối tượng khách hàng mục tiêu (**targetAudience**).
  * Xác định các dịp mua sắm, tặng quà phù hợp (**suitableOccasions**).
  * Xác định không gian, công năng sử dụng (**useCases**).
  * Tạo danh sách hạt giống ý định người mua (**buyerIntentKeywords**): Kết hợp thực thể + ngành hàng + thuộc tính sản phẩm để tạo các cụm từ tìm kiếm thương mại có giá trị cao.
* **Contract đầu ra**: `context.shoppingContext`.

### 🟢 Stage B3 — Mở rộng từ khóa tìm kiếm thực tế (Search Suggestions)
* **Mục tiêu**: Thu thập truy vấn tìm kiếm thực tế từ người dùng nhằm đối chiếu nhu cầu thị trường.
* **Logic cốt lõi**:
  * **Google Suggest Client (`UnofficialGoogleSuggestClient`)**: Truy vấn trực tiếp Google Autocomplete API (`suggestqueries.google.com`) với ngôn ngữ và quốc gia cấu hình (mặc định `en`/`us`).
  * **Bộ đệm thông minh (`InMemoryGoogleSuggestCache`)**: Hỗ trợ cơ chế LRU + TTL, tránh gọi trùng lặp và tiết kiệm quota.
  * **Circuit Breaker**: Tự động ngắt batch khi phát hiện rate limit (429) hoặc bị chặn (403).
  * **Bộ chọn hạt giống (`search-seed-selector.ts`)**: Ưu tiên Buyer Intent, Physical Product Identity và Visual Entities; scene seed giữ provenance riêng và chỉ dùng để khám phá.
  * **Chuẩn hóa & Khử trùng (`search-suggestions-normalizer.ts`)**: Chuẩn hóa Unicode NFKC, loại bỏ URL, ký tự điều khiển và trùng lặp chuỗi.
  * **Fallback tất định (`FallbackSearchSuggestionsCollector`)**: Bảo đảm tính bất biến offline trong automated tests (zero-network).
* **Contract đầu ra**: `context.searchResearch` (`seedKeywords`, `suggestedQueries`, `querySources`).

### 🟢 Stage B4 — Kiểm soát xung đột & Khử trùng lặp từ khóa (Conflict Control)
* **Mục tiêu**: Lọc sạch từ khóa lệch ngành, khử trùng lặp ngữ nghĩa (cannibalization), chấm điểm tiềm năng, gom cụm từ khóa và bảo vệ quyền sở hữu từ khóa trên toàn bộ catalog sản phẩm (Cross-Product Keyword Cannibalization Prevention).
* **Logic cốt lõi**:
  * **Kiến trúc Vector-First Hybrid Conflict Engine (Intra-Product)**:
    * **Primary Provider**: Google Vertex AI `text-embedding-004` (768 chiều). Nhúng tài liệu tham chiếu sản phẩm đa tầng (Dual Reference: Product Identity & Shopping Intent) và nhúng toàn bộ candidate queries.
    * **Fallback Provider**: `LocalTfidfVectorizer` (kết hợp unigram trọng số 2.0, bigram 2.5, char 3-gram 0.5, từ điển chuẩn hóa đồng nghĩa) đảm bảo offline unit test chạy độc lập.
    * **Single-Vector-Space Invariant**: 100% vector so sánh trong một phiên phải thuộc cùng một provider/model; nếu Primary lỗi thì fallback toàn bộ, không bao giờ lai tạp.
  * **Khử trùng lặp ngữ nghĩa dựa trên đại diện (Representative-Based Incremental Clustering)**:
    * Sắp xếp ứng viên theo điểm liên quan, provenance và độ dài thương mại.
    * Ứng viên top 1 làm Leader của cụm; các ứng viên sau chỉ so sánh với Leader của các cụm hiện hữu (loại trừ lỗi over-merge lan truyền của DSU).
  * **Bộ lọc xung đột đa tầng có thứ bậc ưu tiên cố định (Deterministic Precedence)**:
    1. `exact_duplicate`: Trùng chuỗi chính xác trong cùng session.
    2. `brand_conflict`: Cấm nhãn hiệu bản quyền (Nike, Disney, v.v.).
    3. `existing_url_cannibalization`: Tránh xung đột với sản phẩm/URL đã có trên catalog toàn site.
    4. `category_conflict`: Loại trừ lệch ngành (ví dụ: gạt bỏ `rugby` khi sản phẩm là thảm `rug`).
    5. `search_intent_mismatch`: Loại bỏ từ khóa thông tin phi thương mại ("how to draw", "tutorial").
    6. `semantic_drift_irrelevant`: Loại bỏ từ khóa có điểm vector quá thấp (< 0.54).
    7. `semantic_duplicate`: Khử trùng lặp ngữ nghĩa nội bộ.
  * **Cơ sở dữ liệu Danh mục Toàn site (`FileSeoConflictCorpus`) & Cross-Product Cannibalization**:
    * Quản lý quyền sở hữu từ khóa site-wide qua file JSON có versioning (`schemaVersion: 1`, `revision`, `updatedAt`).
    * Ghi file nguyên tử (Atomic write qua temp file + `fsync` + `fs.rename`) và khóa file (`corpus-file-lock.ts`) chống race condition giữa các process.
    * Hỗ trợ Optimistic Concurrency Control qua `expectedRevision` chống ghi đè dữ liệu cũ (`CorpusRevisionConflictError`).
    * Replace-not-append claim set ngăn ngừa zombie/ghost keywords; `removeProduct` giải phóng quyền sở hữu từ khóa; `isSameProduct` chống tự xung đột khi rerun cùng sản phẩm.
    * Đánh giá vùng xám ngữ cảnh (`contextual-conflict-evaluator.ts`): Độ tương đồng trong khoảng $[0.86, 0.90)$ đối với primary keyword được đối chiếu sâu về category và search intent.
  * **Làm giàu siêu dữ liệu cho B5**: Xuất kèm bảng điểm `relevanceScores`, danh sách phân cụm `keywordClusters` và `corpusRevision`.
* **Contract đầu ra**: `context.conflictResult` (`approvedKeywords`, `discardedKeywords`, `conflictReasons`, `relevanceScores`, `keywordClusters`, `corpusRevision`).

### 🟢 Stage B5 — Sinh nội dung chuẩn SEO (Content Generation)
* **Mục tiêu**: Tạo trọn bộ nội dung thương mại điện tử chuẩn SEO (Title, Description HTML, Meta SEO Title, Meta SEO Description, URL Slug) dựa trên Fact Sheet chân thực và phân bổ từ khóa đa tầng.
* **Logic cốt lõi**:
  * **Fact Sheet Bất biến (`content-fact-sheet.ts`)**: Chỉ trích xuất Physical Product Identity, Typography và Visual Entities từ B1; không đưa Scene Context vào copywriting.
  * **Bộ phân bổ từ khóa 3 tầng (`keyword-allocator.ts`)**:
    * **Tier 1 (Primary/Focus Keyword)**: Dành riêng cho SEO Title, H1 và URL Slug.
    * **Tier 2 (Secondary Keywords)**: Tối đa 2-3 từ khóa tích hợp tự nhiên vào Bullet Points và phần mở đầu mô tả.
    * **Tier 3 (Supporting Keywords)**: Dành cho phần chi tiết và Alt text của Stage B6.
  * **Kiến trúc Dual Engine (`GeminiSeoContentGenerator` & `HeuristicContentGenerator`)**:
    * **Primary Engine**: Google Vertex AI Gemini 2.5 với Structured JSON Schema output.
    * **Fallback Engine**: Template-based Heuristic Generator với từ vựng tự nhiên, đảm bảo 100% offline unit tests chạy độc lập không phụ thuộc network.
  * **Bộ căn chỉnh độ dài tất định (`content-fitters.ts`)**:
    * `fitSeoTitle`: Cắt tỉa an toàn theo ranh giới từ $\le 70$ ký tự, bảo toàn từ khóa chính.
    * `fitSeoDescription`: Cắt tỉa an toàn $\le 160$ ký tự kèm Call-To-Action hấp dẫn.
    * `fitProductTitle`: Căn chỉnh tiêu đề hiển thị $\le 80$ ký tự.
    * `generateProductHandle`: Chuẩn hóa URL slug $\le 80$ ký tự, bảo toàn URL hiện hữu nếu đã có.
  * **Định dạng HTML Mô tả Shopify (`html-description-formatter.ts`)**:
    * Tạo cấu trúc ngữ nghĩa sạch (`<h2>`, `<p>`, `<ul>`, `<li>`), tuyệt đối không dùng inline CSS hoặc class lạ.
  * **Kiểm tra & Thẩm định nội dung cuối (`content-result-validator.ts`)**:
    * Kiểm tra độ dài, kiểm tra hiện diện từ khóa chính, kiểm tra rò rỉ từ khóa bị cấm (discarded keywords), phát hiện ảo giác chất liệu/kích thước.
* **Contract đầu ra**: `context.contentResult` & `context.contentGenerationMetadata`.

### 🟢 Stage B6 — Tối ưu hóa hình ảnh & Alt Text (Image Processing & Alt Text)
* **Mục tiêu**: Chuyển đổi ảnh sang chuẩn WebP, sinh tên file chuẩn SEO tất định, tạo Alt text giàu ngữ cảnh không nhồi nhét từ khóa ($\le 125$ ký tự), bảo đảm an toàn SSRF và khả năng hoạt động offline.
* **Logic cốt lõi**:
  * **Sinh tên file WebP chuẩn SEO (`webp-filename-generator.ts`)**:
    * Định dạng tất định: `${handle}-${index + 1}.webp`.
    * Chống Path Traversal bằng `path.basename` và chuẩn hóa ký tự `cleanSlug`.
  * **Tạo Alt Text ngữ cảnh có căn cứ (`alt-text-generator.ts`)**:
    * Ưu tiên 1: `sourceAlt` gốc của người dùng nếu có ý nghĩa.
    * Ưu tiên 2: Kết hợp `productTitle` + `primaryKeyword` + tối đa 1-2 thực thể thị giác chân thực từ B1.
    * Phong cách: Lọc bỏ các phong cách không tự nhiên (`vector art`, `clipart`), chỉ giữ phong cách phù hợp (`vintage`, `retro`, `minimalist`).
    * Đảm bảo tính độc nhất trong thư viện ảnh (`ensureGalleryUniqueness`): Ảnh phụ được đánh số View và trừ hao ngân sách độ dài trước khi cắt tỉa để không bao giờ vượt trần 125 ký tự.
    * Cắt tỉa an toàn ranh giới từ qua `alt-text-fitter.ts` ($\le 125$ ký tự).
    * Bộ lọc làm sạch Alt (`alt-text-sanitizer.ts`): Bóc tách HTML, ký tự điều khiển, URL, ký tự surrogate-pair UTF-16 an toàn (`characterLength`).
  * **Kiểm định & Chuyển đổi WebP (`webp-validator.ts`, `webp-converter.ts`)**:
    * Kiểm định Magic Bytes: Bắt buộc 4 bytes đầu là `RIFF` và 4 bytes tại offset 8 là `WEBP`.
    * `DeterministicTestWebpConverter`: Trả về fixture 42-byte WebP chuẩn cho automated tests (zero-network).
    * `SharpWebpConverter`: Tích hợp thư viện Sharp qua dynamic import reflection chống lỗi TS compile khi thư viện là optional runtime dependency.
    * `UnavailableWebpConverter`: Trả lỗi rõ ràng khi không có runtime chuyển đổi ảnh.
    * Nguyên tắc bất biến không bịa đặt dữ liệu (Never Fake WebP Bytes): Nếu chuyển đổi thất bại ở chế độ lenient, không bao giờ giả mạo `.data` hay `.localFilePath`.
  * **Nạp ảnh an toàn chống SSRF (`image-source-loader.ts`)**:
    * Hỗ trợ file cục bộ, data URI, và remote HTTP.
    * Phòng thủ SSRF chuyên sâu: Kiểm tra DNS/IP cấm loopback (`127.0.0.1`), link-local (`169.254.x`), private IP (`10.x`, `192.168.x`).
    * **Thanh tra chuyển hướng (Manual Redirect Hop Inspection)**: Cấu hình `fetch({ redirect: "manual" })`, kiểm tra từng bước chuyển hướng (301, 302, 307, 308) qua hàm `validateSafeUrl` và giới hạn tối đa 3 hops chống chuyển hướng độc hại vào mạng nội bộ.
  * **Lưu trữ ảnh nguyên tử (`image-artifact-sink.ts`)**:
    * `FileSystemImageSink`: Ghi file vào thư mục temp ngẫu nhiên trước khi rename nguyên tử sang file đích, bảo vệ chống race condition và path traversal.
    * `MemoryImageSink`: Lưu trữ in-memory cho môi trường test và serverless.
  * **Bộ xử lý ảnh tuần tự (`image-processor.ts`)**:
    * Xử lý từng ảnh tuần tự, phân tách chế độ `lenient` (lỗi 1 ảnh không làm sập pipeline) và `strict` (ném lỗi ngay).
* **Contract đầu ra**: `context.imageResult` & `context.imageProcessingMetadata`.

---

## 3. Hệ Thống Adapter Chuyên Dụng (Multi-Module Integration Adapters)

Để phục vụ việc kết nối và chia sẻ năng lực của SEO Pipeline cho toàn bộ các module nghiệp vụ khác trong ứng dụng FFP Tool, module đã xây dựng 3 Adapter độc lập, tự chủ về kiểu dữ liệu và tuân thủ tuyệt đối quy tắc ranh giới của `AGENTS.md`:

```text
src/modules/seo-content/
├── customization-adapter.ts   # Adapter kết nối Customization Normalizer / Crawler
├── auto-seo-adapter.ts        # Adapter kết nối Auto SEO (Shopify Product / Candidates)
├── pinterest-pod-adapter.ts   # Adapter kết nối Pinterest POD Studio
└── index.ts                   # Export công khai các hàm mapping và pipeline runner
```

### 🔹 1. Customization Adapter (`customization-adapter.ts`)
* **Mục tiêu**: Tiếp nhận dữ liệu sản phẩm cào được từ Amazon Crawler / Customization Normalizer (`CrawlProduct`).
* **Logic chuyển đổi**:
  * Trích xuất `asin`, `productId`, `title`, `description`.
  * Chuẩn hóa danh sách ảnh (bao gồm ảnh gốc và các ảnh biến thể tùy biến đã được xử lý).
* **Hàm cốt lõi**:
  * `fromCustomizationProduct(product, defaultNiche)`: Ánh xạ 1 sản phẩm sang `SeoContentInput`.
  * `fromCustomizationBatch(products, defaultNiche)`: Ánh xạ danh sách mảng sản phẩm.
  * `runCustomizationSeoPipeline(products, options)`: Thực thi batch đa luồng với khả năng cô lập lỗi.

### 🔹 2. Auto SEO Adapter (`auto-seo-adapter.ts`)
* **Mục tiêu**: Tiếp nhận danh sách sản phẩm lấy từ Shopify Store hoặc danh sách ứng viên tuyển chọn của module Auto SEO.
* **Logic chuyển đổi**:
  * Hỗ trợ đa dạng đầu vào: `ShopifyProduct`, `AutoSeoProductCandidate`, `SeoContentInputPayload`.
  * Xử lý trích xuất `sourceDescriptionHtml` nguyên bản, bảo toàn các thẻ định dạng.
  * Tự động suy luận `niche` từ `productType` và danh sách `tags`.
* **Hàm cốt lõi**:
  * `fromAutoSeoProduct(product, defaultNiche)`: Ánh xạ sản phẩm sang `SeoContentInput`.
  * `fromAutoSeoBatch(products, defaultNiche)`: Ánh xạ mảng sản phẩm.
  * `runAutoSeoPipeline(products, options)`: Thực thi batch SEO pipeline.
* **Tích hợp thực tế**:
  * Đã được cắm trực tiếp vào Gateway Backend tại `gateway/seo-content/service.ts`, thay thế mock placeholder giả lập bằng việc chạy pipeline SEO B1-B6 thực tế.

### 🔹 3. Pinterest POD Adapter (`pinterest-pod-adapter.ts`)
* **Mục tiêu**: Tiếp nhận gói thành phẩm hoàn chỉnh từ Pinterest POD theo đúng hợp đồng [docs/CONTRACT_PINTEREST_POD_TO_SEO.md](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/docs/CONTRACT_PINTEREST_POD_TO_SEO.md).
* **Logic chuyển đổi**:
  * **Tiêu đề & Handle**: Lấy từ `item.originalPinTitle`, tự động slugify chuẩn SEO cho URL Shopify.
  * **Ngành hàng (Niche)**: Tự động suy luận từ `item.productType` (`rug` $\rightarrow$ `Home Decor > Rugs & Area Rugs`, `blanket` $\rightarrow$ `Home & Living > Bedding & Blankets`, `custom` $\rightarrow$ `Custom Print-on-Demand`) kết hợp từ khóa hot trend Pinterest đầu tiên.
  * **Mô tả giàu ngữ cảnh (Rich Contextual Description)**: Tự động tổng hợp từ tiêu đề Pin gốc, danh sách từ khóa hot trend (`trendKeywords`) và ngữ cảnh phòng sống động do AI Vision nhận diện từ danh sách `composedMockups`.
  * **Trích xuất hình ảnh**:
    * *Ảnh chính đại diện (Featured Image)*: Ưu tiên phôi nền trắng sạch 1:1 (`cutoutProduct.whiteBgUrl`) chuẩn E-commerce.
    * *Ảnh phối cảnh phòng*: Lấy toàn bộ `composedMockups.mockupUrl` kèm Alt text mô tả không gian nội thất.
    * *Ảnh thiết kế in*: Lấy `printMaster.rgbUrl` độ phân giải cao 300 DPI.
    * *Ảnh phôi trong suốt*: Lấy `cutoutProduct.transparentUrl`.
    * Tự động loại bỏ URL ảnh trùng lặp và liên kết đường dẫn đĩa `localFilePath` khi có.
* **Hàm cốt lõi**:
  * `fromPinterestPodItem(item, defaultNiche)`: Ánh xạ 1 thành phẩm POD sang `SeoContentInput`.
  * `fromPinterestPodBatch(deliverables, defaultNiche)`: Ánh xạ toàn bộ lô thành phẩm `PinterestPodDeliverables`.
  * `runPinterestPodSeoPipeline(deliverables, options)`: Thực thi batch SEO pipeline với concurrency control, trả về `PinterestPodSeoBatchResult` kèm mảng `seoOutputs`.

---

## 4. Những Điểm Kỹ Thuật Đã Chốt (Architectural Decisions)

1. **Tuân thủ triệt để AGENTS.md**:
   * Cấu trúc module phẳng, TypeScript strict mode, 0 lỗi typecheck, build pass sạch sẽ.
   * Ranh giới module độc lập: Các module không import trực tiếp nội bộ của nhau; việc tích hợp diễn ra qua adapter hoặc entry point `index.ts`.
2. **Quy tắc Bất biến Offline trong Automated Tests (Zero-Network Test Invariant)**:
   * Toàn bộ 271 bài test tự động chạy độc lập 100% không gọi internet, không phụ thuộc Google Cloud hay external API.
3. **Tự chủ kiểu dữ liệu trong Adapter (Self-Contained Adapter Contracts)**:
   * Các adapter (`auto-seo-adapter.ts`, `pinterest-pod-adapter.ts`) tự khai báo các interface hợp đồng dữ liệu nội bộ thay vì import chéo file index chứa JSX của module khác. Điều này bảo vệ Gateway backend compiler (`tsconfig.gateway.json`) không bị lỗi compile thiếu cờ `--jsx`.
4. **SSRF Redirect Hop Validation Invariant**:
   * Tuyệt đối không cho phép HTTP client tự động follow redirect một cách mù quáng. Từng URL chuyển hướng đều phải qua bộ lọc an toàn mạng nội bộ.
5. **Gallery Alt Uniqueness Budget Reservation**:
   * Khi thêm hậu tố độc nhất cho ảnh trong thư viện (ví dụ `, view 2`), độ dài hậu tố phải được trừ trước vào ngân sách 125 ký tự: `fitAltText(text, 125 - suffixLen) + suffix`, đảm bảo Alt text luôn kết thúc trọn vẹn và không bao giờ vượt quá 125 ký tự.
6. **Never Fake WebP Bytes Invariant**:
   * Khi không có engine chuyển đổi hoặc chuyển đổi gặp lỗi ở chế độ lenient, hệ thống ghi nhận issue và bảo toàn URL gốc, tuyệt đối không gán buffer giả mạo hoặc đường dẫn file không tồn tại.

---

## 5. Những Lỗi Đã Phát Hiện & Đã Khắc Phục (Bug Fixes & Hardening)

| STT | Lỗi phát hiện | Nguyên nhân gốc rễ | Giải pháp đã khắc phục |
|:---:|---|---|---|
| 1 | **UI hiển thị "0 kết quả" gợi ý Google Autocomplete** | Trong `b3-search-suggestions.ts`, điều kiện `arg.includes("test")` bị kích hoạt nhầm khi tham số truyền vào chứa đường dẫn ảnh nằm trong thư mục `__tests__\media`. | Sửa logic nhận diện test runner thành kiểm tra cờ `--test` của Node/tsx hoặc đuôi file `.test.ts`. Thêm `set SEO_SEARCH_PROVIDER=google` vào `test.cmd`. |
| 2 | **Bỏ qua ngưỡng `relevanceReject` trong Vùng Xám B4** | Trong `keyword-relevance-evaluator.ts`, code viết `if (hasAnchor && relevanceScore > 0)` khiến từ khóa trôi dạt ngữ nghĩa nhưng có dính 1 từ anchor vẫn bị duyệt. | Khóa chặt điều kiện: `relevanceScore >= thresholds.relevanceReject && hasAnchor`. Hiệu chuẩn `relevanceReject = 0.01` cho local sparse vector. |
| 3 | **Crash Regex khi gặp ký tự đặc biệt (Metacharacters)** | `new RegExp(\`\\b\${brand}\\b\`)` gặp các nhãn hiệu hoặc thực thể có ký tự `+`, `(`, `[`, `*` (ví dụ `Disney+`, `C++`, `cat (spooky)`) sẽ ném `SyntaxError`. | Xây dựng hàm tiện ích `safeWordBoundaryRegex` và `escapeRegex`, tự động escape toàn bộ metacharacter và chỉ đặt `\b` khi ký tự biên là word character. |
| 4 | **Lệch Alias Provider ID giữa Vertex AI và Corpus** | `VertexTextEmbeddingProvider` dùng `providerId = "vertex"` trong khi analyzer kiểm tra `"vertex_ai"`, làm metadata vector bị gán nhầm thành `"local_tfidf"`. | Chuẩn hóa `providerId = "vertex_ai"` và cập nhật `isEmbeddingCompatible` chấp nhận tương thích chéo giữa 2 alias. |
| 5 | **Bỏ sót xung đột khi embedding không tương thích** | Trong `FileSeoConflictCorpus`, điều kiện `if (!lookup.embedding || !kw.embedding)` không bao quát trường hợp cả hai đều có embedding nhưng không tương thích nhau. | Bổ sung cờ `canCompareDense`: kích hoạt Tier 2b Token Jaccard với synonym map (`extractCanonicalTokens`) khi không thể so sánh vector dày. |
| 6 | **Sharp Module Resolution trong TypeScript** | `sharp` là optional native dependency không có sẵn trong `package.json`, dùng `import("sharp")` tĩnh khiến `npm run typecheck` báo lỗi TS2307. | Chuyển sang dynamic import reflection qua `new Function("specifier", "return import(specifier)")`, đảm bảo typecheck 0 lỗi ở cả development lẫn build. |
| 7 | **Lỗ hổng SSRF qua HTTP Redirects** | `fetch()` mặc định tự động theo redirect dẫn đến nguy cơ hacker redirect từ URL ngoài vào IP nội bộ `127.0.0.1` hoặc metadata server `169.254.169.254`. | Đặt `redirect: "manual"`, bóc tách header `Location` tại mỗi hop và kiểm tra qua `validateSafeUrl()`. Tối đa 3 hops. |
| 8 | **Alt Text vượt trần 125 ký tự khi thêm hậu tố Gallery** | Khi nối `, view 2` vào một Alt text đã dài 125 ký tự, kết quả thành 133 ký tự (vượt trần). Nếu cắt tỉa sau khi nối, hậu tố view bị cụt mất đuôi. | Trừ độ dài hậu tố vào ngân sách trước khi cắt tỉa: `fitAltText(text, maxLength - suffixLength) + suffix`. |
| 9 | **Sparse Product Alt Text Fallback** | Khi `source.title` chỉ có khoảng trắng, hệ thống fallback về tiêu đề sản phẩm do AI sinh thay vì rơi vào fallback chung `Product image 1`. | Thêm kiểm tra `!trimmedSourceTitle` trước khi chọn nguồn tiêu đề để các test hồi quy cơ sở chạy ổn định. |
| 10 | **Lỗi TypeScript compile Gateway do dính route JSX từ Pinterest POD** | Khi `gateway/seo-content/service.ts` import adapter, chuỗi type resolution kéo theo `src/modules/pinterest-pod/index.ts` chứa route JSX (`routes.tsx`), gây lỗi TS6142 `--jsx is not set` trong `tsconfig.gateway.json`. | Tự chủ hoàn toàn các interface của Pinterest POD bên trong adapter (`pinterest-pod-adapter.ts`), cắt đứt phụ thuộc vào JSX và giữ adapter chạy mượt mà ở cả Node.js backend và frontend. |

---

## 6. Kết Quả Kiểm Thử & Nghiệm Thu

### 6.1. Kiểm thử tự động (Automated Verification)
* **Unit Tests module SEO Content (`npx tsx --test src/modules/seo-content/__tests__/*.test.ts`)**:
  * Chạy `npm test` để lấy kết quả hiện tại; suite phải zero-network ở các unit test SEO Content.
  * Stage B1 Tests: 43 tests (Gemini Vision, OCR, Fallback, Payloads, Retries).
  * Stage B2 Tests: 33 tests (Shopping Context, Audience, Occasions, Buyer Intent Seeds).
  * Stage B3 Tests: 39 tests (Google Suggest Client, LRU Cache, Circuit Breaker, Normalizer, Collector).
  * Stage B4 Tests: 56 tests (Intra-product Vector Embedding, Clustering, Guards, File Catalog Database, Concurrency Lock, Stale Revision Retries).
  * Stage B5 Tests: 20 tests (Fact Sheet, Keyword Allocation, Fitters, HTML Description, LLM + Heuristic Generators, Content Validator).
  * Stage B6 Tests: 28 tests (WebP Filename, Alt Sanitizer & Fitter & Generator, WebP Magic Bytes, Test & Sharp Converters, SSRF Redirect Hop Guard, File & Memory Sinks, Image Processor).
  * Pipeline & Core Service Tests: 39 tests.
  * Customization Adapter Tests: 4 tests (`customization-adapter.test.ts`).
  * Auto SEO Adapter Tests: 3 tests (`auto-seo-adapter.test.ts`).
  * Pinterest POD Adapter Tests: 6 tests (`pinterest-pod-adapter.test.ts`).
* **Toàn bộ Test Suite Dự án (`npm test`)**:
  * **554 tests web PASS 100%**.
  * **153 test suites PASS 100%**.
  * **102 python engine tests PASS 100%**.
* **Typecheck (`npm run typecheck`)**:
  * **0 lỗi** trên cả 2 cấu hình `tsconfig.json` và `tsconfig.gateway.json`.
* **Production Build (`npm run build`)**:
  * Build thành công trong 1.12s (119 modules).
* **Mock Build (`npm run build:mock`)**:
  * Build thành công trong 1.33s.
* **Nghiệm thu 2-Agent (ChatGPT Web)**:
  * Stage B1 → B6: **`STAGE B6 — APPROVED ✅ B1 → B6 IMPLEMENTATION COMPLETE ✅`**.

### 6.2. Kiểm thử trực quan thực tế (Visual Inspection qua `b1-visual-inspect.ts`)
Đã thực thi script trực quan `npx tsx src/modules/seo-content/scripts/b1-visual-inspect.ts` chạy trọn vẹn toàn bộ 6 bước B1 $\rightarrow$ B6:
1. **B1**: Trích xuất Typography, Visual Entities, Scene Context và Physical Product Identity từ batch ảnh, neo theo niche/title.
2. **B2**: Xác định khách hàng mục tiêu, dịp mua sắm, công năng sử dụng, hạt giống ý định.
3. **B3**: Thu thập 31 gợi ý từ Google Autocomplete API kèm nguồn gốc xuất xứ.
4. **B4**: Phê duyệt 34 từ khóa hàng đầu kèm điểm liên quan, phân cụm ngữ nghĩa, loại bỏ 2 từ khóa trùng lặp ngữ nghĩa.
5. **B5**: Sinh tiêu đề sản phẩm, SEO Meta Title (43/70 chars), SEO Meta Description (127/160 chars), URL slug `/products/vintage-halloween-black-cat-t-shirt`, và mô tả Shopify HTML chuẩn ngữ nghĩa.
6. **B6**: Tối ưu hóa ảnh sang WebP (`vintage-halloween-black-cat-t-shirt-1.webp`), Alt text chuẩn SEO tiếp cận `"Vintage Halloween Black Cat T-Shirt"` (35/125 chars).
7. **Giao diện HTML Preview**: Toàn bộ dữ liệu 6 stages được render đẹp mắt, trực quan và responsive tại [`b1-visual-preview.html`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/b1-visual-preview.html).

---

## 7. Kế Hoạch Bước Kế Tiếp

1. **Kết nối thực thi Adapter khi có chỉ thị**:
   - Khi có quyết định tích hợp luồng thực tế (UI hoặc Gateway), kích hoạt các hàm runner tương ứng (`runPinterestPodSeoPipeline`, `runCustomizationSeoPipeline`).
2. **Tích hợp Orchestrator & UI Review**:
   - Kết nối với Orchestrator và xây dựng UI component xem trước / chỉnh sửa kết quả SEO trước khi đồng bộ lên Shopify.
