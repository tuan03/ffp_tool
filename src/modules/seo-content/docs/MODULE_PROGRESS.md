# BÃ¡o CÃ¡o Tiáº¿n Äá»™ Chi Tiáº¿t â€” Module SEO + Content

> **NgÃ y cáº­p nháº­t:** 22/09/2026  
> **Vá»‹ trÃ­ module:** `src/modules/seo-content`  
> **Tráº¡ng thÃ¡i tá»•ng thá»ƒ:** ÄÃ£ hoÃ n thÃ nh 100% vÃ  kiá»ƒm thá»­ sáº¡ch toÃ n bá»™ pipeline **B1 â†’ B2 â†’ B3 â†’ B4 â†’ B5 â†’ B6** (258/258 unit tests PASS, Typecheck 0 lá»—i, Build sáº¡ch).  
> **Quy trÃ¬nh thá»±c hiá»‡n:** 2-Agent Workflow (ChatGPT Web: Planner & Reviewer | Antigravity: Worker & Coder).

---

## 1. Tá»•ng quan & Ranh giá»›i Kiáº¿n trÃºc

Module **SEO + Content** Ä‘Æ°á»£c Ä‘Ã³ng gÃ³i Ä‘á»™c láº­p theo Ä‘Ãºng tiÃªu chuáº©n kiáº¿n trÃºc cá»§a dá»± Ã¡n (`AGENTS.md`):
* **Há»™p Ä‘en (Black-box)**: Giao tiáº¿p Ä‘á»™c quyá»n qua entry point `src/modules/seo-content/index.ts`, khÃ´ng Ä‘á»ƒ lá»™ báº¥t ká»³ cáº¥u trÃºc hay helper ná»™i bá»™ nÃ o ra ngoÃ i.
* **Public Contract**: 
  * Input: `SeoContentInput` (`images`, `niche`, `title`, `description`, `handle`).
  * Output: `SeoContentOutput` (`productTitle`, `productDescription`, `productSeoTitle`, `productSeoDescription`, `images[]` (WebP + alt), `productHandle`).
* **MÃ´i trÆ°á»ng Runtime & CÃ´ng nghá»‡**:
  * Cháº¡y trÃªn **Node.js runtime** (cho phÃ©p sá»­ dá»¥ng Ä‘áº§y Ä‘á»§ cÃ¡c thÆ° viá»‡n chuáº©n nhÆ° `node:fs`, `node:path`, `node:crypto`, `Buffer`).
  * Sá»­ dá»¥ng **Google Cloud Vertex AI ADC** (dá»± Ã¡n `gemini-image-benchmark`) cho toÃ n bá»™ pipeline: Gemini 2.5 Flash (Vision/OCR), Text Embedding 004 (Vector Semantic Similarity), Gemini LLM (SEO Content Writing).
  * Quy táº¯c báº¥t biáº¿n Zero-Network Test: 100% unit tests cháº¡y Ä‘á»™c láº­p offline khÃ´ng phá»¥ thuá»™c internet hay external API.

---

## 2. Chi tiáº¿t cÃ¡c Logic Ä‘Ã£ triá»ƒn khai (ToÃ n bá»™ Pipeline B1 â†’ B6)

### ðŸŸ¢ Stage B1 â€” PhÃ¢n tÃ­ch sáº£n pháº©m tá»« hÃ¬nh áº£nh (Product Understanding)
* **Má»¥c tiÃªu**: Äá»c hiá»ƒu sÃ¢u thiáº¿t káº¿, chi tiáº¿t Ä‘á»“ há»a vÃ  thuá»™c tÃ­nh cá»§a sáº£n pháº©m tá»« áº£nh/mockup.
* **Logic cá»‘t lÃµi**:
  * TÃ­ch há»£p **Gemini 2.5 Flash Vision** (`@google/genai` Vertex AI client):
    * Nháº­n diá»‡n chá»¯ trÃªn thiáº¿t káº¿ (**OCR texts**).
    * Nháº­n diá»‡n thá»±c thá»ƒ hÃ¬nh áº£nh (**detected entities**: icon, váº­t thá»ƒ, giao diá»‡n...).
    * TrÃ­ch xuáº¥t gam mÃ u chá»§ Ä‘áº¡o (**dominant colors**).
    * Nháº­n diá»‡n phong cÃ¡ch má»¹ thuáº­t (**visual style**).
    * PhÃ¢n loáº¡i sáº£n pháº©m (**product category**).
  * Há»— trá»£ náº¡p áº£nh linh hoáº¡t: Äá»c trá»±c tiáº¿p file cá»¥c bá»™ qua `node:fs` hoáº·c náº¡p URL/Data URI.
  * Bá»™ phÃ¢n tÃ­ch dá»± phÃ²ng táº¥t Ä‘á»‹nh (**Deterministic Heuristic Fallback**): Tá»± Ä‘á»™ng trÃ­ch xuáº¥t tÃ­n hiá»‡u tá»« `title`, `niche`, `description` khi offline hoáº·c khÃ´ng cÃ³ API key.
* **Contract Ä‘áº§u ra**: `context.productUnderstanding`.

