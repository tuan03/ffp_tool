# Báo Cáo Nghiệm Thu Bước B1: Product Understanding from Images

> **Module:** SEO + Content (`module-seo-content`)  
> **Giai đoạn:** Bước B1 — Phân tích sản phẩm từ hình ảnh (Vision & OCR)  
> **Người thực hiện (Worker):** Antigravity Coding Agent  
> **Người đánh giá (Reviewer / Planner):** ChatGPT Web Team  
> **Trạng thái:** **APPROVED / ACCEPTED (ĐÃ NGHIỆM THU CODE & KIẾN TRÚC)** ✅

---

## 1. Tổng quan mục tiêu Bước B1

Bước B1 chịu trách nhiệm phân tích một hoặc nhiều hình ảnh sản phẩm (URL từ xa, file local, Google Cloud Storage URI `gs://`, hoặc base64 data URI) để trích xuất các đặc trưng trực quan và ngữ nghĩa của sản phẩm:

- **OCR Texts (`ocrTexts`):** Văn bản/chữ in thực tế trên thiết kế sản phẩm (bảo tồn nguyên văn chữ hoa/thường, không hallucinate từ metadata).
- **Detected Entities (`detectedEntities`):** Các thực thể, họa tiết, biểu tượng, đối tượng trực quan chính xuất hiện trên sản phẩm.
- **Dominant Colors (`dominantColors`):** Các gam màu chủ đạo quan sát được.
- **Visual Style (`visualStyle`):** Phong cách thiết kế trực quan (ví dụ: vintage retro, minimalist, gothic, v.v.).
- **Product Category (`productCategory`):** Phân loại sản phẩm nhận diện được qua ảnh (ví dụ: t-shirt, hoodie, coffee mug, tote bag, v.v.).

Kết quả được tổng hợp thành cấu trúc bất biến `ProductUnderstanding` để cung cấp đầu vào ngữ cảnh cho các bước kế tiếp (B2 Context, B3 Search Suggestions, B5 SEO Content, B6 WebP & Alt).

---

## 2. Kiến trúc & Các thành phần đã triển khai

### 2.1. Phân định môi trường thực thi (Runtime Boundary)

- **Node.js Backend Workflow Engine:** Module `module-seo-content` được thiết kế hoạt động độc quyền trong **trusted Node.js runtime** (CLI automation, background worker, queue consumer, hoặc API server endpoint).
- **Phân tách hoàn toàn với Browser SPA:** Các API hệ thống (`node:fs`, `Buffer`, `process.env`) và Application Default Credentials (ADC) của Google Cloud chỉ được kích hoạt trong môi trường Node.js. Browser Vite SPA khi đóng gói (`npm run build`) hoàn toàn sạch, không bị rò rỉ credential hay xung đột bundling.

### 2.2. Chi tiết các module thành phần trong `src/modules/module-seo-content/internal/product-understanding/`

1. **`gemini-analysis-schema.ts` (Structured JSON Schema & Parser):**
   - Định nghĩa schema chuẩn `GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA` cho Gemini `responseSchema`.
   - `parseGeminiProductImageAnalysis`: Runtime validator nghiêm ngặt, enforce `additionalProperties: false` (loại bỏ mọi trường lạ), chuẩn hóa mảng rỗng, cắt khoảng trắng, giữ nguyên casing cho OCR, ném `GeminiSchemaValidationError` chi tiết khi payload không hợp lệ.

2. **`product-image-payload.ts` (Payload Preparation & Image Safety):**
   - Hỗ trợ 4 định dạng ảnh với thứ tự ưu tiên rõ ràng:
     - `localFilePath`: Đọc binary qua `node:fs`, kiểm tra trần dung lượng 10MB (`MAX_IMAGE_BYTES`), chuyển thành inlineData base64.
     - `gs://` URI: Kiểm tra extension file hợp lệ (`.jpg`, `.jpeg`, `.png`, `.webp`), từ chối URI không rõ extension để tránh sai lệch MIME type.
     - `data:image/` URI: Giải mã base64 và xác thực dung lượng thực tế $\le$ 10MB, chống tấn công memory exhaustion.
     - `http(s)://` URL: Tải qua fetch với `AbortController` timeout (15 giây), `clearTimeout` an toàn trong `finally`, từ chối ngay lập tức các `Content-Type` không phải ảnh (như `text/html`, `application/json`), kiểm tra trần 10MB trước khi chuyển sang inlineData.

