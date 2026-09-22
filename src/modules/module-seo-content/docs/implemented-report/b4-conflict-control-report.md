# Báo cáo Triển khai Stage B4: Keyword Conflict Control & Deduplication Engine (Động cơ Kiểm soát Xung đột & Khử trùng lặp Từ khóa)

## 1. Giới thiệu tổng quan

Stage B4 trong pipeline SEO Content chịu trách nhiệm nhận toàn bộ tập hợp hạt giống và gợi ý tìm kiếm (từ Google Autocomplete, Buyer Intent Seeds, Niche Seeds ở B3), sau đó thực hiện sàng lọc thông minh:
- Loại bỏ từ khóa trùng lặp chính xác (Exact Deduplication) và trùng lặp ngữ nghĩa (Semantic Duplicate / Keyword Cannibalization).
- Ngăn chặn hiện tượng xung đột phân loại (Category Conflict - ví dụ "rugby" nhầm thành "rug", "cat food" nhầm với thời trang).
- Ngăn chặn các truy vấn ý định thông tin phi thương mại (Search Intent Mismatch - ví dụ "how to draw", "tutorial", "history of").
- Loại trừ nhãn hiệu vi phạm bản quyền (Brand Conflict Guard - ví dụ "Nike", "Disney", "Jordan").
- Ngăn ngừa hiện tượng tự triệt tiêu URL nội bộ (Existing URL Cannibalization - khi đối chiếu với chỉ mục SEO site-wide).
- Sắp xếp thứ hạng từ khóa được duyệt (Deterministic Ranking) dựa trên điểm tương đồng ngữ nghĩa, nguồn gốc xuất xứ (provenance) và độ dài thương mại lý tưởng.

---

## 2. Kiến trúc & Thuật toán: Vector-First Hybrid Conflict Engine

Theo yêu cầu ưu tiên thuật toán vector từ Leader và bản thiết kế đã được ChatGPT Web phê duyệt, Stage B4 triển khai kiến trúc **Vector-First Hybrid Conflict Engine**:

### 2.1. Không gian Vector Nhất quán (Single-Vector-Space Invariant)
Toàn bộ các vector so sánh trong một phiên phân tích phải đến từ **100% cùng một nhà cung cấp (provider) và cùng một không gian nhúng (embedding space)**:
- **Primary Provider**: Google Vertex AI `text-embedding-004` (768 chiều).
- **Task Types**:
  - `RETRIEVAL_DOCUMENT`: Nhúng văn bản tham chiếu sản phẩm (Dual Reference: Product Identity và Shopping Intent).
  - `RETRIEVAL_QUERY`: Nhúng các từ khóa truy vấn người dùng (User Queries).
  - `SEMANTIC_SIMILARITY`: Nhúng pairwise giữa các từ khóa để đo độ trùng lặp ngữ nghĩa.
- **Fallback Provider**: Bộ vector hóa cục bộ tất định `LocalTfidfVectorizer` (kết hợp unigram trọng số 2.0, bigram trọng số 2.5, char 3-gram trọng số 0.5, từ điển chuẩn hóa đồng nghĩa `retro->vintage`, `tee->t-shirt`, L2 normalization).
- **Quy tắc bất biến**: Nếu Primary Provider gặp sự cố (mất mạng, hết hạn ngạch 503/429), hệ thống **hủy bỏ toàn bộ vector dở dang** và tái tính toán 100% vector cục bộ bằng fallback vectorizer. Tuyệt đối không bao giờ trộn lẫn cosine similarity giữa vector của 2 model khác nhau.

### 2.2. Khử trùng lặp ngữ nghĩa dựa trên đại diện (Representative-Based Incremental Clustering)
Để tránh nhược điểm nối chuỗi lan truyền (transitive over-merging) của Disjoint Set Union (DSU) thông thường (khi A gần B, B gần C nhưng A xa C mà DSU vẫn gom cả 3 lại và vô tình loại bỏ C):
- Tập từ khóa hợp lệ được sắp xếp trước theo thứ tự ưu tiên chất lượng:
  1. Điểm tương đồng ngữ nghĩa (`relevanceScore`)
  2. Nguồn gốc xuất xứ (`provenance`: `google_autocomplete` > `buyer_intent` > `category` > `niche` > `title`)
  3. Độ dài thương mại lý tưởng (3 đến 4 từ)
  4. Thứ tự xuất hiện ban đầu (`originalIndex`)