### ðŸŸ¢ Stage B2 â€” XÃ¡c Ä‘á»‹nh bá»‘i cáº£nh sáº£n pháº©m & NgÆ°á»i mua (Shopping Context)
* **Má»¥c tiÃªu**: Chuyá»ƒn hÃ³a Ä‘áº·c tÃ­nh hÃ¬nh áº£nh (B1) thÃ nh ngá»¯ cáº£nh thÆ°Æ¡ng máº¡i thá»±c táº¿ vÃ  Ã½ Ä‘á»‹nh mua hÃ ng.
* **Logic cá»‘t lÃµi**:
  * PhÃ¢n tÃ­ch Ä‘á»‘i tÆ°á»£ng khÃ¡ch hÃ ng má»¥c tiÃªu (**targetAudience**).
  * XÃ¡c Ä‘á»‹nh cÃ¡c dá»‹p mua sáº¯m, táº·ng quÃ  phÃ¹ há»£p (**suitableOccasions**).
  * XÃ¡c Ä‘á»‹nh khÃ´ng gian, cÃ´ng nÄƒng sá»­ dá»¥ng (**useCases**).
  * Táº¡o danh sÃ¡ch háº¡t giá»‘ng Ã½ Ä‘á»‹nh ngÆ°á»i mua (**buyerIntentKeywords**): Káº¿t há»£p thá»±c thá»ƒ + ngÃ nh hÃ ng + thuá»™c tÃ­nh sáº£n pháº©m Ä‘á»ƒ táº¡o cÃ¡c cá»¥m tá»« tÃ¬m kiáº¿m thÆ°Æ¡ng máº¡i cÃ³ giÃ¡ trá»‹ cao.
* **Contract Ä‘áº§u ra**: `context.shoppingContext`.

### ðŸŸ¢ Stage B3 â€” Má»Ÿ rá»™ng tá»« khÃ³a tÃ¬m kiáº¿m thá»±c táº¿ (Search Suggestions)
* **Má»¥c tiÃªu**: Thu tháº­p truy váº¥n tÃ¬m kiáº¿m thá»±c táº¿ tá»« ngÆ°á»i dÃ¹ng nháº±m Ä‘á»‘i chiáº¿u nhu cáº§u thá»‹ trÆ°á»ng.
* **Logic cá»‘t lÃµi**:
  * **Google Suggest Client (`UnofficialGoogleSuggestClient`)**: Truy váº¥n trá»±c tiáº¿p Google Autocomplete API (`suggestqueries.google.com`) vá»›i ngÃ´n ngá»¯ vÃ  quá»‘c gia cáº¥u hÃ¬nh (máº·c Ä‘á»‹nh `en`/`us`).
  * **Bá»™ Ä‘á»‡m thÃ´ng minh (`InMemoryGoogleSuggestCache`)**: Há»— trá»£ cÆ¡ cháº¿ LRU + TTL, trÃ¡nh gá»i trÃ¹ng láº·p vÃ  tiáº¿t kiá»‡m quota.
  * **Circuit Breaker**: Tá»± Ä‘á»™ng ngáº¯t batch khi phÃ¡t hiá»‡n rate limit (429) hoáº·c bá»‹ cháº·n (403).
  * **Bá»™ chá»n háº¡t giá»‘ng (`search-seed-selector.ts`)**: Æ¯u tiÃªn chá»n top Buyer Intent Seeds tá»« B2 káº¿t há»£p Niche Seed, Category Seed tá»« B1 (tá»‘i Ä‘a 6 seeds).
  * **Chuáº©n hÃ³a & Khá»­ trÃ¹ng (`search-suggestions-normalizer.ts`)**: Chuáº©n hÃ³a Unicode NFKC, loáº¡i bá» URL, kÃ½ tá»± Ä‘iá»u khiá»ƒn vÃ  trÃ¹ng láº·p chuá»—i.
  * **Fallback táº¥t Ä‘á»‹nh (`FallbackSearchSuggestionsCollector`)**: Báº£o Ä‘áº£m tÃ­nh báº¥t biáº¿n offline trong automated tests (zero-network).
* **Contract Ä‘áº§u ra**: `context.searchResearch` (`seedKeywords`, `suggestedQueries`, `querySources`).

