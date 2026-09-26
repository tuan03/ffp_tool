# BÃ¡o CÃ¡o Nghiá»‡m Thu BÆ°á»›c B2: Shopping Context & Buyer Intent Seeds

> **Module:** SEO + Content (`seo-content`)  
> **Giai Ä‘oáº¡n:** BÆ°á»›c B2 â€” XÃ¢y dá»±ng bá»‘i cáº£nh mua sáº¯m & háº¡t giá»‘ng Ã½ Ä‘á»‹nh ngÆ°á»i mua (Shopping Context)  
> **NgÆ°á»i thá»±c hiá»‡n (Worker):** Antigravity Coding Agent  
> **NgÆ°á»i Ä‘Ã¡nh giÃ¡ (Reviewer / Planner):** ChatGPT Web Team  
> **Tráº¡ng thÃ¡i:** **APPROVED / ACCEPTED (ÄÃƒ NGHIá»†M THU CODE & KIáº¾N TRÃšC)** âœ…

---

## 1. Tá»•ng quan má»¥c tiÃªu BÆ°á»›c B2

BÆ°á»›c B2 chá»‹u trÃ¡ch nhiá»‡m tá»•ng há»£p dá»¯ liá»‡u hiá»ƒu biáº¿t sáº£n pháº©m tá»« BÆ°á»›c B1 (`productUnderstanding`) cÃ¹ng thÃ´ng tin nguá»“n tá»« ngÆ°á»i bÃ¡n (`source: niche, title, description, handle`) Ä‘á»ƒ xÃ¢y dá»±ng bá»‘i cáº£nh mua sáº¯m hoÃ n chá»‰nh (`ShoppingContext`):

- **Äá»‘i tÆ°á»£ng khÃ¡ch hÃ ng má»¥c tiÃªu (`targetAudience`):** 1 Ä‘áº¿n 8 phÃ¢n khÃºc khÃ¡ch hÃ ng tiá»m nÄƒng hoáº·c ngÆ°á»i nháº­n quÃ  (vÃ­ dá»¥: `cat lovers`, `nurse gift shoppers`, `vintage aesthetic enthusiasts`).
- **Dá»‹p mua sáº¯m / sá»­ dá»¥ng phÃ¹ há»£p (`suitableOccasions`):** 1 Ä‘áº¿n 6 sá»± kiá»‡n hoáº·c hoÃ n cáº£nh mua hÃ ng (vÃ­ dá»¥: `halloween celebration`, `nurse appreciation week`, `everyday wear`).
- **CÃ´ng nÄƒng / TrÆ°á»ng há»£p sá»­ dá»¥ng (`useCases`):** 1 Ä‘áº¿n 6 trÆ°á»ng há»£p sá»­ dá»¥ng thá»±c táº¿ cá»§a phÃ¢n loáº¡i sáº£n pháº©m (vÃ­ dá»¥: `everyday casual wear`, `morning coffee routine`, `gift giving`).
- **Háº¡t giá»‘ng Ã½ Ä‘á»‹nh ngÆ°á»i mua (`buyerIntentKeywords`):** 3 Ä‘áº¿n 12 cá»¥m tá»« háº¡t giá»‘ng Ã½ Ä‘á»‹nh mua sáº¯m cÃ³ Ä‘á»™ chÃ­nh xÃ¡c cao (2 Ä‘áº¿n 8 tá»«), Ä‘Ã³ng vai trÃ² Ä‘áº§u vÃ o trá»±c tiáº¿p cho BÆ°á»›c B3 (Search Suggestions & Google Autocomplete Research).

---

## 2. Kiáº¿n trÃºc & CÃ¡c thÃ nh pháº§n Ä‘Ã£ triá»ƒn khai

Táº¥t cáº£ cÃ¡c thÃ nh pháº§n Ä‘Æ°á»£c Ä‘áº·t trong thÆ° má»¥c: `src/modules/seo-content/internal/shopping-context/`

### 2.1. Há»£p Ä‘á»“ng trá»«u tÆ°á»£ng & PhÃ¢n Ä‘á»‹nh ranh giá»›i (Domain Contracts)

- **`shopping-context-analyzer.ts`:**
  - Äá»‹nh nghÄ©a interface trá»«u tÆ°á»£ng `ShoppingContextAnalyzer` vá»›i hÃ m `analyze(input: ShoppingContextAnalysisInput): Promise<ShoppingContext>`.
  - GiÃºp phÃ¢n tÃ¡ch hoÃ n toÃ n táº§ng nghiá»‡p vá»¥ phÃ¢n tÃ­ch khá»i táº§ng pipeline vÃ  táº¡o Ä‘iá»u kiá»‡n Dependency Injection hoÃ n háº£o trong unit testing.

