# Báo cáo Triển khai Stage B5: SEO Content Generation (Phân loại & Tạo nội dung SEO)

## 1. Giới thiệu tổng quan

Stage B5 trong pipeline SEO Content chịu trách nhiệm nhận dữ liệu sau khi đã sàng lọc và giải quyết xung đột từ B4 (approved keywords, relevance scores, keyword clusters), kết hợp cùng hiểu biết sâu về sản phẩm ở B1 (entities, visualStyle, colors, category, OCR) và bối cảnh mua sắm ở B2 (targetAudience, occasions, useCases), từ đó tạo ra bộ nội dung SEO hoàn chỉnh:

- **`productTitle`**: Tiêu đề sản phẩm on-page, tôn trọng danh tính sản phẩm theo chính sách Preserve -> Enrich -> Rebuild.
- **`productDescription`**: Nội dung mô tả sản phẩm bằng HTML ngữ nghĩa chuẩn e-commerce (`<p>`, `<ul>`, `<li>`, `<strong>`), cấu trúc chặt chẽ (Intro -> Key Feature Bullets -> Guidance -> Closing), chống hoàn toàn XSS và prompt injection.
- **`productSeoTitle`**: Tiêu đề SEO meta tag tối ưu cho SERP (chiều dài tối đa 70 ký tự, tích hợp từ khóa chính một cách tự nhiên).
- **`productSeoDescription`**: Mô tả SEO meta description chuẩn (chiều dài tối đa 160 ký tự, tóm tắt hấp dẫn không cắt vụn từ).
- **`productHandle`**: URL slug tối ưu SEO (kebab-case, chuẩn hóa tiếng Việt không dấu, giữ nguyên handle sẵn có theo chính sách Shopify).

---

## 2. Kiến trúc 4 tầng (4-Layer Content Generation Engine)

Theo thiết kế đã được ChatGPT Web và Leader phê duyệt, Stage B5 được cấu trúc thành 4 lớp rõ ràng:

### 2.1. Lớp 1: Factual Grounding & Evidence Hierarchy

- **`ContentFactSheet`**: Thu thập toàn bộ sự thật về sản phẩm từ nguồn tin cậy (`HIGH`: title, description, category, OCR, visible entities; `MEDIUM`: visualStyle, niche; `CONTEXTUAL ONLY`: audience, occasions, useCases).
- **Bảo vệ Personalization**: Sử dụng hàm tất định `detectPersonalizationEvidence()` để rà soát bằng chứng cá nhân hóa. Nếu không có bằng chứng, AI tuyệt đối bị cấm sinh các tuyên bố như "personalized", "custom name", "upload your photo".
- **Claim Guard**: Rà soát các thuộc tính nhạy cảm (`genuine leather`, `waterproof`, `handmade`, `100% cotton`, `lifetime warranty`, `free shipping`, numeric claims). Nếu không có bằng chứng trong factual source, nội dung bị từ chối ngay lập tức.

### 2.2. Lớp 2: Keyword Allocation & Surface Policy

- **`allocateKeywords`**: Phân bổ từ khóa đã được B4 duyệt thành 3 tầng:
  - **Primary Keyword**: 1 từ khóa chính đại diện cho category và intent thương mại mạnh nhất, loại bỏ các từ khóa unsafe trên title (như "cheap", "sale", "amazon", "discount").
  - **Secondary Keywords**: Tối đa 3-4 từ khóa bổ trợ, phân hóa theo cụm cluster nhằm chống hiện tượng keyword stuffing.
  - **Supporting Keywords & Framing Concepts**: Tách biệt rõ ràng giữa từ khóa SEO thực sự đưa vào `targetedKeywords` và các khái niệm ngữ cảnh chỉ dùng để viết văn (không đăng ký vào catalog corpus).

### 2.3. Lớp 3: Content Generation & Dual-Engine Strategy

- **`GeminiSeoContentGenerator`**: Tích hợp Gemini 2.5 Flash qua Vertex AI ADC (`@google/genai`). Prompt được bao bọc trong ranh giới bảo vệ `<UNTRUSTED_PRODUCT_DATA>` chống prompt injection. Output bắt buộc tuân theo cấu trúc JSON Schema chặt chẽ.
- **`HeuristicContentGenerator`**: Động cơ copywriting dự phòng chạy offline 100%, không cần kết nối mạng. Sinh ra nội dung bán hàng mượt mà, đầy đủ các trường dữ liệu và tuân thủ tuyệt đối các ràng buộc SEO.
- **`FallbackContentGenerator`**: Decorator điều phối tự động: Nếu Gemini gặp lỗi mạng, lỗi schema hoặc vi phạm claim guard, hệ thống tự động fallback mượt sang Heuristic generator mà không làm đứt gãy pipeline.

### 2.4. Lớp 4: Validation & Deterministic Finalization

