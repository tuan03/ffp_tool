# BÃ¡o CÃ¡o Nghiá»‡m Thu BÆ°á»›c B3: Search Suggestions & Google Autocomplete

> **Module:** SEO + Content (`seo-content`)  
> **Giai Ä‘oáº¡n:** BÆ°á»›c B3 â€” Má»Ÿ rá»™ng gá»£i Ã½ tÃ¬m kiáº¿m & nghiÃªn cá»©u tá»« khÃ³a (Search Suggestions)  
> **NgÆ°á»i thá»±c hiá»‡n (Worker):** Antigravity Coding Agent  
> **NgÆ°á»i Ä‘Ã¡nh giÃ¡ (Reviewer / Planner):** ChatGPT Web Team  
> **Tráº¡ng thÃ¡i:** **APPROVED / ACCEPTED (ÄÃƒ NGHIá»†M THU CODE & KIáº¾N TRÃšC)** âœ…

---

## 1. Tá»•ng quan má»¥c tiÃªu BÆ°á»›c B3

BÆ°á»›c B3 chá»‹u trÃ¡ch nhiá»‡m tiáº¿p nháº­n táº­p dá»¯ liá»‡u bá»‘i cáº£nh mua sáº¯m (`ShoppingContext`) tá»« BÆ°á»›c B2 cÃ¹ng thÃ´ng tin sáº£n pháº©m tá»« BÆ°á»›c B1 vÃ  nguá»“n ngÆ°á»i bÃ¡n (`source`), sau Ä‘Ã³ má»Ÿ rá»™ng khÃ´ng gian tÃ¬m kiáº¿m thá»±c táº¿ cho sáº£n pháº©m thÃ´ng qua dá»‹ch vá»¥ gá»£i Ã½ tÃ¬m kiáº¿m (Search Suggestions):

- **Trá»ng tÃ¢m triá»ƒn khai v1:** Thu tháº­p dá»¯ liá»‡u tÃ¬m kiáº¿m thá»±c táº¿ tá»« **Google Autocomplete API** (Etsy Suggest Scraper vÃ  People Also Ask - PAA Ä‘Æ°á»£c báº£o lÆ°u trong káº¿ hoáº¡ch dÃ i háº¡n).
- **Háº¡t giá»‘ng tÃ¬m kiáº¿m (`seedKeywords`):** Lá»±a chá»n tá»‘i Ä‘a 6 cá»¥m tá»« háº¡t giá»‘ng cÃ³ Ã½ Ä‘á»‹nh mua sáº¯m cao nháº¥t theo thá»© báº­c Æ°u tiÃªn táº¥t Ä‘á»‹nh tá»« B2 vÃ  B1.
- **Truy váº¥n gá»£i Ã½ má»Ÿ rá»™ng (`suggestedQueries`):** Thu tháº­p tá»‘i Ä‘a 8 gá»£i Ã½ cháº¥t lÆ°á»£ng cho má»—i seed vÃ  tá»‘i Ä‘a 40 truy váº¥n trÃªn toÃ n bá»™ sáº£n pháº©m.
- **Minh báº¡ch nguá»“n gá»‘c (`querySources`):** Gáº¯n nhÃ£n xuáº¥t xá»© rÃµ rÃ ng vÃ  chuáº©n hÃ³a (`buyer_intent_seed`, `category_seed`, `niche_seed`, `title_seed`, `fallback_seed`, `google_autocomplete`), há»— trá»£ cÆ¡ cháº¿ nÃ¢ng cáº¥p nguá»“n gá»‘c (Provenance Upgrade) khi truy váº¥n háº¡t giá»‘ng Ä‘Æ°á»£c chÃ­nh Google xÃ¡c thá»±c báº±ng káº¿t quáº£ tÃ¬m kiáº¿m thá»±c táº¿.

---

## 2. Kiáº¿n trÃºc & CÃ¡c thÃ nh pháº§n Ä‘Ã£ triá»ƒn khai

Táº¥t cáº£ mÃ£ nguá»“n BÆ°á»›c B3 Ä‘Æ°á»£c tá»• chá»©c chuáº©n má»±c theo ranh giá»›i mÃ´-Ä‘un trong thÆ° má»¥c:
`src/modules/seo-content/internal/search-suggestions/`

### 2.1. Quáº£n lÃ½ nguá»“n gá»‘c & Thá»© báº­c Ä‘á»‹nh danh (Provenance & Precedence)

