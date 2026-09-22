# Báo Cáo Tiến Độ Chi Tiết — Module SEO + Content

> **Ngày cập nhật:** 22/09/2026  
> **Vị trí module:** `src/modules/module-seo-content`  
> **Trạng thái tổng thể:** Đã hoàn thành và kiểm thử sạch **B1, B2, B3, B4**; sẵn sàng triển khai **B5 (Content Generation)**.  
> **Quy trình thực hiện:** 2-Agent Workflow (ChatGPT Web: Planner & Reviewer | Antigravity: Worker & Coder).

---

## 1. Tổng quan & Ranh giới Kiến trúc

Module **SEO + Content** được đóng gói độc lập theo đúng tiêu chuẩn kiến trúc của dự án:
* **Hộp đen (Black-box)**: Giao tiếp qua entry point `src/modules/module-seo-content/index.ts`, không để lộ cấu trúc nội bộ ra ngoài.
* **Public Contract**: 
  * Input: `SeoContentInput` (`images`, `niche`, `title`, `description`, `handle`).
  * Output: `SeoContentOutput` (`productTitle`, `productDescription`, `seoTitle`, `seoDescription`, `images[]` (WebP + alt), `handle`).
* **Môi trường Runtime & Công nghệ**:
  * Chạy trên **Node.js runtime** (cho phép sử dụng đầy đủ các thư viện chuẩn như `node:fs`, `node:path`, `node:crypto`, `Buffer`).
  * Sử dụng **Google Cloud Vertex AI ADC** (dự án `gemini-image-benchmark`) cho toàn bộ pipeline: Gemini 2.5 Flash (Vision/OCR), Text Embedding 004 (Vector Semantic Similarity).

---

## 2. Chi tiết các Logic đã triển khai (Stage by Stage)

### 🟢 Stage B1 — Phân tích sản phẩm từ hình ảnh (Product Understanding)
* **Mục tiêu**: Đọc hiểu sâu thiết kế, chi tiết đồ họa và thuộc tính của sản phẩm từ ảnh/mockup.
* **Logic cốt lõi**:
  * Tích hợp **Gemini 2.5 Flash Vision** (`@google/genai` Vertex AI client):
    * Nhận diện chữ trên thiết kế (**OCR texts**).
    * Nhận diện thực thể hình ảnh (**detected entities**: icon, vật thể, giao diện...).
    * Trích xuất gam màu chủ đạo (**dominant colors**).
    * Nhận diện phong cách mỹ thuật (**visual style**).
    * Phân loại sản phẩm (**product category**).
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
  * **Bộ chọn hạt giống (`search-seed-selector.ts`)**: Ưu tiên chọn top Buyer Intent Seeds từ B2 kết hợp Niche Seed, Category Seed từ B1 (tối đa 6 seeds).
  * **Chuẩn hóa & Khử trùng (`search-suggestions-normalizer.ts`)**: Chuẩn hóa Unicode NFKC, loại bỏ URL, ký tự điều khiển và trùng lặp chuỗi.
  * **Fallback tất định (`FallbackSearchSuggestionsCollector`)**: Bảo đảm tính bất biến offline trong automated tests (zero-network).
* **Contract đầu ra**: `context.searchResearch` (`seedKeywords`, `suggestedQueries`, `querySources`).

### 🟢 Stage B4 — Kiểm soát xung đột & Khử trùng lặp từ khóa (Conflict Control)
* **Mục tiêu**: Lọc sạch từ khóa lệch ngành, khử trùng lặp ngữ nghĩa (cannibalization), chấm điểm tiềm năng và gom cụm từ khóa.
* **Logic cốt lõi**:
  * **Kiến trúc Vector-First Hybrid Conflict Engine**:
    * **Primary Provider**: Google Vertex AI `text-embedding-004` (768 chiều). Nhúng tài liệu tham chiếu sản phẩm đa tầng (Dual Reference: Product Identity & Shopping Intent) và nhúng toàn bộ candidate queries.
    * **Fallback Provider**: `LocalTfidfVectorizer` (kết hợp unigram trọng số 2.0, bigram 2.5, char 3-gram 0.5, từ điển chuẩn hóa đồng nghĩa) đảm bảo offline unit test chạy độc lập.
    * **Single-Vector-Space Invariant**: 100% vector so sánh trong một phiên phải thuộc cùng một provider/model; nếu Primary lỗi thì fallback toàn bộ, không bao giờ lai tạp.
  * **Khử trùng lặp ngữ nghĩa dựa trên đại diện (Representative-Based Incremental Clustering)**:
    * Sắp xếp ứng viên theo điểm liên quan, provenance và độ dài thương mại.
    * Ứng viên top 1 làm Leader của cụm; các ứng viên sau chỉ so sánh với Leader của các cụm hiện hữu (loại trừ lỗi over-merge lan truyền của DSU).
  * **Bộ lọc xung đột đa tầng có thứ bậc ưu tiên cố định (Deterministic Precedence)**:
    1. `exact_duplicate`: Trùng chuỗi chính xác.
    2. `brand_conflict`: Cấm nhãn hiệu bản quyền (Nike, Disney, v.v.).
    3. `existing_url_cannibalization`: Tránh xung đột với sản phẩm/URL đã có trên site.
    4. `category_conflict`: Loại trừ lệch ngành (ví dụ: gạt bỏ `rugby` khi sản phẩm là thảm `rug`).
    5. `search_intent_mismatch`: Loại bỏ từ khóa thông tin phi thương mại ("how to draw", "tutorial").
    6. `semantic_drift_irrelevant`: Loại bỏ từ khóa có điểm vector quá thấp (< 0.54).
    7. `semantic_duplicate`: Khử trùng lặp ngữ nghĩa nội bộ.
  * **Làm giàu siêu dữ liệu cho B5**: Xuất kèm bảng điểm `relevanceScores` và danh sách phân cụm `keywordClusters`.