### ðŸŸ¢ Stage B4 â€” Kiá»ƒm soÃ¡t xung Ä‘á»™t & Khá»­ trÃ¹ng láº·p tá»« khÃ³a (Conflict Control)
* **Má»¥c tiÃªu**: Lá»c sáº¡ch tá»« khÃ³a lá»‡ch ngÃ nh, khá»­ trÃ¹ng láº·p ngá»¯ nghÄ©a (cannibalization), cháº¥m Ä‘iá»ƒm tiá»m nÄƒng, gom cá»¥m tá»« khÃ³a vÃ  báº£o vá»‡ quyá»n sá»Ÿ há»¯u tá»« khÃ³a trÃªn toÃ n bá»™ catalog sáº£n pháº©m (Cross-Product Keyword Cannibalization Prevention).
* **Logic cá»‘t lÃµi**:
  * **Kiáº¿n trÃºc Vector-First Hybrid Conflict Engine (Intra-Product)**:
    * **Primary Provider**: Google Vertex AI `text-embedding-004` (768 chiá»u). NhÃºng tÃ i liá»‡u tham chiáº¿u sáº£n pháº©m Ä‘a táº§ng (Dual Reference: Product Identity & Shopping Intent) vÃ  nhÃºng toÃ n bá»™ candidate queries.
    * **Fallback Provider**: `LocalTfidfVectorizer` (káº¿t há»£p unigram trá»ng sá»‘ 2.0, bigram 2.5, char 3-gram 0.5, tá»« Ä‘iá»ƒn chuáº©n hÃ³a Ä‘á»“ng nghÄ©a) Ä‘áº£m báº£o offline unit test cháº¡y Ä‘á»™c láº­p.
    * **Single-Vector-Space Invariant**: 100% vector so sÃ¡nh trong má»™t phiÃªn pháº£i thuá»™c cÃ¹ng má»™t provider/model; náº¿u Primary lá»—i thÃ¬ fallback toÃ n bá»™, khÃ´ng bao giá» lai táº¡p.
  * **Khá»­ trÃ¹ng láº·p ngá»¯ nghÄ©a dá»±a trÃªn Ä‘áº¡i diá»‡n (Representative-Based Incremental Clustering)**:
    * Sáº¯p xáº¿p á»©ng viÃªn theo Ä‘iá»ƒm liÃªn quan, provenance vÃ  Ä‘á»™ dÃ i thÆ°Æ¡ng máº¡i.
    * á»¨ng viÃªn top 1 lÃ m Leader cá»§a cá»¥m; cÃ¡c á»©ng viÃªn sau chá»‰ so sÃ¡nh vá»›i Leader cá»§a cÃ¡c cá»¥m hiá»‡n há»¯u (loáº¡i trá»« lá»—i over-merge lan truyá»n cá»§a DSU).
  * **Bá»™ lá»c xung Ä‘á»™t Ä‘a táº§ng cÃ³ thá»© báº­c Æ°u tiÃªn cá»‘ Ä‘á»‹nh (Deterministic Precedence)**:
    1. `exact_duplicate`: TrÃ¹ng chuá»—i chÃ­nh xÃ¡c trong cÃ¹ng session.
    2. `brand_conflict`: Cáº¥m nhÃ£n hiá»‡u báº£n quyá»n (Nike, Disney, v.v.).
    3. `existing_url_cannibalization`: TrÃ¡nh xung Ä‘á»™t vá»›i sáº£n pháº©m/URL Ä‘Ã£ cÃ³ trÃªn catalog toÃ n site.
    4. `category_conflict`: Loáº¡i trá»« lá»‡ch ngÃ nh (vÃ­ dá»¥: gáº¡t bá» `rugby` khi sáº£n pháº©m lÃ  tháº£m `rug`).
    5. `search_intent_mismatch`: Loáº¡i bá» tá»« khÃ³a thÃ´ng tin phi thÆ°Æ¡ng máº¡i ("how to draw", "tutorial").
    6. `semantic_drift_irrelevant`: Loáº¡i bá» tá»« khÃ³a cÃ³ Ä‘iá»ƒm vector quÃ¡ tháº¥p (< 0.54).
    7. `semantic_duplicate`: Khá»­ trÃ¹ng láº·p ngá»¯ nghÄ©a ná»™i bá»™.
  * **CÆ¡ sá»Ÿ dá»¯ liá»‡u Danh má»¥c ToÃ n site (`FileSeoConflictCorpus`) & Cross-Product Cannibalization**:
    * Quáº£n lÃ½ quyá»n sá»Ÿ há»¯u tá»« khÃ³a site-wide qua file JSON cÃ³ versioning (`schemaVersion: 1`, `revision`, `updatedAt`).
    * Ghi file nguyÃªn tá»­ (Atomic write qua temp file + `fsync` + `fs.rename`) vÃ  khÃ³a file (`corpus-file-lock.ts`) chá»‘ng race condition giá»¯a cÃ¡c process.
    * Há»— trá»£ Optimistic Concurrency Control qua `expectedRevision` chá»‘ng ghi Ä‘Ã¨ dá»¯ liá»‡u cÅ© (`CorpusRevisionConflictError`).
    * Replace-not-append claim set ngÄƒn ngá»«a zombie/ghost keywords; `removeProduct` giáº£i phÃ³ng quyá»n sá»Ÿ há»¯u tá»« khÃ³a; `isSameProduct` chá»‘ng tá»± xung Ä‘á»™t khi rerun cÃ¹ng sáº£n pháº©m.
    * ÄÃ¡nh giÃ¡ vÃ¹ng xÃ¡m ngá»¯ cáº£nh (`contextual-conflict-evaluator.ts`): Äá»™ tÆ°Æ¡ng Ä‘á»“ng trong khoáº£ng $[0.86, 0.90)$ Ä‘á»‘i vá»›i primary keyword Ä‘Æ°á»£c Ä‘á»‘i chiáº¿u sÃ¢u vá» category vÃ  search intent.
  * **LÃ m giÃ u siÃªu dá»¯ liá»‡u cho B5**: Xuáº¥t kÃ¨m báº£ng Ä‘iá»ƒm `relevanceScores`, danh sÃ¡ch phÃ¢n cá»¥m `keywordClusters` vÃ  `corpusRevision`.
* **Contract Ä‘áº§u ra**: `context.conflictResult` (`approvedKeywords`, `discardedKeywords`, `conflictReasons`, `relevanceScores`, `keywordClusters`, `corpusRevision`).

