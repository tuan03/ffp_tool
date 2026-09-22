# BÃ¡o CÃ¡o Nghiá»‡m Thu BÆ°á»›c B1: Product Understanding from Images

> **Module:** SEO + Content (`seo-content`)  
> **Giai Ä‘oáº¡n:** BÆ°á»›c B1 â€” PhÃ¢n tÃ­ch sáº£n pháº©m tá»« hÃ¬nh áº£nh (Vision & OCR)  
> **NgÆ°á»i thá»±c hiá»‡n (Worker):** Antigravity Coding Agent  
> **NgÆ°á»i Ä‘Ã¡nh giÃ¡ (Reviewer / Planner):** ChatGPT Web Team  
> **Tráº¡ng thÃ¡i:** **APPROVED / ACCEPTED (ÄÃƒ NGHIá»†M THU CODE & KIáº¾N TRÃšC)** âœ…

---

## 1. Tá»•ng quan má»¥c tiÃªu BÆ°á»›c B1

BÆ°á»›c B1 chá»‹u trÃ¡ch nhiá»‡m phÃ¢n tÃ­ch má»™t hoáº·c nhiá»u hÃ¬nh áº£nh sáº£n pháº©m (URL tá»« xa, file local, Google Cloud Storage URI `gs://`, hoáº·c base64 data URI) Ä‘á»ƒ trÃ­ch xuáº¥t cÃ¡c Ä‘áº·c trÆ°ng trá»±c quan vÃ  ngá»¯ nghÄ©a cá»§a sáº£n pháº©m:

- **OCR Texts (`ocrTexts`):** VÄƒn báº£n/chá»¯ in thá»±c táº¿ trÃªn thiáº¿t káº¿ sáº£n pháº©m (báº£o tá»“n nguyÃªn vÄƒn chá»¯ hoa/thÆ°á»ng, khÃ´ng hallucinate tá»« metadata).
- **Detected Entities (`detectedEntities`):** CÃ¡c thá»±c thá»ƒ, há»a tiáº¿t, biá»ƒu tÆ°á»£ng, Ä‘á»‘i tÆ°á»£ng trá»±c quan chÃ­nh xuáº¥t hiá»‡n trÃªn sáº£n pháº©m.
- **Dominant Colors (`dominantColors`):** CÃ¡c gam mÃ u chá»§ Ä‘áº¡o quan sÃ¡t Ä‘Æ°á»£c.
- **Visual Style (`visualStyle`):** Phong cÃ¡ch thiáº¿t káº¿ trá»±c quan (vÃ­ dá»¥: vintage retro, minimalist, gothic, v.v.).
- **Product Category (`productCategory`):** PhÃ¢n loáº¡i sáº£n pháº©m nháº­n diá»‡n Ä‘Æ°á»£c qua áº£nh (vÃ­ dá»¥: t-shirt, hoodie, coffee mug, tote bag, v.v.).

Káº¿t quáº£ Ä‘Æ°á»£c tá»•ng há»£p thÃ nh cáº¥u trÃºc báº¥t biáº¿n `ProductUnderstanding` Ä‘á»ƒ cung cáº¥p Ä‘áº§u vÃ o ngá»¯ cáº£nh cho cÃ¡c bÆ°á»›c káº¿ tiáº¿p (B2 Context, B3 Search Suggestions, B5 SEO Content, B6 WebP & Alt).

---

## 2. Kiáº¿n trÃºc & CÃ¡c thÃ nh pháº§n Ä‘Ã£ triá»ƒn khai

### 2.1. PhÃ¢n Ä‘á»‹nh mÃ´i trÆ°á»ng thá»±c thi (Runtime Boundary)