* **Contract đầu ra**: `context.conflictResult` (`approvedKeywords`, `discardedKeywords`, `conflictReasons`, `relevanceScores`, `keywordClusters`).

### ⏳ Stage B5 & B6 — Kế hoạch tiếp theo
* **B5 (SEO Content Generation)**: Sử dụng các từ khóa đã duyệt từ B4 (phân chia Primary/Focus Keyword cho Title & URL, Secondary Keywords cho Bullet Points & Description, Supporting Keywords cho Alt Text) để sinh bộ nội dung hoàn chỉnh.
* **B6 (Image Processing)**: Xử lý chuyển đổi ảnh sang WebP, tạo tên file chuẩn SEO và gắn alt text tương ứng.

---

## 3. Những Điểm Kỹ Thuật Đã Chốt (Architectural Decisions)

1. **Node.js Runtime & Filesystem**: Source code của module hoàn toàn chạy trên Node.js runtime, được phép dùng `node:fs`, `node:path`, `Buffer` để xử lý file/ảnh cục bộ.
2. **Gemini API & Vertex AI Coverage**: Toàn bộ pipeline được phép và khuyến khích tận dụng sức mạnh của Google Cloud Vertex AI (Gemini Flash Vision cho B1; Gemini Text-Embedding-004 cho B4; Gemini LLM cho B5).
3. **Quy tắc Bất biến Offline trong Unit Test (Zero-Network Test Invariant)**:
   * Toàn bộ 183 bài unit test tự động khi chạy `npm test` đều sử dụng mock runner hoặc local deterministic vectorizer/fallbacks. Không gọi mạng ra ngoài khi chạy test để đảm bảo test luôn xanh, chạy nhanh và độc lập với mạng internet.
   * Khi chạy môi trường thực tế hoặc script trực quan (`test.cmd`), pipeline tự động kích hoạt API thật của Vertex AI và Google Suggest.
4. **Enriched Metadata Transition B4 $\rightarrow$ B5**: B4 không chỉ trả về flat array mà trả về đầy đủ `relevanceScores` và `keywordClusters` để B5 có cơ sở xếp hạng từ khóa hot/trending và chọn từ khóa chính.

---

## 4. Những Lỗi Đã Phát Hiện & Đã Khắc Phục (Bug Fixes & Hardening)

| STT | Lỗi phát hiện | Nguyên nhân gốc rễ | Giải pháp đã khắc phục |
|:---:|---|---|---|
| 1 | **UI hiển thị "0 kết quả" gợi ý Google Autocomplete** | Trong `b3-search-suggestions.ts`, điều kiện `arg.includes("test")` bị kích hoạt nhầm khi tham số truyền vào chứa đường dẫn ảnh nằm trong thư mục `__tests__\media` $\rightarrow$ Hệ thống tưởng nhầm đang chạy unit test nên tự bật Fallback offline trả về `[]`. | Sửa logic nhận diện test runner thành kiểm tra cờ `--test` của Node/tsx hoặc đuôi file `.test.ts`. Thêm `set SEO_SEARCH_PROVIDER=google` vào `test.cmd`. |
| 2 | **Bỏ qua ngưỡng `relevanceReject` trong Vùng Xám B4** | Trong `keyword-relevance-evaluator.ts`, code viết `if (hasAnchor && relevanceScore > 0)` khiến từ khóa trôi dạt ngữ nghĩa nhưng có dính 1 từ anchor vẫn bị duyệt. | Khóa chặt điều kiện: `relevanceScore >= thresholds.relevanceReject && hasAnchor`. Hiệu chuẩn `relevanceReject = 0.01` cho local sparse vector. |
| 3 | **Crash Regex khi gặp ký tự đặc biệt (Metacharacters)** | `new RegExp(\`\\b\${brand}\\b\`)` gặp các nhãn hiệu hoặc thực thể có ký tự `+`, `(`, `[`, `*` (ví dụ `Disney+`, `C++`, `cat (spooky)`) sẽ ném `SyntaxError`. | Xây dựng hàm tiện ích `safeWordBoundaryRegex` và `escapeRegex`, tự động escape toàn bộ metacharacter và chỉ đặt `\b` khi ký tự biên là word character. |
| 4 | **Lệch Alias Provider ID giữa Vertex AI và Corpus** | `VertexTextEmbeddingProvider` dùng `providerId = "vertex"` trong khi analyzer kiểm tra `"vertex_ai"`, làm metadata vector bị gán nhầm thành `"local_tfidf"`. | Chuẩn hóa `providerId = "vertex_ai"` và cập nhật `isEmbeddingCompatible` chấp nhận tương thích chéo giữa 2 alias. |
| 5 | **Thiếu Guard kiểm tra số lượng vector batch** | `createVectorSession` không kiểm tra số lượng vector trả về từ API có khớp với số lượng keywords yêu cầu hay không. | Bổ sung assertion kiểm tra độ dài mảng vector, tự động kích hoạt fallback tất định nếu có mất mát dữ liệu batch. |
| 6 | **Rò rỉ dấu câu trong chuẩn hóa từ khóa** | Từ khóa chứa dấu phẩy/chấm cuối chuỗi (`"vintage tee,"`) bị trôi qua bước khử trùng lặp chính xác. | Nâng cấp `canonicalizeKeyword` tự động cắt tỉa toàn bộ dấu câu đầu và cuối chuỗi. |

