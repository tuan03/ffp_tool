# Báo Cáo Nghiệm Thu Bước B3: Search Suggestions & Google Autocomplete

> **Module:** SEO + Content (`module-seo-content`)  
> **Giai đoạn:** Bước B3 — Mở rộng gợi ý tìm kiếm & nghiên cứu từ khóa (Search Suggestions)  
> **Người thực hiện (Worker):** Antigravity Coding Agent  
> **Người đánh giá (Reviewer / Planner):** ChatGPT Web Team  
> **Trạng thái:** **APPROVED / ACCEPTED (ĐÃ NGHIỆM THU CODE & KIẾN TRÚC)** ✅

---

## 1. Tổng quan mục tiêu Bước B3

Bước B3 chịu trách nhiệm tiếp nhận tập dữ liệu bối cảnh mua sắm (`ShoppingContext`) từ Bước B2 cùng thông tin sản phẩm từ Bước B1 và nguồn người bán (`source`), sau đó mở rộng không gian tìm kiếm thực tế cho sản phẩm thông qua dịch vụ gợi ý tìm kiếm (Search Suggestions):

- **Trọng tâm triển khai v1:** Thu thập dữ liệu tìm kiếm thực tế từ **Google Autocomplete API** (Etsy Suggest Scraper và People Also Ask - PAA được bảo lưu trong kế hoạch dài hạn).
- **Hạt giống tìm kiếm (`seedKeywords`):** Lựa chọn tối đa 6 cụm từ hạt giống có ý định mua sắm cao nhất theo thứ bậc ưu tiên tất định từ B2 và B1.
- **Truy vấn gợi ý mở rộng (`suggestedQueries`):** Thu thập tối đa 8 gợi ý chất lượng cho mỗi seed và tối đa 40 truy vấn trên toàn bộ sản phẩm.
- **Minh bạch nguồn gốc (`querySources`):** Gắn nhãn xuất xứ rõ ràng và chuẩn hóa (`buyer_intent_seed`, `category_seed`, `niche_seed`, `title_seed`, `fallback_seed`, `google_autocomplete`), hỗ trợ cơ chế nâng cấp nguồn gốc (Provenance Upgrade) khi truy vấn hạt giống được chính Google xác thực bằng kết quả tìm kiếm thực tế.

---

## 2. Kiến trúc & Các thành phần đã triển khai

Tất cả mã nguồn Bước B3 được tổ chức chuẩn mực theo ranh giới mô-đun trong thư mục:
`src/modules/module-seo-content/internal/search-suggestions/`

### 2.1. Quản lý nguồn gốc & Thứ bậc định danh (Provenance & Precedence)

- **`query-source.ts`:**
  - Khai báo hằng số chuẩn hóa `QUERY_SOURCE` và kiểu dữ liệu `QuerySource`:
    - `buyer_intent_seed`: Hạt giống ý định mua sắm từ B2.
    - `category_seed`: Hạt giống kết hợp danh mục và thực thể thị giác từ B1.
    - `niche_seed`: Hạt giống phân ngách từ nguồn sản phẩm.
    - `title_seed`: Cụm từ hạt giống trích xuất sạch từ tiêu đề gốc (chỉ khi dữ liệu nghèo nàn).
    - `fallback_seed`: Danh từ danh mục an toàn khi hoàn toàn thiếu dữ liệu.
    - `google_autocomplete`: Truy vấn gợi ý được xác nhận thực tế bởi Google.
  - Hàm `shouldUpgradeSource`: Thiết lập thứ bậc ưu tiên (`google_autocomplete > buyer_intent_seed > category_seed > niche_seed > title_seed > fallback_seed`) phục vụ việc thăng hạng nguồn gốc minh bạch.

### 2.2. Xử lý lỗi đặc thù (Error Classification)

- **`search-suggestion-errors.ts`:**
  - `GoogleSuggestError`: Lớp lỗi cơ sở, gắn cờ `status` HTTP và `isRetryable`.
  - `GoogleSuggestRateLimitError`: Đại diện cho mã HTTP 429 (Rate Limit), gắn cờ retryable.
  - `GoogleSuggestBlockedError`: Đại diện cho mã HTTP 403 (Forbidden / Bot Block), gắn cờ non-retryable để lập tức kích hoạt Circuit Breaker.

