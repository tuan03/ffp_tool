# BÃ¡o cÃ¡o Triá»ƒn khai Stage B5: SEO Content Generation (PhÃ¢n loáº¡i & Táº¡o ná»™i dung SEO)

## 1. Giá»›i thiá»‡u tá»•ng quan

Stage B5 trong pipeline SEO Content chá»‹u trÃ¡ch nhiá»‡m nháº­n dá»¯ liá»‡u sau khi Ä‘Ã£ sÃ ng lá»c vÃ  giáº£i quyáº¿t xung Ä‘á»™t tá»« B4 (approved keywords, relevance scores, keyword clusters), káº¿t há»£p cÃ¹ng hiá»ƒu biáº¿t sÃ¢u vá» sáº£n pháº©m á»Ÿ B1 (entities, visualStyle, colors, category, OCR) vÃ  bá»‘i cáº£nh mua sáº¯m á»Ÿ B2 (targetAudience, occasions, useCases), tá»« Ä‘Ã³ táº¡o ra bá»™ ná»™i dung SEO hoÃ n chá»‰nh:

- **`productTitle`**: TiÃªu Ä‘á» sáº£n pháº©m on-page, tÃ´n trá»ng danh tÃ­nh sáº£n pháº©m theo chÃ­nh sÃ¡ch Preserve -> Enrich -> Rebuild.
- **`productDescription`**: Ná»™i dung mÃ´ táº£ sáº£n pháº©m báº±ng HTML ngá»¯ nghÄ©a chuáº©n e-commerce (`<p>`, `<ul>`, `<li>`, `<strong>`), cáº¥u trÃºc cháº·t cháº½ (Intro -> Key Feature Bullets -> Guidance -> Closing), chá»‘ng hoÃ n toÃ n XSS vÃ  prompt injection.
- **`productSeoTitle`**: TiÃªu Ä‘á» SEO meta tag tá»‘i Æ°u cho SERP (chiá»u dÃ i tá»‘i Ä‘a 70 kÃ½ tá»±, tÃ­ch há»£p tá»« khÃ³a chÃ­nh má»™t cÃ¡ch tá»± nhiÃªn).
- **`productSeoDescription`**: MÃ´ táº£ SEO meta description chuáº©n (chiá»u dÃ i tá»‘i Ä‘a 160 kÃ½ tá»±, tÃ³m táº¯t háº¥p dáº«n khÃ´ng cáº¯t vá»¥n tá»«).
- **`productHandle`**: URL slug tá»‘i Æ°u SEO (kebab-case, chuáº©n hÃ³a tiáº¿ng Viá»‡t khÃ´ng dáº¥u, giá»¯ nguyÃªn handle sáºµn cÃ³ theo chÃ­nh sÃ¡ch Shopify).

---

## 2. Kiáº¿n trÃºc 4 táº§ng (4-Layer Content Generation Engine)

Theo thiáº¿t káº¿ Ä‘Ã£ Ä‘Æ°á»£c ChatGPT Web vÃ  Leader phÃª duyá»‡t, Stage B5 Ä‘Æ°á»£c cáº¥u trÃºc thÃ nh 4 lá»›p rÃµ rÃ ng:

### 2.1. Lá»›p 1: Factual Grounding & Evidence Hierarchy

- **`ContentFactSheet`**: Thu tháº­p toÃ n bá»™ sá»± tháº­t vá» sáº£n pháº©m tá»« nguá»“n tin cáº­y (`HIGH`: title, description, category, OCR, visible entities; `MEDIUM`: visualStyle, niche; `CONTEXTUAL ONLY`: audience, occasions, useCases).
- **Báº£o vá»‡ Personalization**: Sá»­ dá»¥ng hÃ m táº¥t Ä‘á»‹nh `detectPersonalizationEvidence()` Ä‘á»ƒ rÃ  soÃ¡t báº±ng chá»©ng cÃ¡ nhÃ¢n hÃ³a. Náº¿u khÃ´ng cÃ³ báº±ng chá»©ng, AI tuyá»‡t Ä‘á»‘i bá»‹ cáº¥m sinh cÃ¡c tuyÃªn bá»‘ nhÆ° "personalized", "custom name", "upload your photo".
- **Claim Guard**: RÃ  soÃ¡t cÃ¡c thuá»™c tÃ­nh nháº¡y cáº£m (`genuine leather`, `waterproof`, `handmade`, `100% cotton`, `lifetime warranty`, `free shipping`, numeric claims). Náº¿u khÃ´ng cÃ³ báº±ng chá»©ng trong factual source, ná»™i dung bá»‹ tá»« chá»‘i ngay láº­p tá»©c.

### 2.2. Lá»›p 2: Keyword Allocation & Surface Policy