- **Node.js Backend Workflow Engine:** Module `seo-content` Ä‘Æ°á»£c thiáº¿t káº¿ hoáº¡t Ä‘á»™ng Ä‘á»™c quyá»n trong **trusted Node.js runtime** (CLI automation, background worker, queue consumer, hoáº·c API server endpoint).
- **PhÃ¢n tÃ¡ch hoÃ n toÃ n vá»›i Browser SPA:** CÃ¡c API há»‡ thá»‘ng (`node:fs`, `Buffer`, `process.env`) vÃ  Application Default Credentials (ADC) cá»§a Google Cloud chá»‰ Ä‘Æ°á»£c kÃ­ch hoáº¡t trong mÃ´i trÆ°á»ng Node.js. Browser Vite SPA khi Ä‘Ã³ng gÃ³i (`npm run build`) hoÃ n toÃ n sáº¡ch, khÃ´ng bá»‹ rÃ² rá»‰ credential hay xung Ä‘á»™t bundling.

### 2.2. Chi tiáº¿t cÃ¡c module thÃ nh pháº§n trong `src/modules/seo-content/internal/product-understanding/`

1. **`gemini-analysis-schema.ts` (Structured JSON Schema & Parser):**
   - Äá»‹nh nghÄ©a schema chuáº©n `GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA` cho Gemini `responseSchema`.
   - `parseGeminiProductImageAnalysis`: Runtime validator nghiÃªm ngáº·t, enforce `additionalProperties: false` (loáº¡i bá» má»i trÆ°á»ng láº¡), chuáº©n hÃ³a máº£ng rá»—ng, cáº¯t khoáº£ng tráº¯ng, giá»¯ nguyÃªn casing cho OCR, nÃ©m `GeminiSchemaValidationError` chi tiáº¿t khi payload khÃ´ng há»£p lá»‡.

2. **`product-image-payload.ts` (Payload Preparation & Image Safety):**
   - Há»— trá»£ 4 Ä‘á»‹nh dáº¡ng áº£nh vá»›i thá»© tá»± Æ°u tiÃªn rÃµ rÃ ng:
     - `localFilePath`: Äá»c binary qua `node:fs`, kiá»ƒm tra tráº§n dung lÆ°á»£ng 10MB (`MAX_IMAGE_BYTES`), chuyá»ƒn thÃ nh inlineData base64.
     - `gs://` URI: Kiá»ƒm tra extension file há»£p lá»‡ (`.jpg`, `.jpeg`, `.png`, `.webp`), tá»« chá»‘i URI khÃ´ng rÃµ extension Ä‘á»ƒ trÃ¡nh sai lá»‡ch MIME type.
     - `data:image/` URI: Giáº£i mÃ£ base64 vÃ  xÃ¡c thá»±c dung lÆ°á»£ng thá»±c táº¿ $\le$ 10MB, chá»‘ng táº¥n cÃ´ng memory exhaustion.
     - `http(s)://` URL: Táº£i qua fetch vá»›i `AbortController` timeout (15 giÃ¢y), `clearTimeout` an toÃ n trong `finally`, tá»« chá»‘i ngay láº­p tá»©c cÃ¡c `Content-Type` khÃ´ng pháº£i áº£nh (nhÆ° `text/html`, `application/json`), kiá»ƒm tra tráº§n 10MB trÆ°á»›c khi chuyá»ƒn sang inlineData.

3. **`gemini-content-generator.ts` (Transport Abstraction & Vertex AI SDK):**
   - Interface trá»«u tÆ°á»£ng `GeminiContentGenerator` cho phÃ©p hoÃ¡n Ä‘á»•i táº§ng giao tiáº¿p máº¡ng.
   - `FakeGeminiContentGenerator`: Test transport 100% deterministic há»— trá»£ kiá»ƒm thá»­ khÃ´ng cáº§n máº¡ng.
   - `GoogleGenAIVertexContentGenerator`: TÃ­ch há»£p thÆ° viá»‡n chÃ­nh thá»©c `@google/genai` vá»›i mode Vertex AI (`vertexai: true`, `project`, `location`) tá»± Ä‘á»™ng sá»­ dá»¥ng Application Default Credentials (ADC) tiÃªu chuáº©n cá»§a Google Cloud.
   - PhÃ¢n loáº¡i lá»—i thÃ´ng minh: Tá»± Ä‘á»™ng nháº­n diá»‡n lá»—i táº¡m thá»i (429 Rate Limit, 503 Unavailable, 502 Bad Gateway, Timeout) Ä‘á»ƒ retry, vÃ  khÃ´ng retry cÃ¡c lá»—i 400 Bad Request, 401/403 Authentication/Permission.
   - Há»— trá»£ Dependency Injection cho mock client adapter trong unit tests.