3. **`gemini-content-generator.ts` (Transport Abstraction & Vertex AI SDK):**
   - Interface trừu tượng `GeminiContentGenerator` cho phép hoán đổi tầng giao tiếp mạng.
   - `FakeGeminiContentGenerator`: Test transport 100% deterministic hỗ trợ kiểm thử không cần mạng.
   - `GoogleGenAIVertexContentGenerator`: Tích hợp thư viện chính thức `@google/genai` với mode Vertex AI (`vertexai: true`, `project`, `location`) tự động sử dụng Application Default Credentials (ADC) tiêu chuẩn của Google Cloud.
   - Phân loại lỗi thông minh: Tự động nhận diện lỗi tạm thời (429 Rate Limit, 503 Unavailable, 502 Bad Gateway, Timeout) để retry, và không retry các lỗi 400 Bad Request, 401/403 Authentication/Permission.
   - Hỗ trợ Dependency Injection cho mock client adapter trong unit tests.

4. **`gemini-product-image-analyzer.ts` (Gemini Vision Analyzer):**
   - Triển khai `ProductImageAnalyzer`.
   - System instruction nghiêm ngặt chống ảo giác (Anti-Hallucination Invariant): Nghiêm cấm Gemini sử dụng title, description, niche hoặc metadata làm bằng chứng OCR nếu không thực sự xuất hiện trên hình ảnh.
   - Chính sách retry: Tối đa 1 lần retry cho lỗi tạm thời, ném lỗi ngay khi gặp lỗi xác thực hoặc lỗi vĩnh viễn.

5. **`fallback-product-image-analyzer.ts` (Resilience & Per-image Fallback):**
   - Áp dụng Decorator Pattern bọc quanh `primary` (Gemini) và `fallback` (Heuristic).
   - Cô lập lỗi trên từng ảnh: Một ảnh lỗi không làm hỏng các ảnh khác trong cùng sản phẩm.
   - Đảm bảo bất biến OCR khi fallback: Khi chuyển sang heuristic, `ocrTexts` luôn là mảng rỗng `[]` (tuyệt đối không đưa title/niche vào OCR).
   - Hỗ trợ hook quan sát `onFallback` phục vụ logging và monitoring.

6. **`b1-product-understanding.ts` (Pipeline Stage B1 Wiring):**
   - `createDefaultProductImageAnalyzer()`: Tự động nhận diện môi trường Node.js. Nếu có biến `GOOGLE_CLOUD_PROJECT`, kích hoạt `GeminiProductImageAnalyzer` bọc trong `FallbackProductImageAnalyzer` kèm log cảnh báo `console.warn` khi fallback. Nếu không có biến môi trường, sử dụng `HeuristicProductImageAnalyzer`.
   - `createB1ProductUnderstandingStage(dependencies?)`: Stage B1 của pipeline, bảo tồn trọn vẹn khả năng Dependency Injection.

7. **`scripts/b1-smoke-test.ts` (Manual Node Integration Script):**
   - Script chạy độc lập trên Node.js để kiểm thử luồng thực tế với Vertex AI ADC và hình ảnh sản phẩm thực.

---

## 3. Quá trình phối hợp và đánh giá từ ChatGPT (Reviewer)

### Vòng 1 Review:

ChatGPT đánh giá cao thiết kế hướng đối tượng và cấu trúc domain, nhưng chỉ ra 7 điểm cần hoàn thiện:

1. **[Blocker]** Cần dùng chính thức SDK `@google/genai` với Vertex ADC thay cho REST raw không xác thực.
2. **[Major]** HTTP image fetch cần có timeout an toàn (AbortController).
3. **[Major]** data URI base64 cần enforce trần dung lượng 10MB.
4. **[Major]** Kiểm tra Content-Type từ chối file HTML/JSON dù URL có đuôi ảnh.
5. **[Major]** Cơ chế fallback cần có log cảnh báo (observability).
6. **[Nice-to-have]** Schema runtime validator enforce `additionalProperties: false`.
7. **[Nice-to-have]** `gs://` URI không rõ đuôi không được mặc định là JPEG.

Worker đã khắc phục triệt để toàn bộ 7 điểm này và bổ sung 6 nhóm unit tests mới.

### Vòng 2 Review & Làm rõ Kiến trúc:

- ChatGPT băn khoăn về môi trường chạy (do FFP ban đầu là Vite SPA, sợ ADC không chạy được trên browser).
- Worker đã phản hồi làm rõ: Toàn bộ pipeline `runSeoContent()` là **Node.js backend workflow engine** (Option 2), chạy trên server/worker, browser chỉ gọi qua API. Đồng thời cung cấp log smoke test thực tế chứng minh `@google/genai` đã nạp ADC và fallback an toàn khi gặp `invalid_grant`.
- **Verdict chính thức từ ChatGPT:**

  ```text
  Final review status
  B1 Architecture               PASS ✅
  B1 ProductImageAnalyzer       PASS ✅
  B1 Gemini structured output   PASS ✅
  B1 OCR semantics              PASS ✅
  B1 image payload safety       PASS ✅
  B1 retry/error handling       PASS ✅
  B1 heuristic fallback         PASS ✅
  B1 observability              PASS ✅
  B1 aggregation semantics      PASS ✅
  B1 automated tests            PASS ✅
  B1 Node/server boundary       PASS ✅

  B1 CODE / IMPLEMENTATION      APPROVED ✅
  Live Gemini happy path        PENDING ADC refresh
  ```

  ChatGPT chính thức phê duyệt đóng phần phát triển của B1 để chuyển sang B2.