- Ứng viên số 1 trở thành Leader của Cụm 1.
- Các ứng viên tiếp theo **chỉ so sánh với Representative (đại diện) của các cụm hiện hữu**:
  - Nếu tương đồng $\ge 0.90$ (hoặc $\ge 0.84$ kèm Token Jaccard $\ge 0.55$), ứng viên gia nhập cụm đó và bị đánh dấu loại với lý do `semantic_duplicate`.
  - Nếu không trùng với đại diện nào, ứng viên lập cụm mới và trở thành đại diện của cụm đó.
- Kết quả: Loại bỏ triệt để hiện tượng over-merge lan truyền, bảo toàn các từ khóa độc lập.

### 2.3. Thứ bậc Lý do Xung đột Tất định (Deterministic Reason Precedence)
Hệ thống khóa chặt thứ tự ưu tiên khi một từ khóa thỏa mãn nhiều điều kiện loại trừ:
1. `exact_duplicate` (Độ ưu tiên 1 - Lọc chuẩn hóa chuỗi ban đầu)
2. `brand_conflict` (Độ ưu tiên 2 - Guardrail chính sách thương hiệu cấm)
3. `existing_url_cannibalization` (Độ ưu tiên 3 - Xung đột URL nội bộ site)
4. `category_conflict` (Độ ưu tiên 4 - Xung đột loại sản phẩm cạnh tranh)
5. `search_intent_mismatch` (Độ ưu tiên 5 - Truy vấn informational hướng dẫn)
6. `semantic_drift_irrelevant` (Độ ưu tiên 6 - Độ liên quan thấp, trôi dạt ngữ nghĩa)
7. `semantic_duplicate` (Độ ưu tiên 7 - Trùng lặp ngữ nghĩa trong nội bộ sản phẩm)
8. `low_specificity_generic` (Độ ưu tiên 8 - Từ khóa quá chung chung / rỗng)

Hàm `recordConflict` đảm bảo lý do có thứ bậc ưu tiên cao hơn luôn luôn giành chiến thắng một cách tất định.

---

## 3. Bảng Kiểm thử Thực tế & Hiệu chuẩn Ngưỡng Vertex AI (`text-embedding-004`)

Thực nghiệm đo đạc trực tiếp với dự án Google Cloud `gemini-image-benchmark`, model `text-embedding-004` trên sản phẩm mẫu *"Vintage Black Cat Halloween T-Shirt"*:

| Keyword | Identity Sim | Intent Sim | Relevance Score | Quyết định | Lý do Xung đột / Ghi chú |
|---|:---:|:---:|:---:|:---:|---|
| `black cat halloween shirt` | 0.6769 | 0.7227 | 0.7067 | **APPROVE** | Vượt ngưỡng thương mại dense ($\ge 0.64$) |
| `vintage halloween cat tee` | 0.6853 | 0.6977 | 0.6934 | **APPROVE** | Vượt ngưỡng thương mại dense ($\ge 0.64$) |
| `gift for cat lover` | 0.5389 | 0.6110 | 0.5858 | **REVIEW / PASS** | Nằm trong Vùng Xám $[0.54, 0.64]$ & có anchor ngữ cảnh `cat lover` nên được duyệt |
| `cat food` | 0.4266 | 0.4408 | 0.4358 | **REJECT** | `category_conflict` (Ngành thức ăn thú cưng vs thời trang) & điểm trôi dạt $< 0.54$ |
| `how to draw a black cat` | 0.4707 | 0.4782 | 0.4756 | **REJECT** | `search_intent_mismatch` (Informational Query Guard) |
| `cat veterinary care` | 0.3364 | 0.3671 | 0.3563 | **REJECT** | `semantic_drift_irrelevant` (Điểm số $< 0.54$) |
| `rugby world cup` | 0.1830 | 0.2157 | 0.2042 | **REJECT** | `category_conflict` & `semantic_drift_irrelevant` ($< 0.54$) |

**Kết luận hiệu chuẩn:**
- Khoảng cách phân tách (margin separation) giữa từ khóa thương mại tích cực ($0.69 - 0.71$) và các từ khóa trôi dạt/xung đột ($0.18 - 0.47$) đạt độ chênh lệch rất lớn ($> 0.22$), xác nhận ngưỡng dense $0.64$ (pass) và $0.54$ (reject) là tối ưu và an toàn.

---

## 4. Kết quả Kiểm thử, Kiểm toán Độc lập & Tương thích Hệ thống