4. **`gemini-product-image-analyzer.ts` (Gemini Vision Analyzer):**
   - Triá»ƒn khai `ProductImageAnalyzer`.
   - System instruction nghiÃªm ngáº·t chá»‘ng áº£o giÃ¡c (Anti-Hallucination Invariant): NghiÃªm cáº¥m Gemini sá»­ dá»¥ng title, description, niche hoáº·c metadata lÃ m báº±ng chá»©ng OCR náº¿u khÃ´ng thá»±c sá»± xuáº¥t hiá»‡n trÃªn hÃ¬nh áº£nh.
   - ChÃ­nh sÃ¡ch retry: Tá»‘i Ä‘a 1 láº§n retry cho lá»—i táº¡m thá»i, nÃ©m lá»—i ngay khi gáº·p lá»—i xÃ¡c thá»±c hoáº·c lá»—i vÄ©nh viá»…n.

5. **`fallback-product-image-analyzer.ts` (Resilience & Per-image Fallback):**
   - Ãp dá»¥ng Decorator Pattern bá»c quanh `primary` (Gemini) vÃ  `fallback` (Heuristic).
   - CÃ´ láº­p lá»—i trÃªn tá»«ng áº£nh: Má»™t áº£nh lá»—i khÃ´ng lÃ m há»ng cÃ¡c áº£nh khÃ¡c trong cÃ¹ng sáº£n pháº©m.
   - Äáº£m báº£o báº¥t biáº¿n OCR khi fallback: Khi chuyá»ƒn sang heuristic, `ocrTexts` luÃ´n lÃ  máº£ng rá»—ng `[]` (tuyá»‡t Ä‘á»‘i khÃ´ng Ä‘Æ°a title/niche vÃ o OCR).
   - Há»— trá»£ hook quan sÃ¡t `onFallback` phá»¥c vá»¥ logging vÃ  monitoring.

6. **`b1-product-understanding.ts` (Pipeline Stage B1 Wiring):**
   - `createDefaultProductImageAnalyzer()`: Tá»± Ä‘á»™ng nháº­n diá»‡n mÃ´i trÆ°á»ng Node.js. Náº¿u cÃ³ biáº¿n `GOOGLE_CLOUD_PROJECT`, kÃ­ch hoáº¡t `GeminiProductImageAnalyzer` bá»c trong `FallbackProductImageAnalyzer` kÃ¨m log cáº£nh bÃ¡o `console.warn` khi fallback. Náº¿u khÃ´ng cÃ³ biáº¿n mÃ´i trÆ°á»ng, sá»­ dá»¥ng `HeuristicProductImageAnalyzer`.
   - `createB1ProductUnderstandingStage(dependencies?)`: Stage B1 cá»§a pipeline, báº£o tá»“n trá»n váº¹n kháº£ nÄƒng Dependency Injection.

7. **`scripts/b1-smoke-test.ts` (Manual Node Integration Script):**
   - Script cháº¡y Ä‘á»™c láº­p trÃªn Node.js Ä‘á»ƒ kiá»ƒm thá»­ luá»“ng thá»±c táº¿ vá»›i Vertex AI ADC vÃ  hÃ¬nh áº£nh sáº£n pháº©m thá»±c.

---