### 2.3. Lựa chọn hạt giống tìm kiếm tất định (Seed Selector)

- **`search-seed-selector.ts`:**
  - Triển khai hàm `selectSearchSeeds(input: SearchSeedSelectionInput): readonly SearchSeed[]`.
  - Tuân thủ nghiêm ngặt thứ tự ưu tiên và giới hạn số lượng (`MAX_SEARCH_SEEDS = 6`):
    1. **Ưu tiên 1:** Lấy tối đa 4 hạt giống ý định mua sắm hàng đầu từ `buyerIntentKeywords` của B2 (`MAX_B2_SEEDS = 4`).
    2. **Ưu tiên 2:** Tổng hợp 1 hạt giống từ Category + Detected Entity mạnh nhất của B1 (ví dụ `black cat t-shirt`) nếu chưa được bao phủ và còn chỗ (`< 6`).
    3. **Ưu tiên 3:** Bổ sung Niche seed nếu hữu ích và chưa trùng lặp (`< 6`).
    4. **Ưu tiên 4:** Chỉ trích xuất cụm từ tiêu đề ngắn gọn (tối đa 6 từ, không bùng nổ token đơn lẻ) khi số lượng hạt giống còn quá ít (`< 3`).
    5. **Ưu tiên 5:** Danh từ danh mục an toàn (ví dụ `t-shirt` hoặc `product`) chỉ kích hoạt khi hoàn toàn không có bất kỳ hạt giống nào (`seeds.length === 0`). Lọc bỏ triệt để các nhãn danh mục giả mạo (`unspecified`, `none`, `unknown`, `n/a`).
  - Toàn bộ hạt giống được chuẩn hóa Unicode NFKC, gộp khoảng trắng và deduplicate qua khóa chuẩn hóa `canonicalKey`. Tránh lặp từ thừa khi thực thể thị giác đã bao hàm danh mục (ví dụ tránh sinh `black cat t-shirt t-shirt`).

### 2.4. Trình chuẩn hóa & Khóa định danh đồng nhất (Normalizer & Canonicalization)

- **`search-suggestions-normalizer.ts`:**
  - Chuẩn hóa Unicode NFKC, cắt tỉa và rút gọn khoảng trắng liên tiếp.
  - Hàm `canonicalKey(query)` chuẩn hóa đồng nhất dấu gạch nối/dưới thành khoảng trắng (`replace(/[-_]/g, " ")`), đưa về chữ thường để khớp chính xác giữa các biến thể ngữ nghĩa (ví dụ `vintage black cat t-shirt` và `vintage black cat t shirt`).
  - Loại bỏ các chuỗi không hợp lệ: chuỗi rỗng, ký tự điều khiển (`[\u0000-\u001F\u007F-\u009F]`), đường dẫn URL thô (`http://`, `https://`, `www.`).
  - Giới hạn kỹ thuật an toàn: `MAX_QUERY_LENGTH = 120` ký tự, `MAX_QUERY_TOKENS = 12` từ.
  - Giới hạn số lượng (Cardinality Limits): `MAX_PER_SEED_SUGGESTIONS = 8`, `MAX_GLOBAL_SUGGESTIONS = 40`.
  - **Bảo toàn bằng chứng thực tế (Critical Invariant P):** Tuyệt đối KHÔNG áp dụng bộ lọc từ ngữ thương mại của B2 (`best`, `cheap`, `near me`, `amazon`, `etsy`, `for`, `with`, `gift`) đối với kết quả từ Google. Đây là bằng chứng tìm kiếm bên ngoài có giá trị và phải được giữ nguyên vẹn để Bước B4/B5 xử lý.
  - Deduplicate không phân biệt hoa thường nhưng bảo toàn nguyên văn chữ hoa/thường xuất hiện lần đầu tiên từ Google.