- **`query-source.ts`:**
  - Khai bÃ¡o háº±ng sá»‘ chuáº©n hÃ³a `QUERY_SOURCE` vÃ  kiá»ƒu dá»¯ liá»‡u `QuerySource`:
    - `buyer_intent_seed`: Háº¡t giá»‘ng Ã½ Ä‘á»‹nh mua sáº¯m tá»« B2.
    - `category_seed`: Háº¡t giá»‘ng káº¿t há»£p danh má»¥c vÃ  thá»±c thá»ƒ thá»‹ giÃ¡c tá»« B1.
    - `niche_seed`: Háº¡t giá»‘ng phÃ¢n ngÃ¡ch tá»« nguá»“n sáº£n pháº©m.
    - `title_seed`: Cá»¥m tá»« háº¡t giá»‘ng trÃ­ch xuáº¥t sáº¡ch tá»« tiÃªu Ä‘á» gá»‘c (chá»‰ khi dá»¯ liá»‡u nghÃ¨o nÃ n).
    - `fallback_seed`: Danh tá»« danh má»¥c an toÃ n khi hoÃ n toÃ n thiáº¿u dá»¯ liá»‡u.
    - `google_autocomplete`: Truy váº¥n gá»£i Ã½ Ä‘Æ°á»£c xÃ¡c nháº­n thá»±c táº¿ bá»Ÿi Google.
  - HÃ m `shouldUpgradeSource`: Thiáº¿t láº­p thá»© báº­c Æ°u tiÃªn (`google_autocomplete > buyer_intent_seed > category_seed > niche_seed > title_seed > fallback_seed`) phá»¥c vá»¥ viá»‡c thÄƒng háº¡ng nguá»“n gá»‘c minh báº¡ch.

### 2.2. Xá»­ lÃ½ lá»—i Ä‘áº·c thÃ¹ (Error Classification)

- **`search-suggestion-errors.ts`:**
  - `GoogleSuggestError`: Lá»›p lá»—i cÆ¡ sá»Ÿ, gáº¯n cá» `status` HTTP vÃ  `isRetryable`.
  - `GoogleSuggestRateLimitError`: Äáº¡i diá»‡n cho mÃ£ HTTP 429 (Rate Limit), gáº¯n cá» retryable.
  - `GoogleSuggestBlockedError`: Äáº¡i diá»‡n cho mÃ£ HTTP 403 (Forbidden / Bot Block), gáº¯n cá» non-retryable Ä‘á»ƒ láº­p tá»©c kÃ­ch hoáº¡t Circuit Breaker.

### 2.3. Lá»±a chá»n háº¡t giá»‘ng tÃ¬m kiáº¿m táº¥t Ä‘á»‹nh (Seed Selector)

- **`search-seed-selector.ts`:**
  - Triá»ƒn khai hÃ m `selectSearchSeeds(input: SearchSeedSelectionInput): readonly SearchSeed[]`.
  - TuÃ¢n thá»§ nghiÃªm ngáº·t thá»© tá»± Æ°u tiÃªn vÃ  giá»›i háº¡n sá»‘ lÆ°á»£ng (`MAX_SEARCH_SEEDS = 6`):
    1. **Æ¯u tiÃªn 1:** Láº¥y tá»‘i Ä‘a 4 háº¡t giá»‘ng Ã½ Ä‘á»‹nh mua sáº¯m hÃ ng Ä‘áº§u tá»« `buyerIntentKeywords` cá»§a B2 (`MAX_B2_SEEDS = 4`).
    2. **Æ¯u tiÃªn 2:** Tá»•ng há»£p 1 háº¡t giá»‘ng tá»« Category + Detected Entity máº¡nh nháº¥t cá»§a B1 (vÃ­ dá»¥ `black cat t-shirt`) náº¿u chÆ°a Ä‘Æ°á»£c bao phá»§ vÃ  cÃ²n chá»— (`< 6`).
    3. **Æ¯u tiÃªn 3:** Bá»• sung Niche seed náº¿u há»¯u Ã­ch vÃ  chÆ°a trÃ¹ng láº·p (`< 6`).
    4. **Æ¯u tiÃªn 4:** Chá»‰ trÃ­ch xuáº¥t cá»¥m tá»« tiÃªu Ä‘á» ngáº¯n gá»n (tá»‘i Ä‘a 6 tá»«, khÃ´ng bÃ¹ng ná»• token Ä‘Æ¡n láº») khi sá»‘ lÆ°á»£ng háº¡t giá»‘ng cÃ²n quÃ¡ Ã­t (`< 3`).
    5. **Æ¯u tiÃªn 5:** Danh tá»« danh má»¥c an toÃ n (vÃ­ dá»¥ `t-shirt` hoáº·c `product`) chá»‰ kÃ­ch hoáº¡t khi hoÃ n toÃ n khÃ´ng cÃ³ báº¥t ká»³ háº¡t giá»‘ng nÃ o (`seeds.length === 0`). Lá»c bá» triá»‡t Ä‘á»ƒ cÃ¡c nhÃ£n danh má»¥c giáº£ máº¡o (`unspecified`, `none`, `unknown`, `n/a`).
  - ToÃ n bá»™ háº¡t giá»‘ng Ä‘Æ°á»£c chuáº©n hÃ³a Unicode NFKC, gá»™p khoáº£ng tráº¯ng vÃ  deduplicate qua khÃ³a chuáº©n hÃ³a `canonicalKey`. TrÃ¡nh láº·p tá»« thá»«a khi thá»±c thá»ƒ thá»‹ giÃ¡c Ä‘Ã£ bao hÃ m danh má»¥c (vÃ­ dá»¥ trÃ¡nh sinh `black cat t-shirt t-shirt`).