- **`allocateKeywords`**: PhÃ¢n bá»• tá»« khÃ³a Ä‘Ã£ Ä‘Æ°á»£c B4 duyá»‡t thÃ nh 3 táº§ng:
  - **Primary Keyword**: 1 tá»« khÃ³a chÃ­nh Ä‘áº¡i diá»‡n cho category vÃ  intent thÆ°Æ¡ng máº¡i máº¡nh nháº¥t, loáº¡i bá» cÃ¡c tá»« khÃ³a unsafe trÃªn title (nhÆ° "cheap", "sale", "amazon", "discount").
  - **Secondary Keywords**: Tá»‘i Ä‘a 3-4 tá»« khÃ³a bá»• trá»£, phÃ¢n hÃ³a theo cá»¥m cluster nháº±m chá»‘ng hiá»‡n tÆ°á»£ng keyword stuffing.
  - **Supporting Keywords & Framing Concepts**: TÃ¡ch biá»‡t rÃµ rÃ ng giá»¯a tá»« khÃ³a SEO thá»±c sá»± Ä‘Æ°a vÃ o `targetedKeywords` vÃ  cÃ¡c khÃ¡i niá»‡m ngá»¯ cáº£nh chá»‰ dÃ¹ng Ä‘á»ƒ viáº¿t vÄƒn (khÃ´ng Ä‘Äƒng kÃ½ vÃ o catalog corpus).

### 2.3. Lá»›p 3: Content Generation & Dual-Engine Strategy

- **`GeminiSeoContentGenerator`**: TÃ­ch há»£p Gemini 2.5 Flash qua Vertex AI ADC (`@google/genai`). Prompt Ä‘Æ°á»£c bao bá»c trong ranh giá»›i báº£o vá»‡ `<UNTRUSTED_PRODUCT_DATA>` chá»‘ng prompt injection. Output báº¯t buá»™c tuÃ¢n theo cáº¥u trÃºc JSON Schema cháº·t cháº½.
- **`HeuristicContentGenerator`**: Äá»™ng cÆ¡ copywriting dá»± phÃ²ng cháº¡y offline 100%, khÃ´ng cáº§n káº¿t ná»‘i máº¡ng. Sinh ra ná»™i dung bÃ¡n hÃ ng mÆ°á»£t mÃ , Ä‘áº§y Ä‘á»§ cÃ¡c trÆ°á»ng dá»¯ liá»‡u vÃ  tuÃ¢n thá»§ tuyá»‡t Ä‘á»‘i cÃ¡c rÃ ng buá»™c SEO.
- **`FallbackContentGenerator`**: Decorator Ä‘iá»u phá»‘i tá»± Ä‘á»™ng: Náº¿u Gemini gáº·p lá»—i máº¡ng, lá»—i schema hoáº·c vi pháº¡m claim guard, há»‡ thá»‘ng tá»± Ä‘á»™ng fallback mÆ°á»£t sang Heuristic generator mÃ  khÃ´ng lÃ m Ä‘á»©t gÃ£y pipeline.

### 2.4. Lá»›p 4: Validation & Deterministic Finalization

- **`validateDraft`**: Kiá»ƒm tra cáº¥u trÃºc JSON, Ä‘á»‹nh dáº¡ng bullet, guidance vÃ  tÃ­nh há»£p lá»‡ ban Ä‘áº§u.
- **`fitSeoTitle` & `fitSeoDescription`**: Cáº¯t gá»t thÃ´ng minh theo ranh giá»›i tá»«/cÃ¢u, tuyá»‡t Ä‘á»‘i khÃ´ng dÃ¹ng `slice(0, 70)` cáº¯t giá»¯a chá»«ng tá»« ngá»¯.
- **`buildHeuristicProductTitle`**: Ãp dá»¥ng chÃ­nh sÃ¡ch Preserve -> Enrich -> Rebuild:
  - Náº¿u source title Ä‘Ã£ tá»‘t vÃ  Ä‘Ã£ chá»©a primary concept -> giá»¯ nguyÃªn.
  - Náº¿u source title tá»‘t nhÆ°ng thiáº¿u differentiator tá»« primary -> há»£p nháº¥t khÃ©o lÃ©o.
  - Náº¿u source title lÃ  placeholder/SKU -> tÃ¡i xÃ¢y dá»±ng tá»« primary grounded + fact sheet.
  - RÃ  soÃ¡t `isKeywordGroundedForPrimarySurface` Ä‘á»ƒ khÃ´ng bao giá» tiÃªm cÃ¡c modifier thiáº¿u cÄƒn cá»© (vÃ­ dá»¥ "distressed") lÃªn bá» máº·t title.
- **`formatProductDescriptionHtml`**: MÃ£ hÃ³a kÃ½ tá»± Ä‘áº·c biá»‡t (`escapeHtml`), Ä‘áº£m báº£o chá»‰ xuáº¥t cÃ¡c tag an toÃ n trong whitelist (`<p>`, `<ul>`, `<li>`, `<strong>`), ngÄƒn ngá»«a triá»‡t Ä‘á»ƒ lá»— há»•ng XSS.
- **`generateProductHandle`**: Chuyá»ƒn Ä‘á»•i thÃ nh slug URL kebab-case sáº¡ch, xá»­ lÃ½ kÃ½ tá»± tiáº¿ng Viá»‡t (Ä‘/Ä -> d), giá»¯ nguyÃªn handle hiá»‡n há»¯u náº¿u cÃ³.