### 2.5. Cơ chế Bộ nhớ đệm Tìm kiếm (Search Suggestions Cache)

- **`search-suggestions-cache.ts`:**
  - Định nghĩa interface `GoogleSuggestCache` chuẩn (`get`, `set`, `has`, `clear`, `size`).
  - Lớp `InMemoryGoogleSuggestCache` tích hợp:
    - Thời gian sống TTL linh hoạt (mặc định 15 phút - 900.000ms).
    - Chiến lược dọn dẹp dung lượng LRU (Least Recently Used) với giới hạn tối đa `maxSize` (mặc định 500 truy vấn) để chống rò rỉ bộ nhớ trong môi trường runtime dài hạn.
    - Tính năng sao chép phòng thủ (Defensive Copying) ngăn chặn việc đột biến dữ liệu mảng làm hỏng cache.
  - Hàm tạo khóa cache `createSuggestCacheKey(query, language, country)` tối ưu theo locale và khóa chuẩn hóa.
  - Cung cấp singleton `defaultGoogleSuggestCache` dùng chung cho toàn ứng dụng hoặc cho phép tiêm cache độc lập cho từng client.

### 2.6. Tầng giao tiếp Google Suggest & Khả năng chịu lỗi (Client Layer)

- **`google-suggest-client.ts`:**
  - Interface `GoogleSuggestClient` trừu tượng hỗ trợ Dependency Injection và testing không cần mạng.
  - Lớp `UnofficialGoogleSuggestClient` giao tiếp với endpoint `https://suggestqueries.google.com/complete/search?client=firefox`.
  - Hỗ trợ truyền tham số địa phương rõ ràng (`hl` ngôn ngữ, mặc định `"en"`, `gl` quốc gia, mặc định `"us"`), cho phép cấu hình linh hoạt qua biến môi trường `SEO_SEARCH_LANGUAGE` và `SEO_SEARCH_COUNTRY`.
  - Tích hợp bộ nhớ đệm `GoogleSuggestCache`: Tự động kiểm tra và trả về kết quả ngay lập tức khi trúng cache, tránh gọi mạng dư thừa; hỗ trợ tùy chọn `bypassCache: true` để buộc gọi mới khi cần.
  - Quản lý vòng đời `AbortSignal`: Phân biệt rành mạch giữa ngắt kết nối do người dùng (`signal.abort()` - không bao giờ retry, lập tức hủy và gỡ bỏ event listener) và lỗi quá thời gian chờ (Timeout 3000ms - mã 408, retryable).
  - Retry Policy: Tự động retry đúng 1 lần với độ trễ 500ms đối với các lỗi tạm thời (408, 429, 502, 503, 504, timeout, network error). Lỗi vĩnh viễn (400, 401, 403, 404, malformed shape, caller abort) ném lỗi ngay lập tức mà không retry.
  - Parser phòng vệ (Defensive Parsing): Kiểm tra `Array.isArray(root)`, `root.length >= 2`, `root[1]` là mảng chuỗi `string[]`. Bỏ qua an toàn mọi trường metadata mở rộng ở index 2+.

### 2.7. Bộ thu thập dữ liệu & Bộ ngắt mạch hàng loạt (Collector & Circuit Breaker)

- **`google-search-suggestions-collector.ts`:**
  - Điều phối thu thập gợi ý cho từng hạt giống theo cơ chế tuần tự (concurrency = 1) kèm khoảng nghỉ `interRequestDelayMs` (250ms trong live mode, 0ms trong unit test) để tránh gây áp lực lên endpoint.
  - **Bộ ngắt mạch theo lô (Batch Circuit Breaker):**
    - Ngắt ngay lập tức toàn bộ các seed còn lại trong lô khi gặp mã 403 (bị Google chặn) hoặc 429 kéo dài (Rate limit), kể cả khi lỗi được gói dưới dạng `GoogleSuggestError` có mã trạng thái tương ứng.
  - **Chấp nhận lỗi một phần (Partial Failure Preservation):** Nếu 1 seed gặp sự cố mạng hoặc 5xx, hệ thống bảo tồn nguyên vẹn các gợi ý đã thu thập thành công từ các seed trước đó và tiếp tục xử lý các seed tiếp theo nếu chưa bị ngắt mạch.
  - **Nâng cấp hạt giống trùng khớp (Exact Match Provenance Upgrade):** Khi một gợi ý từ Google trùng khớp chính xác (kể cả biến thể dấu gạch nối) với một seed ban đầu, hệ thống không thêm bản sao vào mảng `suggestedQueries`, mà nâng cấp nguồn gốc của seed trong `querySources` thành `google_autocomplete`.
  - **Thứ tự tất định (Deterministic Ordering):** Bảo toàn tuyệt đối thứ tự ưu tiên của seed và thứ tự gợi ý do Google trả về (first-seen wins), không sắp xếp lại theo bảng chữ cái ABC.