### 2.4. TrÃ¬nh chuáº©n hÃ³a & KhÃ³a Ä‘á»‹nh danh Ä‘á»“ng nháº¥t (Normalizer & Canonicalization)

- **`search-suggestions-normalizer.ts`:**
  - Chuáº©n hÃ³a Unicode NFKC, cáº¯t tá»‰a vÃ  rÃºt gá»n khoáº£ng tráº¯ng liÃªn tiáº¿p.
  - HÃ m `canonicalKey(query)` chuáº©n hÃ³a Ä‘á»“ng nháº¥t dáº¥u gáº¡ch ná»‘i/dÆ°á»›i thÃ nh khoáº£ng tráº¯ng (`replace(/[-_]/g, " ")`), Ä‘Æ°a vá» chá»¯ thÆ°á»ng Ä‘á»ƒ khá»›p chÃ­nh xÃ¡c giá»¯a cÃ¡c biáº¿n thá»ƒ ngá»¯ nghÄ©a (vÃ­ dá»¥ `vintage black cat t-shirt` vÃ  `vintage black cat t shirt`).
  - Loáº¡i bá» cÃ¡c chuá»—i khÃ´ng há»£p lá»‡: chuá»—i rá»—ng, kÃ½ tá»± Ä‘iá»u khiá»ƒn (`[\u0000-\u001F\u007F-\u009F]`), Ä‘Æ°á»ng dáº«n URL thÃ´ (`http://`, `https://`, `www.`).
  - Giá»›i háº¡n ká»¹ thuáº­t an toÃ n: `MAX_QUERY_LENGTH = 120` kÃ½ tá»±, `MAX_QUERY_TOKENS = 12` tá»«.
  - Giá»›i háº¡n sá»‘ lÆ°á»£ng (Cardinality Limits): `MAX_PER_SEED_SUGGESTIONS = 8`, `MAX_GLOBAL_SUGGESTIONS = 40`.
  - **Báº£o toÃ n báº±ng chá»©ng thá»±c táº¿ (Critical Invariant P):** Tuyá»‡t Ä‘á»‘i KHÃ”NG Ã¡p dá»¥ng bá»™ lá»c tá»« ngá»¯ thÆ°Æ¡ng máº¡i cá»§a B2 (`best`, `cheap`, `near me`, `amazon`, `etsy`, `for`, `with`, `gift`) Ä‘á»‘i vá»›i káº¿t quáº£ tá»« Google. ÄÃ¢y lÃ  báº±ng chá»©ng tÃ¬m kiáº¿m bÃªn ngoÃ i cÃ³ giÃ¡ trá»‹ vÃ  pháº£i Ä‘Æ°á»£c giá»¯ nguyÃªn váº¹n Ä‘á»ƒ BÆ°á»›c B4/B5 xá»­ lÃ½.
  - Deduplicate khÃ´ng phÃ¢n biá»‡t hoa thÆ°á»ng nhÆ°ng báº£o toÃ n nguyÃªn vÄƒn chá»¯ hoa/thÆ°á»ng xuáº¥t hiá»‡n láº§n Ä‘áº§u tiÃªn tá»« Google.

### 2.5. CÆ¡ cháº¿ Bá»™ nhá»› Ä‘á»‡m TÃ¬m kiáº¿m (Search Suggestions Cache)

- **`search-suggestions-cache.ts`:**
  - Äá»‹nh nghÄ©a interface `GoogleSuggestCache` chuáº©n (`get`, `set`, `has`, `clear`, `size`).
  - Lá»›p `InMemoryGoogleSuggestCache` tÃ­ch há»£p:
    - Thá»i gian sá»‘ng TTL linh hoáº¡t (máº·c Ä‘á»‹nh 15 phÃºt - 900.000ms).
    - Chiáº¿n lÆ°á»£c dá»n dáº¹p dung lÆ°á»£ng LRU (Least Recently Used) vá»›i giá»›i háº¡n tá»‘i Ä‘a `maxSize` (máº·c Ä‘á»‹nh 500 truy váº¥n) Ä‘á»ƒ chá»‘ng rÃ² rá»‰ bá»™ nhá»› trong mÃ´i trÆ°á»ng runtime dÃ i háº¡n.
    - TÃ­nh nÄƒng sao chÃ©p phÃ²ng thá»§ (Defensive Copying) ngÄƒn cháº·n viá»‡c Ä‘á»™t biáº¿n dá»¯ liá»‡u máº£ng lÃ m há»ng cache.
  - HÃ m táº¡o khÃ³a cache `createSuggestCacheKey(query, language, country)` tá»‘i Æ°u theo locale vÃ  khÃ³a chuáº©n hÃ³a.
  - Cung cáº¥p singleton `defaultGoogleSuggestCache` dÃ¹ng chung cho toÃ n á»©ng dá»¥ng hoáº·c cho phÃ©p tiÃªm cache Ä‘á»™c láº­p cho tá»«ng client.