## 3. QuÃ¡ trÃ¬nh phá»‘i há»£p vÃ  Ä‘Ã¡nh giÃ¡ tá»« ChatGPT (Reviewer)

### VÃ²ng 1 Review:

ChatGPT Ä‘Ã¡nh giÃ¡ cao thiáº¿t káº¿ hÆ°á»›ng Ä‘á»‘i tÆ°á»£ng vÃ  cáº¥u trÃºc domain, nhÆ°ng chá»‰ ra 7 Ä‘iá»ƒm cáº§n hoÃ n thiá»‡n:

1. **[Blocker]** Cáº§n dÃ¹ng chÃ­nh thá»©c SDK `@google/genai` vá»›i Vertex ADC thay cho REST raw khÃ´ng xÃ¡c thá»±c.
2. **[Major]** HTTP image fetch cáº§n cÃ³ timeout an toÃ n (AbortController).
3. **[Major]** data URI base64 cáº§n enforce tráº§n dung lÆ°á»£ng 10MB.
4. **[Major]** Kiá»ƒm tra Content-Type tá»« chá»‘i file HTML/JSON dÃ¹ URL cÃ³ Ä‘uÃ´i áº£nh.
5. **[Major]** CÆ¡ cháº¿ fallback cáº§n cÃ³ log cáº£nh bÃ¡o (observability).
6. **[Nice-to-have]** Schema runtime validator enforce `additionalProperties: false`.
7. **[Nice-to-have]** `gs://` URI khÃ´ng rÃµ Ä‘uÃ´i khÃ´ng Ä‘Æ°á»£c máº·c Ä‘á»‹nh lÃ  JPEG.

Worker Ä‘Ã£ kháº¯c phá»¥c triá»‡t Ä‘á»ƒ toÃ n bá»™ 7 Ä‘iá»ƒm nÃ y vÃ  bá»• sung 6 nhÃ³m unit tests má»›i.

### VÃ²ng 2 Review & LÃ m rÃµ Kiáº¿n trÃºc:

- ChatGPT bÄƒn khoÄƒn vá» mÃ´i trÆ°á»ng cháº¡y (do FFP ban Ä‘áº§u lÃ  Vite SPA, sá»£ ADC khÃ´ng cháº¡y Ä‘Æ°á»£c trÃªn browser).
- Worker Ä‘Ã£ pháº£n há»“i lÃ m rÃµ: ToÃ n bá»™ pipeline `runSeoContent()` lÃ  **Node.js backend workflow engine** (Option 2), cháº¡y trÃªn server/worker, browser chá»‰ gá»i qua API. Äá»“ng thá»i cung cáº¥p log smoke test thá»±c táº¿ chá»©ng minh `@google/genai` Ä‘Ã£ náº¡p ADC vÃ  fallback an toÃ n khi gáº·p `invalid_grant`.
- **Verdict chÃ­nh thá»©c tá»« ChatGPT:**

  ```text
  Final review status
  B1 Architecture               PASS âœ…
  B1 ProductImageAnalyzer       PASS âœ…
  B1 Gemini structured output   PASS âœ…
  B1 OCR semantics              PASS âœ…
  B1 image payload safety       PASS âœ…
  B1 retry/error handling       PASS âœ…
  B1 heuristic fallback         PASS âœ…
  B1 observability              PASS âœ…
  B1 aggregation semantics      PASS âœ…
  B1 automated tests            PASS âœ…
  B1 Node/server boundary       PASS âœ…

  B1 CODE / IMPLEMENTATION      APPROVED âœ…
  Live Gemini happy path        PENDING ADC refresh
  ```

  ChatGPT chÃ­nh thá»©c phÃª duyá»‡t Ä‘Ã³ng pháº§n phÃ¡t triá»ƒn cá»§a B1 Ä‘á»ƒ chuyá»ƒn sang B2.

---