### 2.8. Bộ thu thập dự phòng không mạng (Fallback Collector)

- **`fallback-search-suggestions-collector.ts`:**
  - Thực thi phương án dự phòng hoàn toàn tất định khi Google Autocomplete không khả dụng hoặc bị vô hiệu hóa.
  - **Độ trung thực dữ liệu tuyệt đối (Critical Invariants S & T):** Trả về danh sách hạt giống đã chọn `seedKeywords`, mảng `suggestedQueries: []` (rỗng), và ánh xạ nguồn gốc seed gốc. Tuyệt đối KHÔNG tự động sinh các truy vấn giả mạo (synthetic variations) và KHÔNG mang nhãn `google_autocomplete` khi chưa có xác nhận từ Google.

### 2.9. Tích hợp Pipeline Stage B3 (Stage Wiring)

- **`src/modules/module-seo-content/internal/stages/b3-search-suggestions.ts`:**
  - Hàm tạo stage `createB3SearchSuggestionsStage(dependencies?)` hỗ trợ Dependency Injection hoàn hảo và khởi tạo collector động tại thời điểm thực thi.
  - Cấu hình provider rõ ràng qua biến môi trường `SEO_SEARCH_PROVIDER` (`google` | `offline` | `fallback`) hoặc `SEO_SEARCH_SUGGESTIONS_ENABLED` (`false`).
  - Trong môi trường kiểm thử tự động (`NODE_ENV === "test"` hoặc runner kiểm thử), mặc định kích hoạt chế độ an toàn `FallbackSearchSuggestionsCollector` để bảo đảm nguyên tắc Zero-Network cho test suite.
  - Thực thi bất biến `evolveContext(context, { searchResearch })`, tạo đối tượng context mới mà không làm đột biến dữ liệu gốc.

---

## 3. Các bất biến kiến trúc cốt lõi đã được kiểm chứng (Invariants)

1. **External Evidence Grounding Invariant (Data Fidelity):**
   Gợi ý tìm kiếm thuộc Bước B3 phải là bằng chứng tìm kiếm thực tế từ bên ngoài. Khi Google không khả dụng, hệ thống trả về mảng rỗng `suggestedQueries: []` thay vì tự bịa đặt query giả mạo gắn mác tìm kiếm.
2. **Provenance Integrity Invariant:**
   Nhãn `google_autocomplete` chỉ được gán duy nhất cho các truy vấn thực tế do Google trả về hoặc hạt giống được Google xác thực chính xác. Chế độ fallback tuyệt đối không được sử dụng nhãn này.
3. **External Text Preservation Invariant (No B2 Banned-Word Leakage):**
   Không áp dụng bộ lọc từ ngữ tiếp thị (`best`, `cheap`, `near me`, `amazon`, `etsy`) lên kết quả của Google. Mọi dữ liệu khách quan từ người dùng tìm kiếm được giữ nguyên để chuyển giao cho Bước B4/B5 đánh giá mức độ phù hợp.
4. **Duplicate Seed Upgrade Invariant:**
   Khi kết quả gợi ý trùng với seed đầu vào, hệ thống không tạo bản sao trùng lặp trong danh sách kết quả, đồng thời nâng cấp định danh nguồn gốc của seed thành `google_autocomplete`.