### 2.6. Táº§ng giao tiáº¿p Google Suggest & Kháº£ nÄƒng chá»‹u lá»—i (Client Layer)

- **`google-suggest-client.ts`:**
  - Interface `GoogleSuggestClient` trá»«u tÆ°á»£ng há»— trá»£ Dependency Injection vÃ  testing khÃ´ng cáº§n máº¡ng.
  - Lá»›p `UnofficialGoogleSuggestClient` giao tiáº¿p vá»›i endpoint `https://suggestqueries.google.com/complete/search?client=firefox`.
  - Há»— trá»£ truyá»n tham sá»‘ Ä‘á»‹a phÆ°Æ¡ng rÃµ rÃ ng (`hl` ngÃ´n ngá»¯, máº·c Ä‘á»‹nh `"en"`, `gl` quá»‘c gia, máº·c Ä‘á»‹nh `"us"`), cho phÃ©p cáº¥u hÃ¬nh linh hoáº¡t qua biáº¿n mÃ´i trÆ°á»ng `SEO_SEARCH_LANGUAGE` vÃ  `SEO_SEARCH_COUNTRY`.
  - TÃ­ch há»£p bá»™ nhá»› Ä‘á»‡m `GoogleSuggestCache`: Tá»± Ä‘á»™ng kiá»ƒm tra vÃ  tráº£ vá» káº¿t quáº£ ngay láº­p tá»©c khi trÃºng cache, trÃ¡nh gá»i máº¡ng dÆ° thá»«a; há»— trá»£ tÃ¹y chá»n `bypassCache: true` Ä‘á»ƒ buá»™c gá»i má»›i khi cáº§n.
  - Quáº£n lÃ½ vÃ²ng Ä‘á»i `AbortSignal`: PhÃ¢n biá»‡t rÃ nh máº¡ch giá»¯a ngáº¯t káº¿t ná»‘i do ngÆ°á»i dÃ¹ng (`signal.abort()` - khÃ´ng bao giá» retry, láº­p tá»©c há»§y vÃ  gá»¡ bá» event listener) vÃ  lá»—i quÃ¡ thá»i gian chá» (Timeout 3000ms - mÃ£ 408, retryable).
  - Retry Policy: Tá»± Ä‘á»™ng retry Ä‘Ãºng 1 láº§n vá»›i Ä‘á»™ trá»… 500ms Ä‘á»‘i vá»›i cÃ¡c lá»—i táº¡m thá»i (408, 429, 502, 503, 504, timeout, network error). Lá»—i vÄ©nh viá»…n (400, 401, 403, 404, malformed shape, caller abort) nÃ©m lá»—i ngay láº­p tá»©c mÃ  khÃ´ng retry.
  - Parser phÃ²ng vá»‡ (Defensive Parsing): Kiá»ƒm tra `Array.isArray(root)`, `root.length >= 2`, `root[1]` lÃ  máº£ng chuá»—i `string[]`. Bá» qua an toÃ n má»i trÆ°á»ng metadata má»Ÿ rá»™ng á»Ÿ index 2+.

### 2.7. Bá»™ thu tháº­p dá»¯ liá»‡u & Bá»™ ngáº¯t máº¡ch hÃ ng loáº¡t (Collector & Circuit Breaker)