### ðŸŸ¢ Stage B5 â€” Sinh ná»™i dung chuáº©n SEO (Content Generation)
* **Má»¥c tiÃªu**: Táº¡o trá»n bá»™ ná»™i dung thÆ°Æ¡ng máº¡i Ä‘iá»‡n tá»­ chuáº©n SEO (Title, Description HTML, Meta SEO Title, Meta SEO Description, URL Slug) dá»±a trÃªn Fact Sheet chÃ¢n thá»±c vÃ  phÃ¢n bá»• tá»« khÃ³a Ä‘a táº§ng.
* **Logic cá»‘t lÃµi**:
  * **Fact Sheet Báº¥t biáº¿n (`content-fact-sheet.ts`)**: TrÃ­ch xuáº¥t dá»¯ kiá»‡n cÃ³ cÄƒn cá»© (Grounded Facts) tá»« B1-B4, ngÄƒn cháº·n hoÃ n toÃ n áº£o giÃ¡c (anti-hallucination).
  * **Bá»™ phÃ¢n bá»• tá»« khÃ³a 3 táº§ng (`keyword-allocator.ts`)**:
    * **Tier 1 (Primary/Focus Keyword)**: DÃ nh riÃªng cho SEO Title, H1 vÃ  URL Slug.
    * **Tier 2 (Secondary Keywords)**: Tá»‘i Ä‘a 2-3 tá»« khÃ³a tÃ­ch há»£p tá»± nhiÃªn vÃ o Bullet Points vÃ  pháº§n má»Ÿ Ä‘áº§u mÃ´ táº£.
    * **Tier 3 (Supporting Keywords)**: DÃ nh cho pháº§n chi tiáº¿t vÃ  Alt text cá»§a Stage B6.
  * **Kiáº¿n trÃºc Dual Engine (`GeminiSeoContentGenerator` & `HeuristicContentGenerator`)**:
    * **Primary Engine**: Google Vertex AI Gemini 2.5 vá»›i Structured JSON Schema output.
    * **Fallback Engine**: Template-based Heuristic Generator vá»›i tá»« vá»±ng tá»± nhiÃªn, Ä‘áº£m báº£o 100% offline unit tests cháº¡y Ä‘á»™c láº­p khÃ´ng phá»¥ thuá»™c network.
  * **Bá»™ cÄƒn chá»‰nh Ä‘á»™ dÃ i táº¥t Ä‘á»‹nh (`content-fitters.ts`)**:
    * `fitSeoTitle`: Cáº¯t tá»‰a an toÃ n theo ranh giá»›i tá»« $\le 70$ kÃ½ tá»±, báº£o toÃ n tá»« khÃ³a chÃ­nh.
    * `fitSeoDescription`: Cáº¯t tá»‰a an toÃ n $\le 160$ kÃ½ tá»± kÃ¨m Call-To-Action háº¥p dáº«n.
    * `fitProductTitle`: CÄƒn chá»‰nh tiÃªu Ä‘á» hiá»ƒn thá»‹ $\le 80$ kÃ½ tá»±.
    * `generateProductHandle`: Chuáº©n hÃ³a URL slug $\le 80$ kÃ½ tá»±, báº£o toÃ n URL hiá»‡n há»¯u náº¿u Ä‘Ã£ cÃ³.
  * **Äá»‹nh dáº¡ng HTML MÃ´ táº£ Shopify (`html-description-formatter.ts`)**:
    * Táº¡o cáº¥u trÃºc ngá»¯ nghÄ©a sáº¡ch (`<h2>`, `<p>`, `<ul>`, `<li>`), tuyá»‡t Ä‘á»‘i khÃ´ng dÃ¹ng inline CSS hoáº·c class láº¡.
  * **Kiá»ƒm tra & Tháº©m Ä‘á»‹nh ná»™i dung cuá»‘i (`content-result-validator.ts`)**:
    * Kiá»ƒm tra Ä‘á»™ dÃ i, kiá»ƒm tra hiá»‡n diá»‡n tá»« khÃ³a chÃ­nh, kiá»ƒm tra rÃ² rá»‰ tá»« khÃ³a bá»‹ cáº¥m (discarded keywords), phÃ¡t hiá»‡n áº£o giÃ¡c cháº¥t liá»‡u/kÃ­ch thÆ°á»›c.
* **Contract Ä‘áº§u ra**: `context.contentResult` & `context.contentGenerationMetadata`.