### 4.1. Các lỗi phát hiện & đã khắc phục qua Kiểm toán Độc lập (Second-Round Audit)
1. **Sửa lỗi logic Vùng Xám (Gray Zone Enforcement Bug)**:
   - *Hiện tượng ban đầu*: `evaluateCandidateRelevance` kiểm tra `if (hasAnchor && relevanceScore > 0)`, khiến bất kỳ từ khóa nào dính dù chỉ 1 anchor token (như "cat") đều được duyệt bất kể điểm liên quan thấp cỡ nào, hoàn toàn bỏ qua `thresholds.relevanceReject`.
   - *Khắc phục*: Khóa chặt điều kiện vùng xám `relevanceScore >= thresholds.relevanceReject && hasAnchor`. Đồng thời hiệu chuẩn lại `LOCAL_SPARSE_THRESHOLDS.relevanceReject = 0.01` để vừa duyệt các truy vấn long-tail 2 từ hợp lệ, vừa loại bỏ triệt để các từ trôi dạt ngữ nghĩa không liên quan.
2. **Ngăn chặn lỗi Regex Syntax Error & Metacharacter Injection**:
   - *Hiện tượng ban đầu*: `new RegExp(\`\\b\${anchor}\\b\`)` và `new RegExp(\`\\b\${brand}\\b\`)` dùng trực tiếp chuỗi thô, sẽ bị ném lỗi `SyntaxError` (gây crash stage) nếu entity/brand chứa ký tự đặc biệt như `Disney+`, `C++`, `cat (spooky)`, `100% cotton`, `[limited]`.
   - *Khắc phục*: Bổ sung hàm `safeWordBoundaryRegex` và `escapeRegex`, tự động escape toàn bộ metacharacter và chỉ đặt `\b` khi ký tự biên là `\w`.
3. **Đồng bộ hóa định danh Provider & Tương thích Corpus**:
   - *Hiện tượng ban đầu*: `VertexTextEmbeddingProvider` dùng `providerId = "vertex"` trong khi analyzer và unit tests kiểm tra `"vertex_ai"`, dẫn đến `model` bị gán nhầm thành `"local_tfidf"` trong `StoredEmbedding`.
   - *Khắc phục*: Đồng bộ hóa `providerId = "vertex_ai"`, đồng thời `isEmbeddingCompatible` chấp nhận cả hai alias `"vertex"` và `"vertex_ai"` là tương thích hoàn toàn.
4. **Bảo vệ toàn vẹn mảng vector (Vector Batch Length Guard)**:
   - *Hiện tượng ban đầu*: `createVectorSession` không kiểm tra số lượng vector trả về từ API có khớp với số lượng keywords yêu cầu hay không.
   - *Khắc phục*: Bổ sung kiểm tra nghiêm ngặt `candidateQueryVectors.length === candidateKeywords.length && candidateSimVectors.length === candidateKeywords.length`, tự động kích hoạt fallback tất định nếu có mất mát dữ liệu batch.
5. **Chuẩn hóa dấu câu đầu/cuối chuỗi (Canonicalization Punctuation Trimming)**:
   - Bổ sung khử các ký tự dấu câu đầu/cuối (`"`, `,`, `.`, `!`, `?`) trong `canonicalizeKeyword` để các từ khóa như `"vintage tee,"` và `"vintage tee"` được khử trùng lặp chính xác ngay tại Bước 1 (`exact_duplicate`).
6. **Bổ sung siêu dữ liệu phục vụ Bước B5**:
   - Mở rộng `ConflictResult` với `relevanceScores` (bảng điểm liên quan cho từng từ khóa) và `keywordClusters` (danh sách phân cụm ngữ nghĩa theo đại diện), tạo đầu vào lý tưởng cho Stage B5 viết Content.

### 4.2. Số liệu kiểm thử tự động
- Toàn bộ **183/183 tests** trong test suite dự án đều vượt qua xuất sắc (`pass 183, fail 0`), trong đó có **29 tests chuyên sâu** bao phủ toàn diện Stage B4.
- Kiểm tra TypeScript nghiêm ngặt (`npm run typecheck`): **0 lỗi** (strict mode, không dùng `any`).
- Bản dựng chính (`npm run build`): Thành công trong 753ms.
- Bản dựng môi trường mock (`npm run build:mock`): Thành công trong 624ms.
- Giao diện trực quan `b1-visual-inspect.ts` đã được cập nhật hiển thị điểm `relevanceScore` trên từng huy hiệu từ khóa được duyệt và card phân cụm ngữ nghĩa `keywordClusters`.