- **`google-search-suggestions-collector.ts`:**
  - Äiá»u phá»‘i thu tháº­p gá»£i Ã½ cho tá»«ng háº¡t giá»‘ng theo cÆ¡ cháº¿ tuáº§n tá»± (concurrency = 1) kÃ¨m khoáº£ng nghá»‰ `interRequestDelayMs` (250ms trong live mode, 0ms trong unit test) Ä‘á»ƒ trÃ¡nh gÃ¢y Ã¡p lá»±c lÃªn endpoint.
  - **Bá»™ ngáº¯t máº¡ch theo lÃ´ (Batch Circuit Breaker):**
    - Ngáº¯t ngay láº­p tá»©c toÃ n bá»™ cÃ¡c seed cÃ²n láº¡i trong lÃ´ khi gáº·p mÃ£ 403 (bá»‹ Google cháº·n) hoáº·c 429 kÃ©o dÃ i (Rate limit), ká»ƒ cáº£ khi lá»—i Ä‘Æ°á»£c gÃ³i dÆ°á»›i dáº¡ng `GoogleSuggestError` cÃ³ mÃ£ tráº¡ng thÃ¡i tÆ°Æ¡ng á»©ng.
  - **Cháº¥p nháº­n lá»—i má»™t pháº§n (Partial Failure Preservation):** Náº¿u 1 seed gáº·p sá»± cá»‘ máº¡ng hoáº·c 5xx, há»‡ thá»‘ng báº£o tá»“n nguyÃªn váº¹n cÃ¡c gá»£i Ã½ Ä‘Ã£ thu tháº­p thÃ nh cÃ´ng tá»« cÃ¡c seed trÆ°á»›c Ä‘Ã³ vÃ  tiáº¿p tá»¥c xá»­ lÃ½ cÃ¡c seed tiáº¿p theo náº¿u chÆ°a bá»‹ ngáº¯t máº¡ch.
  - **NÃ¢ng cáº¥p háº¡t giá»‘ng trÃ¹ng khá»›p (Exact Match Provenance Upgrade):** Khi má»™t gá»£i Ã½ tá»« Google trÃ¹ng khá»›p chÃ­nh xÃ¡c (ká»ƒ cáº£ biáº¿n thá»ƒ dáº¥u gáº¡ch ná»‘i) vá»›i má»™t seed ban Ä‘áº§u, há»‡ thá»‘ng khÃ´ng thÃªm báº£n sao vÃ o máº£ng `suggestedQueries`, mÃ  nÃ¢ng cáº¥p nguá»“n gá»‘c cá»§a seed trong `querySources` thÃ nh `google_autocomplete`.
  - **Thá»© tá»± táº¥t Ä‘á»‹nh (Deterministic Ordering):** Báº£o toÃ n tuyá»‡t Ä‘á»‘i thá»© tá»± Æ°u tiÃªn cá»§a seed vÃ  thá»© tá»± gá»£i Ã½ do Google tráº£ vá» (first-seen wins), khÃ´ng sáº¯p xáº¿p láº¡i theo báº£ng chá»¯ cÃ¡i ABC.

### 2.8. Bá»™ thu tháº­p dá»± phÃ²ng khÃ´ng máº¡ng (Fallback Collector)

- **`fallback-search-suggestions-collector.ts`:**
  - Thá»±c thi phÆ°Æ¡ng Ã¡n dá»± phÃ²ng hoÃ n toÃ n táº¥t Ä‘á»‹nh khi Google Autocomplete khÃ´ng kháº£ dá»¥ng hoáº·c bá»‹ vÃ´ hiá»‡u hÃ³a.
  - **Äá»™ trung thá»±c dá»¯ liá»‡u tuyá»‡t Ä‘á»‘i (Critical Invariants S & T):** Tráº£ vá» danh sÃ¡ch háº¡t giá»‘ng Ä‘Ã£ chá»n `seedKeywords`, máº£ng `suggestedQueries: []` (rá»—ng), vÃ  Ã¡nh xáº¡ nguá»“n gá»‘c seed gá»‘c. Tuyá»‡t Ä‘á»‘i KHÃ”NG tá»± Ä‘á»™ng sinh cÃ¡c truy váº¥n giáº£ máº¡o (synthetic variations) vÃ  KHÃ”NG mang nhÃ£n `google_autocomplete` khi chÆ°a cÃ³ xÃ¡c nháº­n tá»« Google.

### 2.9. TÃ­ch há»£p Pipeline Stage B3 (Stage Wiring)

- **`src/modules/seo-content/internal/stages/b3-search-suggestions.ts`:**
  - HÃ m táº¡o stage `createB3SearchSuggestionsStage(dependencies?)` há»— trá»£ Dependency Injection hoÃ n háº£o vÃ  khá»Ÿi táº¡o collector Ä‘á»™ng táº¡i thá»i Ä‘iá»ƒm thá»±c thi.
  - Cáº¥u hÃ¬nh provider rÃµ rÃ ng qua biáº¿n mÃ´i trÆ°á»ng `SEO_SEARCH_PROVIDER` (`google` | `offline` | `fallback`) hoáº·c `SEO_SEARCH_SUGGESTIONS_ENABLED` (`false`).
  - Trong mÃ´i trÆ°á»ng kiá»ƒm thá»­ tá»± Ä‘á»™ng (`NODE_ENV === "test"` hoáº·c runner kiá»ƒm thá»­), máº·c Ä‘á»‹nh kÃ­ch hoáº¡t cháº¿ Ä‘á»™ an toÃ n `FallbackSearchSuggestionsCollector` Ä‘á»ƒ báº£o Ä‘áº£m nguyÃªn táº¯c Zero-Network cho test suite.
  - Thá»±c thi báº¥t biáº¿n `evolveContext(context, { searchResearch })`, táº¡o Ä‘á»‘i tÆ°á»£ng context má»›i mÃ  khÃ´ng lÃ m Ä‘á»™t biáº¿n dá»¯ liá»‡u gá»‘c.