- **`validateDraft`**: Kiểm tra cấu trúc JSON, định dạng bullet, guidance và tính hợp lệ ban đầu.
- **`fitSeoTitle` & `fitSeoDescription`**: Cắt gọt thông minh theo ranh giới từ/câu, tuyệt đối không dùng `slice(0, 70)` cắt giữa chừng từ ngữ.
- **`buildHeuristicProductTitle`**: Áp dụng chính sách Preserve -> Enrich -> Rebuild:
  - Nếu source title đã tốt và đã chứa primary concept -> giữ nguyên.
  - Nếu source title tốt nhưng thiếu differentiator từ primary -> hợp nhất khéo léo.
  - Nếu source title là placeholder/SKU -> tái xây dựng từ primary grounded + fact sheet.
  - Rà soát `isKeywordGroundedForPrimarySurface` để không bao giờ tiêm các modifier thiếu căn cứ (ví dụ "distressed") lên bề mặt title.
- **`formatProductDescriptionHtml`**: Mã hóa ký tự đặc biệt (`escapeHtml`), đảm bảo chỉ xuất các tag an toàn trong whitelist (`<p>`, `<ul>`, `<li>`, `<strong>`), ngăn ngừa triệt để lỗ hổng XSS.
- **`generateProductHandle`**: Chuyển đổi thành slug URL kebab-case sạch, xử lý ký tự tiếng Việt (đ/Đ -> d), giữ nguyên handle hiện hữu nếu có.

---

## 3. Danh sách Tệp triển khai & Vai trò

| Tệp                                   | Vị trí                         | Vai trò                                                                    |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `domain-types.ts`                     | `internal/`                    | Bổ sung `ContentGenerationMetadata` và tích hợp vào `SeoPipelineContext`   |
| `content-generation-types.ts`         | `internal/content-generation/` | Định nghĩa FactSheet, KeywordAllocation, Draft, Constraints, Custom Errors |
| `content-fact-sheet.ts`               | `internal/content-generation/` | Trích xuất sự thật sản phẩm và nhận diện bằng chứng cá nhân hóa            |
| `keyword-allocator.ts`                | `internal/content-generation/` | Phân tầng từ khóa chính, phụ, hỗ trợ; lọc surface unsafe                   |
| `heuristic-title-builder.ts`          | `internal/content-generation/` | Xây dựng tiêu đề sản phẩm theo chính sách Preserve -> Enrich -> Rebuild    |
| `heuristic-content-generator.ts`      | `internal/content-generation/` | Trình tạo nội dung tất định, offline, zero-network                         |
| `gemini-content-generation-schema.ts` | `internal/content-generation/` | Định nghĩa JSON Schema cấu trúc draft cho Gemini 2.5 Flash                 |
| `gemini-content-generator.ts`         | `internal/content-generation/` | Tích hợp Vertex AI ADC gọi Gemini với prompt injection defense             |
| `fallback-content-generator.ts`       | `internal/content-generation/` | Decorator fallback an toàn từ Gemini sang Heuristic                        |
| `html-description-formatter.ts`       | `internal/content-generation/` | Format HTML mô tả sản phẩm với whitelist tag và XSS defense                |
| `claim-guard.ts`                      | `internal/content-generation/` | Phát hiện vi phạm tuyên bố chất liệu, bảo hành, thông số không có thực     |
| `content-fitters.ts`                  | `internal/content-generation/` | Cắt gọt SEO Title (<=70) và Meta Description (<=160) theo ranh giới từ     |
| `content-result-validator.ts`         | `internal/content-generation/` | Kiểm thử tính hợp lệ 2 tầng (Draft Validator & Final Validator)            |
| `slug-utils.ts`                       | `internal/content-generation/` | Chuẩn hóa slug URL kebab-case, chuyển đổi tiếng Việt, quản lý handle       |
| `b5-content-generation.ts`            | `internal/stages/`             | Stage runner tích hợp toàn bộ luồng B5 vào SEO Pipeline                    |

---

## 4. Kết quả Kiểm thử & Nghiệm thu

Toàn bộ 230/230 test trong repository đều vượt qua (100% PASS):

- `b5-keyword-allocation.test.ts`: 5/5 tests PASS (chọn primary, loại discarded, cluster diversity, tách framing concepts).
- `b5-content-validation.test.ts`: 4/4 tests PASS (slug unicode tiếng Việt, XSS escaping, length fitters, claim guard).
- `b5-content-generation.test.ts`: 9/9 tests PASS (deterministic heuristic, sparse product, prompt injection defense, fallback decorator, 5 test cases cho title policy Preserve->Enrich->Rebuild và ungrounded modifier defense).
- `b5-content-generation-integration.test.ts`: 2/2 tests PASS (pipeline end-to-end qua B5 với định dạng HTML và SEO limits).
- `pipeline.test.ts`: 17/17 tests PASS (thứ tự stage, immutability, recovery, context propagation).
- `service.test.ts`: 10/10 tests PASS (public contract output, whitespace/empty handle safety, mock runner parity).

Lệnh kiểm tra:

```bash
npm test         # 230 tests pass
npm run typecheck # 0 errors
npm run build    # build production thành công
npm run build:mock # build mock thành công
```