---

## 4. Kết quả kiểm thử & Xác minh kỹ thuật

Toàn bộ các lệnh kiểm thử bắt buộc đều được chạy mới và đạt 100%:

| Lệnh                 | Kết quả                | Chi tiết                                                                                             |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm test`           | **PASS (82/82 tests)** | Toàn bộ 28 tests chuyên sâu B1 + 54 tests của toàn bộ repo đều pass 100%.                            |
| `npm run typecheck`  | **PASS (0 lỗi)**       | TypeScript 5.7 ở chế độ `strict: true` không có bất kỳ cảnh báo hay lỗi kiểu nào (không dùng `any`). |
| `npm run build`      | **PASS (564ms)**       | Build production Vite client bundle thành công, không bị lỗi Node API.                               |
| `npm run build:mock` | **PASS (538ms)**       | Build mock mode hoàn thành nhanh chóng, đúng hợp đồng.                                               |

### Chi tiết 28 Unit Tests cho B1 (`gemini-product-image-analyzer.test.ts`):

1. _Schema: GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA has required structured fields_
2. _Schema: parses valid JSON, trims whitespace, removes empty items, preserves OCR casing_
3. _Schema: rejects invalid JSON or malformed schema structures_
4. _Schema Reviewer Fix: enforces additionalProperties: false and rejects unknown properties_
5. _Payload: prepares inlineData for local file using node:fs binary read_
6. _Payload: prepares fileData for gs:// URIs and data:image URIs_
7. _Payload Reviewer Fix: rejects gs:// URIs without recognized image extensions_
8. _Payload Reviewer Fix: rejects data:image URI exceeding 10MB decoded limit_
9. _Payload Reviewer Fix: rejects remote URL returning explicit non-image content-type (text/html)_
10. _Payload Reviewer Fix: fetch timeout triggers InvalidImagePayloadError_
11. _Payload: throws InvalidImagePayloadError on missing image, missing files, or unsupported formats_
12. _Reviewer Blocker Fix: GoogleGenAIVertexContentGenerator formats payload and calls GoogleGenAI with ADC parameters_
13. _Group A: Gemini Analyzer — successful structured extraction matching exact schema_
14. _Group B: OCR Semantics — never promotes title or description text into OCR when image has no text_
15. _Group C: Retry policy — retries once on retryable error (503/429) and succeeds_
16. _Group D: Non-retryable error (400/401/403) throws immediately without retrying_
17. _Group F & G: Fallback Analyzer — calls fallback on primary error (timeout/401/403) and preserves pipeline_
18. _Reviewer Fix: default production fallback logs observable warning on failure_
19. _Group H: Fallback OCR Invariant — when Gemini fails, fallback never hallucinates OCR from alt or filename_
20. _Group I: Partial Image Failure — per-image failure falls back gracefully while other images succeed in B1_
21. _Group J: Multi-image deterministic ranking preserved with Gemini analyzer results_
22. _Schema: strips markdown code fences (`json ... `) and parses structured JSON safely_
23. _Payload: parses multiline RFC-formatted data URI containing newlines_
24. _Gemini Analyzer: forwards configured timeoutMs to image fetch preparation_
25. _Builder: visualStyle 'unknown' or 'none' from Gemini falls back to textSignals.visualStyle_
26. _Builder: productCategory 'unspecified' or 'none' from Gemini falls back to textSignals.productCategory_
27. _Builder: deduplicates textSignals dominantColors and entities on fallback_
28. _Retry Policy: retries on 504 Gateway Timeout and DEADLINE_EXCEEDED_

---

## 5. Hướng dẫn vận hành Live Integration Smoke Test

Khi triển khai trên môi trường thật với Google Cloud credentials:

1. Đăng nhập ADC:
   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project gemini-image-benchmark
   ```
2. Thực thi smoke test:
   ```bash
   npx cross-env GOOGLE_CLOUD_PROJECT=gemini-image-benchmark tsx src/modules/module-seo-content/scripts/b1-smoke-test.ts
   ```
3. Kết quả mong đợi: Trả về kết quả trực tiếp từ Gemini Vision (không xuất hiện dòng `[SEO B1 Fallback]`).