---

## 3. CÃ¡c báº¥t biáº¿n kiáº¿n trÃºc cá»‘t lÃµi Ä‘Ã£ Ä‘Æ°á»£c kiá»ƒm chá»©ng (Invariants)

1. **External Evidence Grounding Invariant (Data Fidelity):**
   Gá»£i Ã½ tÃ¬m kiáº¿m thuá»™c BÆ°á»›c B3 pháº£i lÃ  báº±ng chá»©ng tÃ¬m kiáº¿m thá»±c táº¿ tá»« bÃªn ngoÃ i. Khi Google khÃ´ng kháº£ dá»¥ng, há»‡ thá»‘ng tráº£ vá» máº£ng rá»—ng `suggestedQueries: []` thay vÃ¬ tá»± bá»‹a Ä‘áº·t query giáº£ máº¡o gáº¯n mÃ¡c tÃ¬m kiáº¿m.
2. **Provenance Integrity Invariant:**
   NhÃ£n `google_autocomplete` chá»‰ Ä‘Æ°á»£c gÃ¡n duy nháº¥t cho cÃ¡c truy váº¥n thá»±c táº¿ do Google tráº£ vá» hoáº·c háº¡t giá»‘ng Ä‘Æ°á»£c Google xÃ¡c thá»±c chÃ­nh xÃ¡c. Cháº¿ Ä‘á»™ fallback tuyá»‡t Ä‘á»‘i khÃ´ng Ä‘Æ°á»£c sá»­ dá»¥ng nhÃ£n nÃ y.
3. **External Text Preservation Invariant (No B2 Banned-Word Leakage):**
   KhÃ´ng Ã¡p dá»¥ng bá»™ lá»c tá»« ngá»¯ tiáº¿p thá»‹ (`best`, `cheap`, `near me`, `amazon`, `etsy`) lÃªn káº¿t quáº£ cá»§a Google. Má»i dá»¯ liá»‡u khÃ¡ch quan tá»« ngÆ°á»i dÃ¹ng tÃ¬m kiáº¿m Ä‘Æ°á»£c giá»¯ nguyÃªn Ä‘á»ƒ chuyá»ƒn giao cho BÆ°á»›c B4/B5 Ä‘Ã¡nh giÃ¡ má»©c Ä‘á»™ phÃ¹ há»£p.
4. **Duplicate Seed Upgrade Invariant:**
   Khi káº¿t quáº£ gá»£i Ã½ trÃ¹ng vá»›i seed Ä‘áº§u vÃ o, há»‡ thá»‘ng khÃ´ng táº¡o báº£n sao trÃ¹ng láº·p trong danh sÃ¡ch káº¿t quáº£, Ä‘á»“ng thá»i nÃ¢ng cáº¥p Ä‘á»‹nh danh nguá»“n gá»‘c cá»§a seed thÃ nh `google_autocomplete`.
5. **Batch Circuit Breaker Invariant:**
   Gáº·p lá»—i 403 (Forbidden) hoáº·c 429 kÃ©o dÃ i láº­p tá»©c dá»«ng toÃ n bá»™ cÃ¡c truy váº¥n cÃ²n láº¡i trong lÃ´ Ä‘á»ƒ báº£o vá»‡ há»‡ thá»‘ng vÃ  tÃ´n trá»ng chÃ­nh sÃ¡ch endpoint.
6. **Deterministic Cardinality & Ordering Invariant:**
   KhÃ³a cá»©ng cÃ¡c giá»›i háº¡n: tá»‘i Ä‘a 6 seed, tá»‘i Ä‘a 8 gá»£i Ã½/seed, tá»‘i Ä‘a 40 gá»£i Ã½ toÃ n cá»¥c. Thá»© tá»± gá»£i Ã½ giá»¯ nguyÃªn theo thá»© tá»± xáº¿p háº¡ng cá»§a Google (first-seen wins), khÃ´ng sort ABC.
7. **Zero-Network Test Invariant:**
   Bá»™ unit test sá»­ dá»¥ng Mock Client/Fetch, hoÃ n toÃ n khÃ´ng phÃ¡t sinh báº¥t ká»³ káº¿t ná»‘i máº¡ng thá»±c táº¿ nÃ o trong quÃ¡ trÃ¬nh cháº¡y `npm test`.

---

## 4. QuÃ¡ trÃ¬nh phá»‘i há»£p vÃ  Ä‘Ã¡nh giÃ¡ tá»« ChatGPT (Reviewer / Planner)