5. **Batch Circuit Breaker Invariant:**
   Gặp lỗi 403 (Forbidden) hoặc 429 kéo dài lập tức dừng toàn bộ các truy vấn còn lại trong lô để bảo vệ hệ thống và tôn trọng chính sách endpoint.
6. **Deterministic Cardinality & Ordering Invariant:**
   Khóa cứng các giới hạn: tối đa 6 seed, tối đa 8 gợi ý/seed, tối đa 40 gợi ý toàn cục. Thứ tự gợi ý giữ nguyên theo thứ tự xếp hạng của Google (first-seen wins), không sort ABC.
7. **Zero-Network Test Invariant:**
   Bộ unit test sử dụng Mock Client/Fetch, hoàn toàn không phát sinh bất kỳ kết nối mạng thực tế nào trong quá trình chạy `npm test`.

---

## 4. Quá trình phối hợp và đánh giá từ ChatGPT (Reviewer / Planner)

### Vòng 1 — Lập kế hoạch & Thống nhất kiến trúc:

- Worker soạn thảo đề xuất chi tiết về bối cảnh, interface, giới hạn seed và khả năng chịu lỗi.
- ChatGPT phản hồi bản kế hoạch kỹ thuật gồm 20 mục định hướng, trong đó có các chỉ đạo mang tính quyết định:
  1. _Khóa nhãn định danh:_ Chuẩn hóa canonical string constants `QUERY_SOURCE` và cơ chế thăng hạng nguồn gốc.
  2. _Bác bỏ synthetic suggestions khi fallback:_ Fallback khi Google unavailable phải trả về `suggestedQueries: []`, giữ vững ranh giới giữa B2 (AI inference) và B3 (external search evidence).
  3. _Giới hạn gọi mạng:_ Tối đa 6 seeds, thứ tự deterministic, không lặp lại hiện tượng bùng nổ token đơn lẻ từ tiêu đề.
  4. _Phân định ranh giới bộ lọc:_ B3 không được copy bộ lọc từ cấm của B2; từ khóa `best`, `cheap`, `near me`, `etsy` từ Google phải được bảo tồn.
  5. _Quy định bộ ngắt mạch (Circuit Breaker):_ Ngắt ngay lập tức khi gặp 403 hoặc 429 lặp lại.

### Vòng 2 — Báo cáo hoàn thành mã nguồn & Đánh giá nghiệm thu:

Worker hoàn thành toàn bộ mã nguồn, cấu hình stage, bổ sung 30 unit tests độc lập theo ma trận Groups A đến Y, chạy sạch kiểm thử và thực hiện live smoke test với Google Autocomplete API thật.

**Đánh giá chính thức từ ChatGPT Reviewer:**

```text
Verdict: B3 IMPLEMENTATION APPROVED ✅

Domain contract                 PASS ✅
Canonical provenance            PASS ✅
Seed selection                  PASS ✅
Max 6 external requests         PASS ✅
Google response parsing         PASS ✅
Locale hl/gl                    PASS ✅
Timeout/retry                   PASS ✅
403/429 circuit breaker         PASS ✅
Partial-failure preservation    PASS ✅
Technical-only filtering        PASS ✅
Case-insensitive dedupe         PASS ✅
External text preservation      PASS ✅
Suggestion==seed upgrade        PASS ✅
No fabricated Google evidence   PASS ✅
Offline degraded state          PASS ✅
Deterministic ordering          PASS ✅
DI / zero-network unit tests    PASS ✅
Context immutability            PASS ✅
B2→B3 integration               PASS ✅
Pipeline regression             PASS ✅
Live Google happy path          PASS ✅

Automated tests                 145/145 ✅ reported
TypeScript strict               PASS ✅ reported
Production build                PASS ✅ reported
Mock build                      PASS ✅ reported

Final status:
B1 Product Understanding     ✅ APPROVED
B2 Shopping Context          ✅ APPROVED
B3 Search Suggestions        ✅ APPROVED

Đóng nghiệm thu development B3. Có thể chuyển sang B4.
```