## 4. Káº¿t quáº£ kiá»ƒm thá»­ & XÃ¡c minh ká»¹ thuáº­t

ToÃ n bá»™ cÃ¡c lá»‡nh kiá»ƒm thá»­ báº¯t buá»™c Ä‘á»u Ä‘Æ°á»£c cháº¡y má»›i vÃ  Ä‘áº¡t 100%:

| Lá»‡nh                 | Káº¿t quáº£                | Chi tiáº¿t                                                                                             |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm test`           | **PASS (82/82 tests)** | ToÃ n bá»™ 28 tests chuyÃªn sÃ¢u B1 + 54 tests cá»§a toÃ n bá»™ repo Ä‘á»u pass 100%.                            |
| `npm run typecheck`  | **PASS (0 lá»—i)**       | TypeScript 5.7 á»Ÿ cháº¿ Ä‘á»™ `strict: true` khÃ´ng cÃ³ báº¥t ká»³ cáº£nh bÃ¡o hay lá»—i kiá»ƒu nÃ o (khÃ´ng dÃ¹ng `any`). |
| `npm run build`      | **PASS (564ms)**       | Build production Vite client bundle thÃ nh cÃ´ng, khÃ´ng bá»‹ lá»—i Node API.                               |
| `npm run build:mock` | **PASS (538ms)**       | Build mock mode hoÃ n thÃ nh nhanh chÃ³ng, Ä‘Ãºng há»£p Ä‘á»“ng.                                               |

### Chi tiáº¿t 28 Unit Tests cho B1 (`gemini-product-image-analyzer.test.ts`):

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
13. _Group A: Gemini Analyzer â€” successful structured extraction matching exact schema_
14. _Group B: OCR Semantics â€” never promotes title or description text into OCR when image has no text_
15. _Group C: Retry policy â€” retries once on retryable error (503/429) and succeeds_
16. _Group D: Non-retryable error (400/401/403) throws immediately without retrying_
17. _Group F & G: Fallback Analyzer â€” calls fallback on primary error (timeout/401/403) and preserves pipeline_
18. _Reviewer Fix: default production fallback logs observable warning on failure_
19. _Group H: Fallback OCR Invariant â€” when Gemini fails, fallback never hallucinates OCR from alt or filename_
20. _Group I: Partial Image Failure â€” per-image failure falls back gracefully while other images succeed in B1_
21. _Group J: Multi-image deterministic ranking preserved with Gemini analyzer results_
22. _Schema: strips markdown code fences (`json ... `) and parses structured JSON safely_
23. _Payload: parses multiline RFC-formatted data URI containing newlines_
24. _Gemini Analyzer: forwards configured timeoutMs to image fetch preparation_
25. _Builder: visualStyle 'unknown' or 'none' from Gemini falls back to textSignals.visualStyle_
26. _Builder: productCategory 'unspecified' or 'none' from Gemini falls back to textSignals.productCategory_
27. _Builder: deduplicates textSignals dominantColors and entities on fallback_
28. _Retry Policy: retries on 504 Gateway Timeout and DEADLINE_EXCEEDED_

---

## 5. HÆ°á»›ng dáº«n váº­n hÃ nh Live Integration Smoke Test

Khi triá»ƒn khai trÃªn mÃ´i trÆ°á»ng tháº­t vá»›i Google Cloud credentials:

1. ÄÄƒng nháº­p ADC:
   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project gemini-image-benchmark
   ```
2. Thá»±c thi smoke test:
   ```bash
   npx cross-env GOOGLE_CLOUD_PROJECT=gemini-image-benchmark tsx src/modules/seo-content/scripts/b1-smoke-test.ts
   ```
3. Káº¿t quáº£ mong Ä‘á»£i: Tráº£ vá» káº¿t quáº£ trá»±c tiáº¿p tá»« Gemini Vision (khÃ´ng xuáº¥t hiá»‡n dÃ²ng `[SEO B1 Fallback]`).