### ðŸŸ¢ Stage B6 â€” Tá»‘i Æ°u hÃ³a hÃ¬nh áº£nh & Alt Text (Image Processing & Alt Text)
* **Má»¥c tiÃªu**: Chuyá»ƒn Ä‘á»•i áº£nh sang chuáº©n WebP, sinh tÃªn file chuáº©n SEO táº¥t Ä‘á»‹nh, táº¡o Alt text giÃ u ngá»¯ cáº£nh khÃ´ng nhá»“i nhÃ©t tá»« khÃ³a ($\le 125$ kÃ½ tá»±), báº£o Ä‘áº£m an toÃ n SSRF vÃ  kháº£ nÄƒng hoáº¡t Ä‘á»™ng offline.
* **Logic cá»‘t lÃµi**:
  * **Sinh tÃªn file WebP chuáº©n SEO (`webp-filename-generator.ts`)**:
    * Äá»‹nh dáº¡ng táº¥t Ä‘á»‹nh: `${handle}-${index + 1}.webp`.
    * Chá»‘ng Path Traversal báº±ng `path.basename` vÃ  chuáº©n hÃ³a kÃ½ tá»± `cleanSlug`.
  * **Táº¡o Alt Text ngá»¯ cáº£nh cÃ³ cÄƒn cá»© (`alt-text-generator.ts`)**:
    * Æ¯u tiÃªn 1: `sourceAlt` gá»‘c cá»§a ngÆ°á»i dÃ¹ng náº¿u cÃ³ Ã½ nghÄ©a.
    * Æ¯u tiÃªn 2: Káº¿t há»£p `productTitle` + `primaryKeyword` + tá»‘i Ä‘a 1-2 thá»±c thá»ƒ thá»‹ giÃ¡c chÃ¢n thá»±c tá»« B1.
    * Phong cÃ¡ch: Lá»c bá» cÃ¡c phong cÃ¡ch khÃ´ng tá»± nhiÃªn (`vector art`, `clipart`), chá»‰ giá»¯ phong cÃ¡ch phÃ¹ há»£p (`vintage`, `retro`, `minimalist`).
    * Äáº£m báº£o tÃ­nh Ä‘á»™c nháº¥t trong thÆ° viá»‡n áº£nh (`ensureGalleryUniqueness`): áº¢nh phá»¥ Ä‘Æ°á»£c Ä‘Ã¡nh sá»‘ View vÃ  trá»« hao ngÃ¢n sÃ¡ch Ä‘á»™ dÃ i trÆ°á»›c khi cáº¯t tá»‰a Ä‘á»ƒ khÃ´ng bao giá» vÆ°á»£t tráº§n 125 kÃ½ tá»±.
    * Cáº¯t tá»‰a an toÃ n ranh giá»›i tá»« qua `alt-text-fitter.ts` ($\le 125$ kÃ½ tá»±).
    * Bá»™ lá»c lÃ m sáº¡ch Alt (`alt-text-sanitizer.ts`): BÃ³c tÃ¡ch HTML, kÃ½ tá»± Ä‘iá»u khiá»ƒn, URL, kÃ½ tá»± surrogate-pair UTF-16 an toÃ n (`characterLength`).
  * **Kiá»ƒm Ä‘á»‹nh & Chuyá»ƒn Ä‘á»•i WebP (`webp-validator.ts`, `webp-converter.ts`)**:
    * Kiá»ƒm Ä‘á»‹nh Magic Bytes: Báº¯t buá»™c 4 bytes Ä‘áº§u lÃ  `RIFF` vÃ  4 bytes táº¡i offset 8 lÃ  `WEBP`.
    * `DeterministicTestWebpConverter`: Tráº£ vá» fixture 42-byte WebP chuáº©n cho automated tests (zero-network).
    * `SharpWebpConverter`: TÃ­ch há»£p thÆ° viá»‡n Sharp qua dynamic import reflection chá»‘ng lá»—i TS compile khi thÆ° viá»‡n lÃ  optional runtime dependency.
    * `UnavailableWebpConverter`: Tráº£ lá»—i rÃµ rÃ ng khi khÃ´ng cÃ³ runtime chuyá»ƒn Ä‘á»•i áº£nh.
    * NguyÃªn táº¯c báº¥t biáº¿n khÃ´ng bá»‹a Ä‘áº·t dá»¯ liá»‡u (Never Fake WebP Bytes): Náº¿u chuyá»ƒn Ä‘á»•i tháº¥t báº¡i á»Ÿ cháº¿ Ä‘á»™ lenient, khÃ´ng bao giá» giáº£ máº¡o `.data` hay `.localFilePath`.
  * **Náº¡p áº£nh an toÃ n chá»‘ng SSRF (`image-source-loader.ts`)**:
    * Há»— trá»£ file cá»¥c bá»™, data URI, vÃ  remote HTTP.
    * PhÃ²ng thá»§ SSRF chuyÃªn sÃ¢u: Kiá»ƒm tra DNS/IP cáº¥m loopback (`127.0.0.1`), link-local (`169.254.x`), private IP (`10.x`, `192.168.x`).
    * **Thanh tra chuyá»ƒn hÆ°á»›ng (Manual Redirect Hop Inspection)**: Cáº¥u hÃ¬nh `fetch({ redirect: "manual" })`, kiá»ƒm tra tá»«ng bÆ°á»›c chuyá»ƒn hÆ°á»›ng (301, 302, 307, 308) qua hÃ m `validateSafeUrl` vÃ  giá»›i háº¡n tá»‘i Ä‘a 3 hops chá»‘ng chuyá»ƒn hÆ°á»›ng Ä‘á»™c háº¡i vÃ o máº¡ng ná»™i bá»™.
  * **LÆ°u trá»¯ áº£nh nguyÃªn tá»­ (`image-artifact-sink.ts`)**:
    * `FileSystemImageSink`: Ghi file vÃ o thÆ° má»¥c temp ngáº«u nhiÃªn trÆ°á»›c khi rename nguyÃªn tá»­ sang file Ä‘Ã­ch, báº£o vá»‡ chá»‘ng race condition vÃ  path traversal.
    * `MemoryImageSink`: LÆ°u trá»¯ in-memory cho mÃ´i trÆ°á»ng test vÃ  serverless.
  * **Bá»™ xá»­ lÃ½ áº£nh tuáº§n tá»± (`image-processor.ts`)**:
    * Xá»­ lÃ½ tá»«ng áº£nh tuáº§n tá»±, phÃ¢n tÃ¡ch cháº¿ Ä‘á»™ `lenient` (lá»—i 1 áº£nh khÃ´ng lÃ m sáº­p pipeline) vÃ  `strict` (nÃ©m lá»—i ngay).