### VÃ²ng 1 â€” Láº­p káº¿ hoáº¡ch & Thá»‘ng nháº¥t kiáº¿n trÃºc:

- Worker soáº¡n tháº£o Ä‘á» xuáº¥t chi tiáº¿t vá» bá»‘i cáº£nh, interface, giá»›i háº¡n seed vÃ  kháº£ nÄƒng chá»‹u lá»—i.
- ChatGPT pháº£n há»“i báº£n káº¿ hoáº¡ch ká»¹ thuáº­t gá»“m 20 má»¥c Ä‘á»‹nh hÆ°á»›ng, trong Ä‘Ã³ cÃ³ cÃ¡c chá»‰ Ä‘áº¡o mang tÃ­nh quyáº¿t Ä‘á»‹nh:
  1. _KhÃ³a nhÃ£n Ä‘á»‹nh danh:_ Chuáº©n hÃ³a canonical string constants `QUERY_SOURCE` vÃ  cÆ¡ cháº¿ thÄƒng háº¡ng nguá»“n gá»‘c.
  2. _BÃ¡c bá» synthetic suggestions khi fallback:_ Fallback khi Google unavailable pháº£i tráº£ vá» `suggestedQueries: []`, giá»¯ vá»¯ng ranh giá»›i giá»¯a B2 (AI inference) vÃ  B3 (external search evidence).
  3. _Giá»›i háº¡n gá»i máº¡ng:_ Tá»‘i Ä‘a 6 seeds, thá»© tá»± deterministic, khÃ´ng láº·p láº¡i hiá»‡n tÆ°á»£ng bÃ¹ng ná»• token Ä‘Æ¡n láº» tá»« tiÃªu Ä‘á».
  4. _PhÃ¢n Ä‘á»‹nh ranh giá»›i bá»™ lá»c:_ B3 khÃ´ng Ä‘Æ°á»£c copy bá»™ lá»c tá»« cáº¥m cá»§a B2; tá»« khÃ³a `best`, `cheap`, `near me`, `etsy` tá»« Google pháº£i Ä‘Æ°á»£c báº£o tá»“n.
  5. _Quy Ä‘á»‹nh bá»™ ngáº¯t máº¡ch (Circuit Breaker):_ Ngáº¯t ngay láº­p tá»©c khi gáº·p 403 hoáº·c 429 láº·p láº¡i.

### VÃ²ng 2 â€” BÃ¡o cÃ¡o hoÃ n thÃ nh mÃ£ nguá»“n & ÄÃ¡nh giÃ¡ nghiá»‡m thu:

Worker hoÃ n thÃ nh toÃ n bá»™ mÃ£ nguá»“n, cáº¥u hÃ¬nh stage, bá»• sung 30 unit tests Ä‘á»™c láº­p theo ma tráº­n Groups A Ä‘áº¿n Y, cháº¡y sáº¡ch kiá»ƒm thá»­ vÃ  thá»±c hiá»‡n live smoke test vá»›i Google Autocomplete API tháº­t.

**ÄÃ¡nh giÃ¡ chÃ­nh thá»©c tá»« ChatGPT Reviewer:**

```text
Verdict: B3 IMPLEMENTATION APPROVED âœ…

Domain contract                 PASS âœ…
Canonical provenance            PASS âœ…
Seed selection                  PASS âœ…
Max 6 external requests         PASS âœ…
Google response parsing         PASS âœ…
Locale hl/gl                    PASS âœ…
Timeout/retry                   PASS âœ…
403/429 circuit breaker         PASS âœ…
Partial-failure preservation    PASS âœ…
Technical-only filtering        PASS âœ…
Case-insensitive dedupe         PASS âœ…
External text preservation      PASS âœ…
Suggestion==seed upgrade        PASS âœ…
No fabricated Google evidence   PASS âœ…
Offline degraded state          PASS âœ…
Deterministic ordering          PASS âœ…
DI / zero-network unit tests    PASS âœ…
Context immutability            PASS âœ…
B2â†’B3 integration               PASS âœ…
Pipeline regression             PASS âœ…
Live Google happy path          PASS âœ…

Automated tests                 145/145 âœ… reported
TypeScript strict               PASS âœ… reported
Production build                PASS âœ… reported
Mock build                      PASS âœ… reported

Final status:
B1 Product Understanding     âœ… APPROVED
B2 Shopping Context          âœ… APPROVED
B3 Search Suggestions        âœ… APPROVED

ÄÃ³ng nghiá»‡m thu development B3. CÃ³ thá»ƒ chuyá»ƒn sang B4.
```

### LÆ°u Ã½ quan trá»ng cho BÆ°á»›c B4 & B5 downstream:

ChatGPT nháº¥n máº¡nh má»™t phÃ¡t hiá»‡n cÃ³ giÃ¡ trá»‹ tá»« live smoke test: Google cÃ³ thá»ƒ má»Ÿ rá»™ng tá»« khÃ³a sang cÃ¡c truy váº¥n mang tÃ­nh thÃ´ng tin hoáº·c lá»‡ch ngá»¯ nghÄ©a (`how to draw a black cat for halloween`, `do black cats get hurt on halloween`, `vintage black panther t shirt`).  
-> B3 Ä‘Ã£ lÃ m trÃ²n vai trÃ² thu tháº­p external evidence khÃ¡ch quan. Khi chuyá»ƒn sang BÆ°á»›c B4 (Conflict Control) vÃ  BÆ°á»›c B5 (Content Generation), downstream **tuyá»‡t Ä‘á»‘i khÃ´ng Ä‘Æ°á»£c coi má»i query cÃ³ nhÃ£n `google_autocomplete` Ä‘á»u lÃ  tá»« khÃ³a thÃ­ch há»£p Ä‘á»ƒ target**. B4/B5 sáº½ chá»‹u trÃ¡ch nhiá»‡m sÃ ng lá»c má»©c Ä‘á»™ liÃªn quan thÆ°Æ¡ng máº¡i Ä‘áº¿n sáº£n pháº©m.

---

## 5. Káº¿t quáº£ kiá»ƒm thá»­ & xÃ¡c minh (Verification Record)

### 5.1. Báº£ng tá»•ng há»£p lá»‡nh kiá»ƒm tra

| Lá»‡nh kiá»ƒm thá»­                                                                           | Pháº¡m vi               | Káº¿t quáº£                 | Ghi chÃº                                                                        |
| :-------------------------------------------------------------------------------------- | :-------------------- | :---------------------- | :----------------------------------------------------------------------------- |
| `npx tsx --test src/modules/seo-content/__tests__/b3-search-suggestions.test.ts` | B3 Unit Test Suite    | **39/39 PASS** (100%)   | Äáº§y Ä‘á»§ 34 nhÃ³m Groups A Ä‘áº¿n Y vÃ  Z1 Ä‘áº¿n Z9                                     |
| `npm test`                                                                              | ToÃ n bá»™ á»©ng dá»¥ng      | **154/154 PASS** (100%) | ToÃ n bá»™ cÃ¡c module, pipeline integration & orchestrator                        |
| `npm run typecheck`                                                                     | TypeScript Strict     | **PASS (0 errors)**     | `tsc --noEmit` hoÃ n toÃ n sáº¡ch                                                  |
| `npm run build`                                                                         | Vite Production Build | **PASS**                | ÄÃ³ng gÃ³i client bundle thÃ nh cÃ´ng (611ms)                                      |
| `npm run build:mock`                                                                    | Vite Mock Build       | **PASS**                | ÄÃ³ng gÃ³i mock mode thÃ nh cÃ´ng (577ms)                                          |
| `npx tsx src/modules/seo-content/scripts/b3-smoke-test.ts`                       | Live Smoke Test       | **PASS**                | Gá»i Google Autocomplete tháº­t, tráº£ vá» 39 gá»£i Ã½, thÄƒng háº¡ng provenance chuáº©n xÃ¡c |

### 5.2. Chi tiáº¿t káº¿t quáº£ Live Smoke Test (Artifact)

Lá»‡nh thá»±c thi: `npx tsx src/modules/seo-content/scripts/b3-smoke-test.ts`

- **Thá»i gian hoÃ n thÃ nh:** 2524 ms
- **Sá»‘ lÆ°á»£ng háº¡t giá»‘ng nghiÃªn cá»©u:** 6 seeds
- **Sá»‘ lÆ°á»£ng gá»£i Ã½ thu Ä‘Æ°á»£c:** 39 queries
- **Dá»¯ liá»‡u háº¡t giá»‘ng Ä‘Ã£ chá»n:**
  - `vintage black cat t-shirt` [`google_autocomplete`] _(ThÄƒng háº¡ng thÃ nh cÃ´ng nhá» Google tráº£ vá» biáº¿n thá»ƒ chÃ­nh xÃ¡c!)_
  - `black cat halloween t-shirt` [`google_autocomplete`] _(ThÄƒng háº¡ng thÃ nh cÃ´ng!)_
  - `halloween t-shirt` [`buyer_intent_seed`]
  - `gift for cat lover` [`google_autocomplete`] _(ThÄƒng háº¡ng thÃ nh cÃ´ng!)_
  - `black cat t-shirt` [`category_seed`]
  - `halloween` [`google_autocomplete`] _(ThÄƒng háº¡ng thÃ nh cÃ´ng!)_
- **Máº«u truy váº¥n gá»£i Ã½ nháº­n Ä‘Æ°á»£c (10/39):**
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