### Lưu ý quan trọng cho Bước B4 & B5 downstream:

ChatGPT nhấn mạnh một phát hiện có giá trị từ live smoke test: Google có thể mở rộng từ khóa sang các truy vấn mang tính thông tin hoặc lệch ngữ nghĩa (`how to draw a black cat for halloween`, `do black cats get hurt on halloween`, `vintage black panther t shirt`).  
-> B3 đã làm tròn vai trò thu thập external evidence khách quan. Khi chuyển sang Bước B4 (Conflict Control) và Bước B5 (Content Generation), downstream **tuyệt đối không được coi mọi query có nhãn `google_autocomplete` đều là từ khóa thích hợp để target**. B4/B5 sẽ chịu trách nhiệm sàng lọc mức độ liên quan thương mại đến sản phẩm.

---

## 5. Kết quả kiểm thử & xác minh (Verification Record)

### 5.1. Bảng tổng hợp lệnh kiểm tra

| Lệnh kiểm thử                                                                           | Phạm vi               | Kết quả                 | Ghi chú                                                                        |
| :-------------------------------------------------------------------------------------- | :-------------------- | :---------------------- | :----------------------------------------------------------------------------- |
| `npx tsx --test src/modules/module-seo-content/__tests__/b3-search-suggestions.test.ts` | B3 Unit Test Suite    | **39/39 PASS** (100%)   | Đầy đủ 34 nhóm Groups A đến Y và Z1 đến Z9                                     |
| `npm test`                                                                              | Toàn bộ ứng dụng      | **154/154 PASS** (100%) | Toàn bộ các module, pipeline integration & orchestrator                        |
| `npm run typecheck`                                                                     | TypeScript Strict     | **PASS (0 errors)**     | `tsc --noEmit` hoàn toàn sạch                                                  |
| `npm run build`                                                                         | Vite Production Build | **PASS**                | Đóng gói client bundle thành công (611ms)                                      |
| `npm run build:mock`                                                                    | Vite Mock Build       | **PASS**                | Đóng gói mock mode thành công (577ms)                                          |
| `npx tsx src/modules/module-seo-content/scripts/b3-smoke-test.ts`                       | Live Smoke Test       | **PASS**                | Gọi Google Autocomplete thật, trả về 39 gợi ý, thăng hạng provenance chuẩn xác |

### 5.2. Chi tiết kết quả Live Smoke Test (Artifact)

Lệnh thực thi: `npx tsx src/modules/module-seo-content/scripts/b3-smoke-test.ts`

- **Thời gian hoàn thành:** 2524 ms
- **Số lượng hạt giống nghiên cứu:** 6 seeds
- **Số lượng gợi ý thu được:** 39 queries
- **Dữ liệu hạt giống đã chọn:**
  - `vintage black cat t-shirt` [`google_autocomplete`] _(Thăng hạng thành công nhờ Google trả về biến thể chính xác!)_
  - `black cat halloween t-shirt` [`google_autocomplete`] _(Thăng hạng thành công!)_
  - `halloween t-shirt` [`buyer_intent_seed`]
  - `gift for cat lover` [`google_autocomplete`] _(Thăng hạng thành công!)_
  - `black cat t-shirt` [`category_seed`]
  - `halloween` [`google_autocomplete`] _(Thăng hạng thành công!)_
- **Mẫu truy vấn gợi ý nhận được (10/39):**
  - `vintage black panther t shirt` [`google_autocomplete`]
  - `vintage black cat fireworks t shirt` [`google_autocomplete`]
  - `vintage black panther party t shirts` [`google_autocomplete`]
  - `retro 4 black cat t shirt` [`google_autocomplete`]
  - `black panther costume t shirt` [`google_autocomplete`]
  - `how to draw a black cat for halloween` [`google_autocomplete`]
  - `do black cats get hurt on halloween` [`google_autocomplete`]
  - `halloween t-shirts` [`google_autocomplete`]
  - `halloween t-shirt women's` [`google_autocomplete`]
  - `halloween t-shirts for adults` [`google_autocomplete`]