* **Contract Ä‘áº§u ra**: `context.imageResult` & `context.imageProcessingMetadata`.

---

## 3. Nhá»¯ng Äiá»ƒm Ká»¹ Thuáº­t ÄÃ£ Chá»‘t (Architectural Decisions)

1. **TuÃ¢n thá»§ triá»‡t Ä‘á»ƒ AGENTS.md**: Cáº¥u trÃºc module pháº³ng, TypeScript strict mode, 0 lá»—i typecheck, build pass sáº¡ch sáº½.
2. **Quy táº¯c Báº¥t biáº¿n Offline trong Automated Tests (Zero-Network Test Invariant)**:
   * ToÃ n bá»™ 258 bÃ i test tá»± Ä‘á»™ng cháº¡y Ä‘á»™c láº­p 100% khÃ´ng gá»i internet, khÃ´ng phá»¥ thuá»™c Google Cloud hay external API.
3. **SSRF Redirect Hop Validation Invariant**:
   * Tuyá»‡t Ä‘á»‘i khÃ´ng cho phÃ©p HTTP client tá»± Ä‘á»™ng follow redirect má»™t cÃ¡ch mÃ¹ quÃ¡ng. Tá»«ng URL chuyá»ƒn hÆ°á»›ng Ä‘á»u pháº£i qua bá»™ lá»c an toÃ n máº¡ng ná»™i bá»™.
4. **Gallery Alt Uniqueness Budget Reservation**:
   * Khi thÃªm háº­u tá»‘ Ä‘á»™c nháº¥t cho áº£nh trong thÆ° viá»‡n (vÃ­ dá»¥ `, view 2`), Ä‘á»™ dÃ i háº­u tá»‘ pháº£i Ä‘Æ°á»£c trá»« trÆ°á»›c vÃ o ngÃ¢n sÃ¡ch 125 kÃ½ tá»±: `fitAltText(text, 125 - suffixLen) + suffix`, Ä‘áº£m báº£o Alt text luÃ´n káº¿t thÃºc trá»n váº¹n vÃ  khÃ´ng bao giá» vÆ°á»£t quÃ¡ 125 kÃ½ tá»±.
5. **Never Fake WebP Bytes Invariant**:
   * Khi khÃ´ng cÃ³ engine chuyá»ƒn Ä‘á»•i hoáº·c chuyá»ƒn Ä‘á»•i gáº·p lá»—i á»Ÿ cháº¿ Ä‘á»™ lenient, há»‡ thá»‘ng ghi nháº­n issue vÃ  báº£o toÃ n URL gá»‘c, tuyá»‡t Ä‘á»‘i khÃ´ng gÃ¡n buffer giáº£ máº¡o hoáº·c Ä‘Æ°á»ng dáº«n file khÃ´ng tá»“n táº¡i.

---

## 4. Nhá»¯ng Lá»—i ÄÃ£ PhÃ¡t Hiá»‡n & ÄÃ£ Kháº¯c Phá»¥c (Bug Fixes & Hardening)