---

## 3. Danh sÃ¡ch Tá»‡p triá»ƒn khai & Vai trÃ²

| Tá»‡p                                   | Vá»‹ trÃ­                         | Vai trÃ²                                                                    |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `domain-types.ts`                     | `internal/`                    | Bá»• sung `ContentGenerationMetadata` vÃ  tÃ­ch há»£p vÃ o `SeoPipelineContext`   |
| `content-generation-types.ts`         | `internal/content-generation/` | Äá»‹nh nghÄ©a FactSheet, KeywordAllocation, Draft, Constraints, Custom Errors |
| `content-fact-sheet.ts`               | `internal/content-generation/` | TrÃ­ch xuáº¥t sá»± tháº­t sáº£n pháº©m vÃ  nháº­n diá»‡n báº±ng chá»©ng cÃ¡ nhÃ¢n hÃ³a            |
| `keyword-allocator.ts`                | `internal/content-generation/` | PhÃ¢n táº§ng tá»« khÃ³a chÃ­nh, phá»¥, há»— trá»£; lá»c surface unsafe                   |
| `heuristic-title-builder.ts`          | `internal/content-generation/` | XÃ¢y dá»±ng tiÃªu Ä‘á» sáº£n pháº©m theo chÃ­nh sÃ¡ch Preserve -> Enrich -> Rebuild    |
| `heuristic-content-generator.ts`      | `internal/content-generation/` | TrÃ¬nh táº¡o ná»™i dung táº¥t Ä‘á»‹nh, offline, zero-network                         |
| `gemini-content-generation-schema.ts` | `internal/content-generation/` | Äá»‹nh nghÄ©a JSON Schema cáº¥u trÃºc draft cho Gemini 2.5 Flash                 |
| `gemini-content-generator.ts`         | `internal/content-generation/` | TÃ­ch há»£p Vertex AI ADC gá»i Gemini vá»›i prompt injection defense             |
| `fallback-content-generator.ts`       | `internal/content-generation/` | Decorator fallback an toÃ n tá»« Gemini sang Heuristic                        |
| `html-description-formatter.ts`       | `internal/content-generation/` | Format HTML mÃ´ táº£ sáº£n pháº©m vá»›i whitelist tag vÃ  XSS defense                |
| `claim-guard.ts`                      | `internal/content-generation/` | PhÃ¡t hiá»‡n vi pháº¡m tuyÃªn bá»‘ cháº¥t liá»‡u, báº£o hÃ nh, thÃ´ng sá»‘ khÃ´ng cÃ³ thá»±c     |
| `content-fitters.ts`                  | `internal/content-generation/` | Cáº¯t gá»t SEO Title (<=70) vÃ  Meta Description (<=160) theo ranh giá»›i tá»«     |
| `content-result-validator.ts`         | `internal/content-generation/` | Kiá»ƒm thá»­ tÃ­nh há»£p lá»‡ 2 táº§ng (Draft Validator & Final Validator)            |
| `slug-utils.ts`                       | `internal/content-generation/` | Chuáº©n hÃ³a slug URL kebab-case, chuyá»ƒn Ä‘á»•i tiáº¿ng Viá»‡t, quáº£n lÃ½ handle       |
| `b5-content-generation.ts`            | `internal/stages/`             | Stage runner tÃ­ch há»£p toÃ n bá»™ luá»“ng B5 vÃ o SEO Pipeline                    |

---

## 4. Káº¿t quáº£ Kiá»ƒm thá»­ & Nghiá»‡m thu

ToÃ n bá»™ 230/230 test trong repository Ä‘á»u vÆ°á»£t qua (100% PASS):

- `b5-keyword-allocation.test.ts`: 5/5 tests PASS (chá»n primary, loáº¡i discarded, cluster diversity, tÃ¡ch framing concepts).
- `b5-content-validation.test.ts`: 4/4 tests PASS (slug unicode tiáº¿ng Viá»‡t, XSS escaping, length fitters, claim guard).
- `b5-content-generation.test.ts`: 9/9 tests PASS (deterministic heuristic, sparse product, prompt injection defense, fallback decorator, 5 test cases cho title policy Preserve->Enrich->Rebuild vÃ  ungrounded modifier defense).
- `b5-content-generation-integration.test.ts`: 2/2 tests PASS (pipeline end-to-end qua B5 vá»›i Ä‘á»‹nh dáº¡ng HTML vÃ  SEO limits).
- `pipeline.test.ts`: 17/17 tests PASS (thá»© tá»± stage, immutability, recovery, context propagation).
- `service.test.ts`: 10/10 tests PASS (public contract output, whitespace/empty handle safety, mock runner parity).

Lá»‡nh kiá»ƒm tra:

```bash
npm test         # 230 tests pass
npm run typecheck # 0 errors
npm run build    # build production thÃ nh cÃ´ng
npm run build:mock # build mock thÃ nh cÃ´ng
```