### 2.2. Schema JSON cÃ³ cáº¥u trÃºc & TrÃ¬nh chuáº©n hÃ³a (Schema & Normalization)

- **`gemini-shopping-context-schema.ts`:**
  - Khai bÃ¡o schema JSON cáº¥u trÃºc nghiÃªm ngáº·t `GEMINI_SHOPPING_CONTEXT_SCHEMA` tÆ°Æ¡ng thÃ­ch chuáº©n `@google/genai` Vertex AI API (`responseMimeType: "application/json"`, `responseSchema`).
  - Quy Ä‘á»‹nh cháº·t cháº½ cÃ¡c giá»›i háº¡n cardinality:
    - `targetAudience`: `minItems: 1`, `maxItems: 8`
    - `suitableOccasions`: `minItems: 1`, `maxItems: 6`
    - `useCases`: `minItems: 1`, `maxItems: 6`
    - `buyerIntentKeywords`: `minItems: 3`, `maxItems: 12`
- **`shopping-context-normalizer.ts`:**
  - HÃ m `parseAndNormalizeShoppingContext`:
    1. BÃ³c tÃ¡ch markdown code fences (`json ... `) náº¿u cÃ³ Ä‘á»ƒ tÄƒng tÃ­nh thÃ­ch á»©ng.
    2. Parse JSON nghiÃªm ngáº·t, Ä‘á»‘i chiáº¿u Ä‘áº§y Ä‘á»§ cÃ¡c trÆ°á»ng báº¯t buá»™c vÃ  tá»« chá»‘i cÃ¡c thuá»™c tÃ­nh ngoÃ i schema (`additionalProperties: false`).
    3. Kiá»ƒm tra kiá»ƒu dá»¯ liá»‡u chuá»—i vÃ  pháº¡m vi sá»‘ lÆ°á»£ng (cardinality).
    4. Cáº¯t tá»‰a khoáº£ng tráº¯ng (trim), chuyá»ƒn vá» chá»¯ thÆ°á»ng (lowercase), loáº¡i bá» trÃ¹ng láº·p khÃ´ng phÃ¢n biá»‡t hoa thÆ°á»ng.
    5. Ãp dá»¥ng bá»™ lá»c tá»« cáº¥m (Banned Terms Filter) sá»­ dá»¥ng Regex Token-Boundary `(?:^|\\s)${escapeRegex(term)}(?:$|\\s)` cho cÃ¡c tá»«: `best`, `cheap`, `sale`, `near me`, `ideas`, `amazon`, `etsy`, `ebay`, `walmart`. Bá»™ lá»c nÃ y chá»‰ Ã¡p dá»¥ng riÃªng cho `buyerIntentKeywords` cá»§a B2, tuyá»‡t Ä‘á»‘i báº£o tá»“n nguyÃªn vÄƒn chá»¯ in OCR trÃªn thiáº¿t káº¿ (`ocrTexts`) á»Ÿ B1.

### 2.3. Há»‡ thá»‘ng quy táº¯c suy diá»…n Heuristic táº¥t Ä‘á»‹nh (Rules & Heuristic Analyzer)