| STT | Lá»—i phÃ¡t hiá»‡n | NguyÃªn nhÃ¢n gá»‘c rá»… | Giáº£i phÃ¡p Ä‘Ã£ kháº¯c phá»¥c |
|:---:|---|---|---|
| 1 | **UI hiá»ƒn thá»‹ "0 káº¿t quáº£" gá»£i Ã½ Google Autocomplete** | Trong `b3-search-suggestions.ts`, Ä‘iá»u kiá»‡n `arg.includes("test")` bá»‹ kÃ­ch hoáº¡t nháº§m khi tham sá»‘ truyá»n vÃ o chá»©a Ä‘Æ°á»ng dáº«n áº£nh náº±m trong thÆ° má»¥c `__tests__\media`. | Sá»­a logic nháº­n diá»‡n test runner thÃ nh kiá»ƒm tra cá» `--test` cá»§a Node/tsx hoáº·c Ä‘uÃ´i file `.test.ts`. ThÃªm `set SEO_SEARCH_PROVIDER=google` vÃ o `test.cmd`. |
| 2 | **Bá» qua ngÆ°á»¡ng `relevanceReject` trong VÃ¹ng XÃ¡m B4** | Trong `keyword-relevance-evaluator.ts`, code viáº¿t `if (hasAnchor && relevanceScore > 0)` khiáº¿n tá»« khÃ³a trÃ´i dáº¡t ngá»¯ nghÄ©a nhÆ°ng cÃ³ dÃ­nh 1 tá»« anchor váº«n bá»‹ duyá»‡t. | KhÃ³a cháº·t Ä‘iá»u kiá»‡n: `relevanceScore >= thresholds.relevanceReject && hasAnchor`. Hiá»‡u chuáº©n `relevanceReject = 0.01` cho local sparse vector. |
| 3 | **Crash Regex khi gáº·p kÃ½ tá»± Ä‘áº·c biá»‡t (Metacharacters)** | `new RegExp(\`\\b\${brand}\\b\`)` gáº·p cÃ¡c nhÃ£n hiá»‡u hoáº·c thá»±c thá»ƒ cÃ³ kÃ½ tá»± `+`, `(`, `[`, `*` (vÃ­ dá»¥ `Disney+`, `C++`, `cat (spooky)`) sáº½ nÃ©m `SyntaxError`. | XÃ¢y dá»±ng hÃ m tiá»‡n Ã­ch `safeWordBoundaryRegex` vÃ  `escapeRegex`, tá»± Ä‘á»™ng escape toÃ n bá»™ metacharacter vÃ  chá»‰ Ä‘áº·t `\b` khi kÃ½ tá»± biÃªn lÃ  word character. |
| 4 | **Lá»‡ch Alias Provider ID giá»¯a Vertex AI vÃ  Corpus** | `VertexTextEmbeddingProvider` dÃ¹ng `providerId = "vertex"` trong khi analyzer kiá»ƒm tra `"vertex_ai"`, lÃ m metadata vector bá»‹ gÃ¡n nháº§m thÃ nh `"local_tfidf"`. | Chuáº©n hÃ³a `providerId = "vertex_ai"` vÃ  cáº­p nháº­t `isEmbeddingCompatible` cháº¥p nháº­n tÆ°Æ¡ng thÃ­ch chÃ©o giá»¯a 2 alias. |
| 5 | **Bá» sÃ³t xung Ä‘á»™t khi embedding khÃ´ng tÆ°Æ¡ng thÃ­ch** | Trong `FileSeoConflictCorpus`, Ä‘iá»u kiá»‡n `if (!lookup.embedding || !kw.embedding)` khÃ´ng bao quÃ¡t trÆ°á»ng há»£p cáº£ hai Ä‘á»u cÃ³ embedding nhÆ°ng khÃ´ng tÆ°Æ¡ng thÃ­ch nhau. | Bá»• sung cá» `canCompareDense`: kÃ­ch hoáº¡t Tier 2b Token Jaccard vá»›i synonym map (`extractCanonicalTokens`) khi khÃ´ng thá»ƒ so sÃ¡nh vector dÃ y. |
| 6 | **Sharp Module Resolution trong TypeScript** | `sharp` lÃ  optional native dependency khÃ´ng cÃ³ sáºµn trong `package.json`, dÃ¹ng `import("sharp")` tÄ©nh khiáº¿n `npm run typecheck` bÃ¡o lá»—i TS2307. | Chuyá»ƒn sang dynamic import reflection qua `new Function("specifier", "return import(specifier)")`, Ä‘áº£m báº£o typecheck 0 lá»—i á»Ÿ cáº£ development láº«n build. |
| 7 | **Lá»— há»•ng SSRF qua HTTP Redirects** | `fetch()` máº·c Ä‘á»‹nh tá»± Ä‘á»™ng theo redirect dáº«n Ä‘áº¿n nguy cÆ¡ hacker redirect tá»« URL ngoÃ i vÃ o IP ná»™i bá»™ `127.0.0.1` hoáº·c metadata server `169.254.169.254`. | Äáº·t `redirect: "manual"`, bÃ³c tÃ¡ch header `Location` táº¡i má»—i hop vÃ  kiá»ƒm tra qua `validateSafeUrl()`. Tá»‘i Ä‘a 3 hops. |
| 8 | **Alt Text vÆ°á»£t tráº§n 125 kÃ½ tá»± khi thÃªm háº­u tá»‘ Gallery** | Khi ná»‘i `, view 2` vÃ o má»™t Alt text Ä‘Ã£ dÃ i 125 kÃ½ tá»±, káº¿t quáº£ thÃ nh 133 kÃ½ tá»± (vÆ°á»£t tráº§n). Náº¿u cáº¯t tá»‰a sau khi ná»‘i, háº­u tá»‘ view bá»‹ cá»¥t máº¥t Ä‘uÃ´i. | Trá»« Ä‘á»™ dÃ i háº­u tá»‘ vÃ o ngÃ¢n sÃ¡ch trÆ°á»›c khi cáº¯t tá»‰a: `fitAltText(text, maxLength - suffixLength) + suffix`. |
| 9 | **Sparse Product Alt Text Fallback** | Khi `source.title` chá»‰ cÃ³ khoáº£ng tráº¯ng, há»‡ thá»‘ng fallback vá» tiÃªu Ä‘á» sáº£n pháº©m do AI sinh thay vÃ¬ rÆ¡i vÃ o fallback chung `Product image 1`. | ThÃªm kiá»ƒm tra `!trimmedSourceTitle` trÆ°á»›c khi chá»n nguá»“n tiÃªu Ä‘á» Ä‘á»ƒ cÃ¡c test há»“i quy cÆ¡ sá»Ÿ cháº¡y á»•n Ä‘á»‹nh. |

---

## 5. Káº¿t Quáº£ Kiá»ƒm Thá»­ & Nghiá»‡m Thu