---

## 5. Kết Quả Kiểm Thử & Nghiệm Thu

### 5.1. Kiểm thử tự động (Automated Verification)
* **Unit Tests (`npm test`)**: **183/183 tests PASS 100%** (0 failed, 0 skipped, thời gian chạy ~3.5s).
  * Stage B1 Tests: 43 tests (Gemini Vision, OCR, Fallback, Payloads, Retries).
  * Stage B2 Tests: 33 tests (Shopping Context, Audience, Occasions, Buyer Intent Seeds).
  * Stage B3 Tests: 39 tests (Google Suggest Client, LRU Cache, Circuit Breaker, Normalizer, Collector).
  * Stage B4 Tests: 29 tests (Vector Embedding, Cosine Sim, Duplicate Clustering, Category/Brand/Intent Guards, Regex Safety).
  * Pipeline & Orchestrator Tests: 39 tests.
* **Typecheck (`npm run typecheck`)**: **0 lỗi** (TypeScript strict mode, tuyệt đối không dùng `any`).
* **Production Build (`npm run build`)**: Build thành công trong 607ms.
* **Mock Build (`npm run build:mock`)**: Build thành công trong 596ms.

### 5.2. Kiểm thử trực quan thực tế (Visual Inspection qua `test.cmd`)
Đã thực thi script `test.cmd` với sản phẩm mẫu:
* **Ảnh**: `src\modules\module-seo-content\__tests__\media\8e0cfedae08f18301b3fcb668c1192b14716606b9ba78d9f2c03b3194e3a20d0_9e062a6b-1a87-439d-80f9-6b42fdb6eeba.webp`
* **Title**: `"Personalized Music Player Area Rug"`
* **Niche**: `"personalized rug"`

**Kết quả thu được:**
1. **B1**: Nhận diện chính xác chữ OCR (`["Song Title", "Artist", "2.27", "-0.34"]`), thực thể giao diện nghe nhạc, màu sắc chủ đạo (`black, white, gray`), phong cách `digital interface design`, phân loại `rug`.
2. **B2**: Xác định 6 nhóm khách hàng, 6 dịp tặng quà, 6 công năng sử dụng, 10 hạt giống ý định thương mại.
3. **B3**: Thu thập 8 gợi ý tìm kiếm trực tiếp từ Google Autocomplete API.
4. **B4**: 
   * **Loại bỏ 3 từ khóa lệch ngành**: `"personalized rugby ball"`, `"personalized rugby jersey"`, `"personalized rugby shirts"` $\rightarrow$ Lý do: `category_conflict` (bóng bầu dục lệch với thảm).
   * **Loại bỏ 4 từ khóa trùng lặp ngữ nghĩa**: `"music player interface rug"`, `"personalized rugs"`, `"personalized rug"`, `"personalized rugs with pictures"` $\rightarrow$ Lý do: `semantic_duplicate`.
   * **Duyệt 7 từ khóa tốt nhất**: `"personalized music player rug"`, `"custom song title area rug"`, `"modern music interface rug"`, `"music lover floor mat"`, `"personalized rugs for bedroom"`, `"personalized rug for business"`, `"personalized rugs for front door"`.
5. **Giao diện HTML Preview**: Toàn bộ kết quả B1 $\rightarrow$ B2 $\rightarrow$ B3 $\rightarrow$ B4 được render chi tiết và trực quan tại [`b1-visual-preview.html`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/b1-visual-preview.html).

---

## 6. Sẵn Sàng Cho Bước Kế Tiếp

Module hiện đang ở trạng thái kỹ thuật cực kỳ vững chắc, tuân thủ 100% ranh giới module và các tiêu chuẩn kiểm thử của dự án.  
👉 **Kế hoạch tiếp theo**: Tiến hành phối hợp cùng ChatGPT bản web để lập kế hoạch và triển khai **Stage B5 (SEO Content Generation)**.