- **`shopping-context-rules.ts`:**
  - Báº£ng tra cá»©u 20 danh má»¥c sáº£n pháº©m thÆ°Æ¡ng máº¡i Ä‘iá»‡n tá»­ phá»• biáº¿n (`t-shirt`, `hoodie`, `mug`, `tumbler`, `tote bag`, `canvas print`, `phone case`, `sticker`, v.v.) vá»›i danh tá»« chuáº©n, Ä‘á»‘i tÆ°á»£ng máº·c Ä‘á»‹nh, hoÃ n cáº£nh vÃ  cÃ´ng nÄƒng thá»±c táº¿.
  - Báº£ng quy táº¯c quan há»‡ ngá»¯ nghÄ©a: `ROLE_RECIPIENT_RULES` (cho cÃ¡c chá»©c danh/vai trÃ² nhÆ° Mom, Dad, Nurse, Teacher, Engineer), `OCCASION_RULES` (Halloween, Christmas, Father's Day, v.v.), `STYLE_RULES` (vintage, minimalist, gothic, grunge, v.v.), vÃ  danh sÃ¡ch tá»« khÃ³a thá»±c thá»ƒ `ENTITY_AUDIENCE_ALLOWLIST`.
- **`heuristic-shopping-context-analyzer.ts`:**
  - Triá»ƒn khai 100% logic deterministic khÃ´ng phá»¥ thuá»™c máº¡ng, Ä‘áº£m báº£o káº¿t quáº£ giá»‘ng nhau tuyá»‡t Ä‘á»‘i qua hÃ ng trÄƒm láº§n cháº¡y.
  - **CÆ¡ cháº¿ Selective Backfill cho Generic Seeds:**
    Chá»‰ sinh cÃ¡c cá»¥m tá»« danh má»¥c chung (`casual t-shirt`, `everyday t-shirt`, `t-shirt`) khi sá»‘ lÆ°á»£ng tá»« khÃ³a Ã½ Ä‘á»‹nh cá»¥ thá»ƒ chÆ°a Ä‘áº¡t tá»‘i thiá»ƒu 3. Khi sáº£n pháº©m cÃ³ tÃ­n hiá»‡u phong phÃº (entity, occasion, style), cÆ¡ cháº¿ nÃ y hoÃ n toÃ n khÃ´ng cháº¡y, giá»¯ sáº¡ch 100% khÃ´ng gian tÃ¬m kiáº¿m cho BÆ°á»›c B3.
  - **Chuáº©n hÃ³a cá»¥m tá»« cháº¥t lÆ°á»£ng cao:**
    - RÃºt gá»n phong cÃ¡ch dÃ i trong tÃ¬m kiáº¿m: `vintage retro` -> `vintage` (vÃ­ dá»¥: `vintage black cat t-shirt`).
    - Chuáº©n hÃ³a Ä‘á»‘i tÆ°á»£ng sá»‘ Ã­t trong cá»¥m quÃ  táº·ng: `cat lovers` -> `cat lover` (vÃ­ dá»¥: `gift for cat lover`).

### 2.4. PhÃ¢n tÃ­ch ngá»¯ cáº£nh thÃ´ng minh qua Gemini Vertex AI & Kháº£ nÄƒng chá»‹u lá»—i (Resilience)

- **`gemini-shopping-context-analyzer.ts`:**
  - Gá»i mÃ´ hÃ¬nh ngÃ´n ngá»¯ lá»›n thÃ´ng qua táº§ng truyá»n dáº«n `@google/genai` (káº¿ thá»«a káº¿t ná»‘i Vertex AI ADC Ä‘Ã£ chá»©ng thá»±c á»Ÿ B1).
  - System Instruction khÃ³a cháº·t cÃ¡c báº¥t biáº¿n: cÄƒn cá»© tuyá»‡t Ä‘á»‘i vÃ o evidence tá»« B1, khÃ´ng suy diá»…n giá»›i tÃ­nh tá»« mÃ u sáº¯c, phÃ¢n biá»‡t rÃµ ngÆ°á»i mua vÃ  ngÆ°á»i nháº­n quÃ , sinh cá»¥m tá»« tá»« 2 Ä‘áº¿n 8 tá»«.
  - ChÃ­nh sÃ¡ch Retry Policy: tá»± Ä‘á»™ng retry 1 láº§n vá»›i backoff khi gáº·p lá»—i táº¡m thá»i (429 Rate Limit, 503 Unavailable, 504 Gateway Timeout), nÃ©m lá»—i ngay khi gáº·p lá»—i vÄ©nh viá»…n (400, 401, 403).
- **`fallback-shopping-context-analyzer.ts`:**
  - Ãp dá»¥ng Decorator Pattern bá»c quanh `primary` (Gemini) vÃ  `fallback` (Heuristic).
  - Há»— trá»£ callback `onFallback` phá»¥c vá»¥ cáº£nh bÃ¡o vÃ  giÃ¡m sÃ¡t há»‡ thá»‘ng.

### 2.5. TÃ­ch há»£p Pipeline Stage B2 (Wiring & Stage Engine)

- **`src/modules/seo-content/internal/stages/b2-shopping-context.ts`:**
  - HÃ m táº¡o stage `createB2ShoppingContextStage(dependencies?)` há»— trá»£ Dependency Injection.
  - HÃ m khá»Ÿi táº¡o máº·c Ä‘á»‹nh `createDefaultShoppingContextAnalyzer()` thÃ´ng minh:
    - **TrÆ°á»ng há»£p A (ChÆ°a cáº¥u hÃ¬nh `GOOGLE_CLOUD_PROJECT`):** Sá»­ dá»¥ng trá»±c tiáº¿p `HeuristicShoppingContextAnalyzer` â€” khÃ´ng gá»i máº¡ng, khÃ´ng phÃ¡t sinh log fallback giáº£ Ä‘á»‹nh.
    - **TrÆ°á»ng há»£p B (ÄÃ£ cáº¥u hÃ¬nh `GOOGLE_CLOUD_PROJECT`):** Sá»­ dá»¥ng `GeminiShoppingContextAnalyzer` lÃ m primary; náº¿u gáº·p lá»—i runtime (vÃ­ dá»¥ ADC chÆ°a authenticated), tá»± Ä‘á»™ng fallback sang `HeuristicShoppingContextAnalyzer` vÃ  ghi nháº­n log cáº£nh bÃ¡o: `[SEO B2 Fallback] Gemini shopping context analysis failed for product '...'. Falling back to heuristic analyzer. Cause: ...`.
  - Thá»±c thi báº¥t biáº¿n `evolveContext(context, { shoppingContext })`, táº¡o object má»›i mÃ  khÃ´ng lÃ m Ä‘á»™t biáº¿n context gá»‘c.

---

## 3. CÃ¡c báº¥t biáº¿n kiáº¿n trÃºc cá»‘t lÃµi Ä‘Ã£ Ä‘Æ°á»£c kiá»ƒm chá»©ng (Invariants)

1. **Color Non-Inference Invariant:**
   MÃ u sáº¯c trá»±c quan (nhÆ° `pink`, `blue`) tuyá»‡t Ä‘á»‘i khÃ´ng Ä‘Æ°á»£c dÃ¹ng Ä‘á»ƒ suy diá»…n Ä‘á»‘i tÆ°á»£ng nhÃ¢n kháº©u há»c (`women`, `girls`, `moms`, `men`).
2. **Buyer â‰  Recipient Semantics:**
   Thiáº¿t káº¿ chá»©a chá»¯ in OCR nhÆ° `"BEST NURSE EVER"` suy diá»…n ngÆ°á»i nháº­n lÃ  y tÃ¡ vÃ  ngÆ°á»i mua lÃ  ngÆ°á»i tÃ¬m quÃ  táº·ng y tÃ¡ (`nurse gift shoppers`), khÃ´ng Ä‘á»“ng nháº¥t ngÆ°á»i mua lÃ  y tÃ¡.
3. **Personalization Invariant:**
   Chá»‰ sinh tá»« khÃ³a cÃ¡ nhÃ¢n hÃ³a (`personalized`, `custom`) khi cÃ³ tÃ­n hiá»‡u cá»¥ thá»ƒ tá»« B1 hoáº·c source (`name`, `custom text`, `upload photo`).
4. **Banned Keyword Filtering:**
   Loáº¡i bá» hoÃ n toÃ n cÃ¡c tá»« cáº¥m tiáº¿p thá»‹ chung chung hoáº·c sÃ n Ä‘á»‘i thá»§ (`best`, `cheap`, `sale`, `near me`, `amazon`, `etsy`, `ebay`, `walmart`) báº±ng ranh giá»›i token tá»«.
5. **Precision Over Recall (Downstream B3 Safety):**
   Generic category fallback seeds khÃ´ng Ä‘Æ°á»£c phÃ©p lá»t vÃ o khi sáº£n pháº©m Ä‘Ã£ cÃ³ strong signals. B2 chá»‰ cung cáº¥p cÃ¡c candidate seed phrases cÃ³ giÃ¡ trá»‹ thÃ´ng tin cao.

---

## 4. QuÃ¡ trÃ¬nh phá»‘i há»£p vÃ  Ä‘Ã¡nh giÃ¡ tá»« ChatGPT (Reviewer)

### VÃ²ng 1 Review:

ChatGPT Ä‘Ã¡nh giÃ¡ cao tÃ­nh cháº·t cháº½ cá»§a kiáº¿n trÃºc vÃ  cháº¥m **15/16 tiÃªu chÃ­ PASS âœ…**, Ä‘á»“ng thá»i phÃ¡t hiá»‡n **1 lá»—i Major vá» máº·t semantic**:

- **Lá»—i Major:** Heuristic analyzer append vÃ´ Ä‘iá»u kiá»‡n `casual t-shirt`, `everyday t-shirt`, vÃ  `t-shirt` vÃ o cuá»‘i danh sÃ¡ch tá»« khÃ³a ngay cáº£ khi sáº£n pháº©m cÃ³ rich visual signals, lÃ m Ã´ nhiá»…m search space downstream cho B3 Google Autocomplete.
- **YÃªu cáº§u bá»• sung:**
  1. Chuyá»ƒn generic fallback thÃ nh selective backfill (chá»‰ cháº¡y khi candidates < 3).
  2. Bá»• sung 2 regression tests: Q1 (generic fallback isolation) vÃ  Q2 (generic fallback on sparse input).
  3. Chuáº©n hÃ³a phong cÃ¡ch (`vintage retro` -> `vintage`) vÃ  Ä‘á»‘i tÆ°á»£ng sá»‘ Ã­t (`cat lover` cho quÃ  táº·ng).

### VÃ²ng 2 Review & PhÃª duyá»‡t chÃ­nh thá»©c:

Worker Ä‘Ã£ hoÃ n thiá»‡n viá»‡c sá»­a code, bá»• sung 2 unit test Group Q1 vÃ  Q2, cháº¡y láº¡i toÃ n bá»™ test suite vÃ  gá»­i bÃ¡o cÃ¡o cÃ¹ng output smoke test thá»±c táº¿.

**Nháº­n xÃ©t vÃ  PhÃª duyá»‡t chÃ­nh thá»©c tá»« ChatGPT:**

```text
Verdict cuá»‘i cÃ¹ng
B2 architecture                  PASS âœ…
B2 domain contract               PASS âœ…
B2 B1â†’B2 grounding               PASS âœ…
B2 heuristic rules               PASS âœ…
B2 selective backfill            PASS âœ…
B2 buyer-intent precision        PASS âœ…
B2 color non-inference           PASS âœ…
B2 personalization invariant     PASS âœ…
B2 recipient semantics           PASS âœ…
B2 determinism                   PASS âœ…
B2 schema/normalization          PASS âœ…
B2 fallback design               PASS âœ…
B2 immutability                  PASS âœ…
B2 B3 readiness                  PASS âœ…
B2 regression tests              PASS âœ…
B2 automated verification        PASS âœ… (reported)

B2 IMPLEMENTATION                APPROVED âœ…
Live Gemini B2 happy path        PENDING
```

### VÃ²ng 3 Skeptical Hardening & Audit (Antigravity Hardening):

ÄÃ£ rÃ  soÃ¡t vÃ  triá»‡t Ä‘á»ƒ kháº¯c phá»¥c cÃ¡c Ä‘iá»ƒm rá»§i ro tiá»m áº©n:

1. **Lá»—i triá»‡t tiÃªu tá»« khÃ³a recipient 'friend':** `ROLE_RECIPIENT_RULES.friend.giftKeyword` Ä‘Æ°á»£c sá»­a tá»« `"gift for best friend"` sang `"gift for friend"`, ngÄƒn cháº·n bá»™ lá»c `BANNED_INTENT_TERMS` (`\bbest\b`) xÃ³a bá» nháº§m cá»¥m tá»« quÃ  táº·ng cá»§a nhÃ³m friend.
2. **Kháº¯c phá»¥c thá»© tá»± Æ°u tiÃªn danh má»¥c:** Sáº¯p xáº¿p danh má»¥c nhiá»u tá»« cá»¥ thá»ƒ hÆ¡n (`coffee mug`) trÆ°á»›c danh tá»« Ä‘Æ¡n láº» (`mug`) trong `CATEGORY_RULES` Ä‘á»ƒ trÃ¡nh bá»‹ nuá»‘t tá»« khÃ³a.
3. **Má»Ÿ rá»™ng Ä‘á»™ phá»§ danh má»¥c e-commerce:** Bá»• sung Ä‘áº§y Ä‘á»§ `canvas print`, `throw pillow`, `area rug`, `sticker`, `tank top`, `bedding set`, `quilt`, `comforter` theo Ä‘Ãºng danh má»¥c tá»« B1.
4. **Báº£o tá»“n visual entity ngoÃ i allowlist:** CÃ¡c thá»±c thá»ƒ thá»‹ giÃ¡c há»£p lá»‡ tá»« B1 (nhÆ° `sunset`, `mountain`, `skull`) Ä‘Æ°á»£c báº£o tá»“n Ä‘á»ƒ táº¡o cÃ¡c cá»¥m tá»« sáº£n pháº©m tá»± nhiÃªn (`vintage sunset t-shirt`, `sunset t-shirt`) mÃ  khÃ´ng bá»‹ rá»›t vá» generic fallback.
5. **Robust Markdown Fence Extractor:** Cáº£i tiáº¿n `cleanRawJsonText` trÃ­ch xuáº¥t an toÃ n JSON block ngay cáº£ khi mÃ´ hÃ¬nh LLM chÃ¨n thÃªm lá»i má»Ÿ Ä‘áº§u/káº¿t thÃºc quanh markdown fence.
6. **Bá»• sung Handle vÃ o prompt Gemini:** ÄÆ°a `Handle: ...` vÃ o metadata `SOURCE PRODUCT` trong `GeminiShoppingContextAnalyzer.buildPrompt`.
7. **Bá»• sung 6 unit tests Group R (R1 -> R6):** NÃ¢ng tá»•ng sá»‘ B2 tests lÃªn **33/33 PASS**.

---

## 5. Káº¿t quáº£ kiá»ƒm thá»­ & xÃ¡c minh (Verification Record)

| Lá»‡nh kiá»ƒm thá»­                                                                         | Pháº¡m vi               | Káº¿t quáº£                 | Ghi chÃº                                              |
| :------------------------------------------------------------------------------------ | :-------------------- | :---------------------- | :--------------------------------------------------- |
| `npx tsx --test src/modules/seo-content/__tests__/b2-shopping-context.test.ts` | B2 Unit Test Suite    | **33/33 PASS** (100%)   | Äáº§y Ä‘á»§ 18 nhÃ³m A Ä‘áº¿n R (kÃ¨m Q1, Q2, R1-R6)           |
| `npm test`                                                                            | ToÃ n bá»™ á»©ng dá»¥ng      | **115/115 PASS** (100%) | ToÃ n bá»™ cÃ¡c module vÃ  pipeline integration           |
| `npm run typecheck`                                                                   | TypeScript Strict     | **PASS (0 errors)**     | `tsc --noEmit` hoÃ n toÃ n sáº¡ch                        |
| `npm run build`                                                                       | Vite Production Build | **PASS**                | ÄÃ³ng gÃ³i client bundle thÃ nh cÃ´ng (549ms)            |
| `npm run build:mock`                                                                  | Vite Mock Build       | **PASS**                | ÄÃ³ng gÃ³i mock mode thÃ nh cÃ´ng (568ms)                |
| `npx tsx src/modules/seo-content/scripts/b2-smoke-test.ts`                     | Node.js Smoke Test    | **PASS**                | Output sáº¡ch, Ä‘Ãºng Ä‘á»‹nh dáº¡ng, khÃ´ng cÃ²n generic seeds |

### Output thá»±c táº¿ tá»« Smoke Test sau khi fix:

```json
{
  "targetAudience": ["cat lovers", "vintage aesthetic enthusiasts", "graphic apparel shoppers"],
  "suitableOccasions": ["halloween celebration", "halloween party", "everyday wear"],
  "useCases": ["everyday casual wear", "costume party wear"],
  "buyerIntentKeywords": [
    "vintage black cat t-shirt",
    "black cat halloween t-shirt",
    "halloween t-shirt",
    "black cat t-shirt",
    "t-shirt for cat lovers",
    "gift for cat lover",
    "t-shirt gift for cat lover",
    "vintage t-shirt"
  ]
}
```

---

## 6. Sáºµn sÃ ng cho BÆ°á»›c B3 (Next Step)

BÆ°á»›c B2 Ä‘Ã£ hoÃ n thÃ nh trá»n váº¹n vÃ  táº¡o ná»n táº£ng vá»¯ng cháº¯c cho BÆ°á»›c B3:

- B2 cung cáº¥p `buyerIntentKeywords` lÃ m cÃ¡c háº¡t giá»‘ng Ã½ Ä‘á»‹nh cháº¥t lÆ°á»£ng cao (`candidate seed phrases`).
- BÆ°á»›c B3 sáº½ sá»­ dá»¥ng cÃ¡c seed nÃ y Ä‘á»ƒ truy váº¥n trá»±c tiáº¿p Google Autocomplete Service, thu tháº­p dá»¯ liá»‡u tÃ¬m kiáº¿m thá»±c táº¿ cÃ³ nguá»“n gá»‘c minh báº¡ch (`provenance`), phÃ¢n táº§ng gá»£i Ã½ thÃ nh `prioritySuggestions`, `longTailSuggestions`, vÃ  `semanticClusterSuggestions`.