### 5.1. Kiá»ƒm thá»­ tá»± Ä‘á»™ng (Automated Verification)
* **Unit Tests (`npm test`)**: **258/258 tests PASS 100%** (0 failed, 0 skipped, thá»i gian cháº¡y ~4.1s).
  * Stage B1 Tests: 43 tests (Gemini Vision, OCR, Fallback, Payloads, Retries).
  * Stage B2 Tests: 33 tests (Shopping Context, Audience, Occasions, Buyer Intent Seeds).
  * Stage B3 Tests: 39 tests (Google Suggest Client, LRU Cache, Circuit Breaker, Normalizer, Collector).
  * Stage B4 Tests: 56 tests (Intra-product Vector Embedding, Clustering, Guards, File Catalog Database, Concurrency Lock, Stale Revision Retries).
  * Stage B5 Tests: 20 tests (Fact Sheet, Keyword Allocation, Fitters, HTML Description, LLM + Heuristic Generators, Content Validator).
  * Stage B6 Tests: 28 tests (WebP Filename, Alt Sanitizer & Fitter & Generator, WebP Magic Bytes, Test & Sharp Converters, SSRF Redirect Hop Guard, File & Memory Sinks, Image Processor).
  * Pipeline & Orchestrator Integration Tests: 39 tests.
* **Typecheck (`npm run typecheck`)**: **0 lá»—i** (TypeScript strict mode, tuyá»‡t Ä‘á»‘i khÃ´ng dÃ¹ng `any`, khÃ´ng `ts-ignore`).
* **Production Build (`npm run build`)**: Build thÃ nh cÃ´ng trong 940ms.
* **Mock Build (`npm run build:mock`)**: Build thÃ nh cÃ´ng trong 620ms.
* **Nghiá»‡m thu 2-Agent (ChatGPT Web)**:
  * Stage B5: ÄÃ£ nghiá»‡m thu vÃ  phÃª duyá»‡t.
  * Stage B6: **`STAGE B6 â€” APPROVED âœ… B1 â†’ B6 IMPLEMENTATION COMPLETE âœ…`** (toÃ n bá»™ 6 stages Ä‘Ã£ hoÃ n thiá»‡n).

### 5.2. Kiá»ƒm thá»­ trá»±c quan thá»±c táº¿ (Visual Inspection qua `b1-visual-inspect.ts`)
ÄÃ£ thá»±c thi script trá»±c quan `npx tsx src/modules/seo-content/scripts/b1-visual-inspect.ts` cháº¡y trá»n váº¹n toÃ n bá»™ 6 bÆ°á»›c B1 $\rightarrow$ B6:
1. **B1**: Nháº­n diá»‡n OCR, thá»±c thá»ƒ thá»‹ giÃ¡c, gam mÃ u, phong cÃ¡ch vÃ  phÃ¢n loáº¡i.
2. **B2**: XÃ¡c Ä‘á»‹nh khÃ¡ch hÃ ng má»¥c tiÃªu, dá»‹p mua sáº¯m, cÃ´ng nÄƒng sá»­ dá»¥ng, háº¡t giá»‘ng Ã½ Ä‘á»‹nh.
3. **B3**: Thu tháº­p 31 gá»£i Ã½ tá»« Google Autocomplete API kÃ¨m nguá»“n gá»‘c xuáº¥t xá»©.
4. **B4**: PhÃª duyá»‡t 34 tá»« khÃ³a hÃ ng Ä‘áº§u kÃ¨m Ä‘iá»ƒm liÃªn quan, phÃ¢n cá»¥m ngá»¯ nghÄ©a, loáº¡i bá» 2 tá»« khÃ³a trÃ¹ng láº·p ngá»¯ nghÄ©a.
5. **B5**: Sinh tiÃªu Ä‘á» sáº£n pháº©m, SEO Meta Title (43/70 chars), SEO Meta Description (127/160 chars), URL slug `/products/vintage-halloween-black-cat-t-shirt`, vÃ  mÃ´ táº£ Shopify HTML chuáº©n ngá»¯ nghÄ©a.
6. **B6**: Tá»‘i Æ°u hÃ³a áº£nh sang WebP (`vintage-halloween-black-cat-t-shirt-1.webp`), Alt text chuáº©n SEO tiáº¿p cáº­n `"Vintage Halloween Black Cat T-Shirt"` (35/125 chars).
7. **Giao diá»‡n HTML Preview**: ToÃ n bá»™ dá»¯ liá»‡u 6 stages Ä‘Æ°á»£c render Ä‘áº¹p máº¯t, trá»±c quan vÃ  responsive táº¡i [`b1-visual-preview.html`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/b1-visual-preview.html).

---

## 6. Káº¿ Hoáº¡ch BÆ°á»›c Káº¿ Tiáº¿p

ToÃ n bá»™ lÃµi pipeline **B1 $\rightarrow$ B6 cá»§a Module SEO + Content Ä‘Ã£ hoÃ n thÃ nh 100%**:
1. TÃ­ch há»£p module SEO Content vÃ o **Orchestrator** cá»§a á»©ng dá»¥ng (`src/modules/orchestrator`).
2. Káº¿t ná»‘i vá»›i giao diá»‡n á»©ng dá»¥ng (Application UI / Pages) Ä‘á»ƒ ngÆ°á»i dÃ¹ng cÃ³ thá»ƒ táº£i lÃªn áº£nh hoáº·c nháº­p URL sáº£n pháº©m vÃ  nháº­n káº¿t quáº£ SEO toÃ n diá»‡n má»™t cÃ¡ch trá»±c quan.

