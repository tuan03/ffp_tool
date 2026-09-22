# BÃ¡o cÃ¡o Triá»ƒn khai Stage B4: Keyword Conflict Control & Deduplication Engine (Äá»™ng cÆ¡ Kiá»ƒm soÃ¡t Xung Ä‘á»™t & Khá»­ trÃ¹ng láº·p Tá»« khÃ³a)

## 1. Giá»›i thiá»‡u tá»•ng quan

Stage B4 trong pipeline SEO Content chá»‹u trÃ¡ch nhiá»‡m nháº­n toÃ n bá»™ táº­p há»£p háº¡t giá»‘ng vÃ  gá»£i Ã½ tÃ¬m kiáº¿m (tá»« Google Autocomplete, Buyer Intent Seeds, Niche Seeds á»Ÿ B3), sau Ä‘Ã³ thá»±c hiá»‡n sÃ ng lá»c thÃ´ng minh:

- Loáº¡i bá» tá»« khÃ³a trÃ¹ng láº·p chÃ­nh xÃ¡c (Exact Deduplication) vÃ  trÃ¹ng láº·p ngá»¯ nghÄ©a (Semantic Duplicate / Keyword Cannibalization).
- NgÄƒn cháº·n hiá»‡n tÆ°á»£ng xung Ä‘á»™t phÃ¢n loáº¡i (Category Conflict - vÃ­ dá»¥ "rugby" nháº§m thÃ nh "rug", "cat food" nháº§m vá»›i thá»i trang).
- NgÄƒn cháº·n cÃ¡c truy váº¥n Ã½ Ä‘á»‹nh thÃ´ng tin phi thÆ°Æ¡ng máº¡i (Search Intent Mismatch - vÃ­ dá»¥ "how to draw", "tutorial", "history of").
- Loáº¡i trá»« nhÃ£n hiá»‡u vi pháº¡m báº£n quyá»n (Brand Conflict Guard - vÃ­ dá»¥ "Nike", "Disney", "Jordan").
- NgÄƒn ngá»«a hiá»‡n tÆ°á»£ng tá»± triá»‡t tiÃªu URL ná»™i bá»™ (Existing URL Cannibalization - khi Ä‘á»‘i chiáº¿u vá»›i chá»‰ má»¥c SEO site-wide).
- Sáº¯p xáº¿p thá»© háº¡ng tá»« khÃ³a Ä‘Æ°á»£c duyá»‡t (Deterministic Ranking) dá»±a trÃªn Ä‘iá»ƒm tÆ°Æ¡ng Ä‘á»“ng ngá»¯ nghÄ©a, nguá»“n gá»‘c xuáº¥t xá»© (provenance) vÃ  Ä‘á»™ dÃ i thÆ°Æ¡ng máº¡i lÃ½ tÆ°á»Ÿng.

---

## 2. Kiáº¿n trÃºc & Thuáº­t toÃ¡n: Vector-First Hybrid Conflict Engine

Theo yÃªu cáº§u Æ°u tiÃªn thuáº­t toÃ¡n vector tá»« Leader vÃ  báº£n thiáº¿t káº¿ Ä‘Ã£ Ä‘Æ°á»£c ChatGPT Web phÃª duyá»‡t, Stage B4 triá»ƒn khai kiáº¿n trÃºc **Vector-First Hybrid Conflict Engine**:

### 2.1. KhÃ´ng gian Vector Nháº¥t quÃ¡n (Single-Vector-Space Invariant)

ToÃ n bá»™ cÃ¡c vector so sÃ¡nh trong má»™t phiÃªn phÃ¢n tÃ­ch pháº£i Ä‘áº¿n tá»« **100% cÃ¹ng má»™t nhÃ  cung cáº¥p (provider) vÃ  cÃ¹ng má»™t khÃ´ng gian nhÃºng (embedding space)**:

- **Primary Provider**: Google Vertex AI `text-embedding-004` (768 chiá»u).
- **Task Types**:
  - `RETRIEVAL_DOCUMENT`: NhÃºng vÄƒn báº£n tham chiáº¿u sáº£n pháº©m (Dual Reference: Product Identity vÃ  Shopping Intent).
  - `RETRIEVAL_QUERY`: NhÃºng cÃ¡c tá»« khÃ³a truy váº¥n ngÆ°á»i dÃ¹ng (User Queries).
  - `SEMANTIC_SIMILARITY`: NhÃºng pairwise giá»¯a cÃ¡c tá»« khÃ³a Ä‘á»ƒ Ä‘o Ä‘á»™ trÃ¹ng láº·p ngá»¯ nghÄ©a.
- **Fallback Provider**: Bá»™ vector hÃ³a cá»¥c bá»™ táº¥t Ä‘á»‹nh `LocalTfidfVectorizer` (káº¿t há»£p unigram trá»ng sá»‘ 2.0, bigram trá»ng sá»‘ 2.5, char 3-gram trá»ng sá»‘ 0.5, tá»« Ä‘iá»ƒn chuáº©n hÃ³a Ä‘á»“ng nghÄ©a `retro->vintage`, `tee->t-shirt`, L2 normalization).
- **Quy táº¯c báº¥t biáº¿n**: Náº¿u Primary Provider gáº·p sá»± cá»‘ (máº¥t máº¡ng, háº¿t háº¡n ngáº¡ch 503/429), há»‡ thá»‘ng **há»§y bá» toÃ n bá»™ vector dá»Ÿ dang** vÃ  tÃ¡i tÃ­nh toÃ¡n 100% vector cá»¥c bá»™ báº±ng fallback vectorizer. Tuyá»‡t Ä‘á»‘i khÃ´ng bao giá» trá»™n láº«n cosine similarity giá»¯a vector cá»§a 2 model khÃ¡c nhau.

### 2.2. Khá»­ trÃ¹ng láº·p ngá»¯ nghÄ©a dá»±a trÃªn Ä‘áº¡i diá»‡n (Representative-Based Incremental Clustering)

Äá»ƒ trÃ¡nh nhÆ°á»£c Ä‘iá»ƒm ná»‘i chuá»—i lan truyá»n (transitive over-merging) cá»§a Disjoint Set Union (DSU) thÃ´ng thÆ°á»ng (khi A gáº§n B, B gáº§n C nhÆ°ng A xa C mÃ  DSU váº«n gom cáº£ 3 láº¡i vÃ  vÃ´ tÃ¬nh loáº¡i bá» C):

- Táº­p tá»« khÃ³a há»£p lá»‡ Ä‘Æ°á»£c sáº¯p xáº¿p trÆ°á»›c theo thá»© tá»± Æ°u tiÃªn cháº¥t lÆ°á»£ng:
  1. Äiá»ƒm tÆ°Æ¡ng Ä‘á»“ng ngá»¯ nghÄ©a (`relevanceScore`)
  2. Nguá»“n gá»‘c xuáº¥t xá»© (`provenance`: `google_autocomplete` > `buyer_intent` > `category` > `niche` > `title`)
  3. Äá»™ dÃ i thÆ°Æ¡ng máº¡i lÃ½ tÆ°á»Ÿng (3 Ä‘áº¿n 4 tá»«)
  4. Thá»© tá»± xuáº¥t hiá»‡n ban Ä‘áº§u (`originalIndex`)
- á»¨ng viÃªn sá»‘ 1 trá»Ÿ thÃ nh Leader cá»§a Cá»¥m 1.
- CÃ¡c á»©ng viÃªn tiáº¿p theo **chá»‰ so sÃ¡nh vá»›i Representative (Ä‘áº¡i diá»‡n) cá»§a cÃ¡c cá»¥m hiá»‡n há»¯u**:
  - Náº¿u tÆ°Æ¡ng Ä‘á»“ng $\ge 0.90$ (hoáº·c $\ge 0.84$ kÃ¨m Token Jaccard $\ge 0.55$), á»©ng viÃªn gia nháº­p cá»¥m Ä‘Ã³ vÃ  bá»‹ Ä‘Ã¡nh dáº¥u loáº¡i vá»›i lÃ½ do `semantic_duplicate`.
  - Náº¿u khÃ´ng trÃ¹ng vá»›i Ä‘áº¡i diá»‡n nÃ o, á»©ng viÃªn láº­p cá»¥m má»›i vÃ  trá»Ÿ thÃ nh Ä‘áº¡i diá»‡n cá»§a cá»¥m Ä‘Ã³.
- Káº¿t quáº£: Loáº¡i bá» triá»‡t Ä‘á»ƒ hiá»‡n tÆ°á»£ng over-merge lan truyá»n, báº£o toÃ n cÃ¡c tá»« khÃ³a Ä‘á»™c láº­p.

### 2.3. Thá»© báº­c LÃ½ do Xung Ä‘á»™t Táº¥t Ä‘á»‹nh (Deterministic Reason Precedence)

Há»‡ thá»‘ng khÃ³a cháº·t thá»© tá»± Æ°u tiÃªn khi má»™t tá»« khÃ³a thá»a mÃ£n nhiá»u Ä‘iá»u kiá»‡n loáº¡i trá»«:

1. `exact_duplicate` (Äá»™ Æ°u tiÃªn 1 - Lá»c chuáº©n hÃ³a chuá»—i ban Ä‘áº§u)
2. `brand_conflict` (Äá»™ Æ°u tiÃªn 2 - Guardrail chÃ­nh sÃ¡ch thÆ°Æ¡ng hiá»‡u cáº¥m)
3. `existing_url_cannibalization` (Äá»™ Æ°u tiÃªn 3 - Xung Ä‘á»™t URL ná»™i bá»™ site)
4. `category_conflict` (Äá»™ Æ°u tiÃªn 4 - Xung Ä‘á»™t loáº¡i sáº£n pháº©m cáº¡nh tranh)
5. `search_intent_mismatch` (Äá»™ Æ°u tiÃªn 5 - Truy váº¥n informational hÆ°á»›ng dáº«n)
6. `semantic_drift_irrelevant` (Äá»™ Æ°u tiÃªn 6 - Äá»™ liÃªn quan tháº¥p, trÃ´i dáº¡t ngá»¯ nghÄ©a)
7. `semantic_duplicate` (Äá»™ Æ°u tiÃªn 7 - TrÃ¹ng láº·p ngá»¯ nghÄ©a trong ná»™i bá»™ sáº£n pháº©m)
8. `low_specificity_generic` (Äá»™ Æ°u tiÃªn 8 - Tá»« khÃ³a quÃ¡ chung chung / rá»—ng)

HÃ m `recordConflict` Ä‘áº£m báº£o lÃ½ do cÃ³ thá»© báº­c Æ°u tiÃªn cao hÆ¡n luÃ´n luÃ´n giÃ nh chiáº¿n tháº¯ng má»™t cÃ¡ch táº¥t Ä‘á»‹nh.

---

## 3. Báº£ng Kiá»ƒm thá»­ Thá»±c táº¿ & Hiá»‡u chuáº©n NgÆ°á»¡ng Vertex AI (`text-embedding-004`)

Thá»±c nghiá»‡m Ä‘o Ä‘áº¡c trá»±c tiáº¿p vá»›i dá»± Ã¡n Google Cloud `gemini-image-benchmark`, model `text-embedding-004` trÃªn sáº£n pháº©m máº«u _"Vintage Black Cat Halloween T-Shirt"_:

| Keyword                     | Identity Sim | Intent Sim | Relevance Score |    Quyáº¿t Ä‘á»‹nh     | LÃ½ do Xung Ä‘á»™t / Ghi chÃº                                                            |
| --------------------------- | :----------: | :--------: | :-------------: | :---------------: | ----------------------------------------------------------------------------------- |
| `black cat halloween shirt` |    0.6769    |   0.7227   |     0.7067      |    **APPROVE**    | VÆ°á»£t ngÆ°á»¡ng thÆ°Æ¡ng máº¡i dense ($\ge 0.64$)                                           |
| `vintage halloween cat tee` |    0.6853    |   0.6977   |     0.6934      |    **APPROVE**    | VÆ°á»£t ngÆ°á»¡ng thÆ°Æ¡ng máº¡i dense ($\ge 0.64$)                                           |
| `gift for cat lover`        |    0.5389    |   0.6110   |     0.5858      | **REVIEW / PASS** | Náº±m trong VÃ¹ng XÃ¡m $[0.54, 0.64]$ & cÃ³ anchor ngá»¯ cáº£nh `cat lover` nÃªn Ä‘Æ°á»£c duyá»‡t   |
| `cat food`                  |    0.4266    |   0.4408   |     0.4358      |    **REJECT**     | `category_conflict` (NgÃ nh thá»©c Äƒn thÃº cÆ°ng vs thá»i trang) & Ä‘iá»ƒm trÃ´i dáº¡t $< 0.54$ |
| `how to draw a black cat`   |    0.4707    |   0.4782   |     0.4756      |    **REJECT**     | `search_intent_mismatch` (Informational Query Guard)                                |
| `cat veterinary care`       |    0.3364    |   0.3671   |     0.3563      |    **REJECT**     | `semantic_drift_irrelevant` (Äiá»ƒm sá»‘ $< 0.54$)                                      |
| `rugby world cup`           |    0.1830    |   0.2157   |     0.2042      |    **REJECT**     | `category_conflict` & `semantic_drift_irrelevant` ($< 0.54$)                        |

**Káº¿t luáº­n hiá»‡u chuáº©n:**

- Khoáº£ng cÃ¡ch phÃ¢n tÃ¡ch (margin separation) giá»¯a tá»« khÃ³a thÆ°Æ¡ng máº¡i tÃ­ch cá»±c ($0.69 - 0.71$) vÃ  cÃ¡c tá»« khÃ³a trÃ´i dáº¡t/xung Ä‘á»™t ($0.18 - 0.47$) Ä‘áº¡t Ä‘á»™ chÃªnh lá»‡ch ráº¥t lá»›n ($> 0.22$), xÃ¡c nháº­n ngÆ°á»¡ng dense $0.64$ (pass) vÃ  $0.54$ (reject) lÃ  tá»‘i Æ°u vÃ  an toÃ n.

---

## 4. Káº¿t quáº£ Kiá»ƒm thá»­, Kiá»ƒm toÃ¡n Äá»™c láº­p & TÆ°Æ¡ng thÃ­ch Há»‡ thá»‘ng

### 4.1. CÃ¡c lá»—i phÃ¡t hiá»‡n & Ä‘Ã£ kháº¯c phá»¥c qua Kiá»ƒm toÃ¡n Äá»™c láº­p (Second-Round Audit)

1. **Sá»­a lá»—i logic VÃ¹ng XÃ¡m (Gray Zone Enforcement Bug)**:
   - _Hiá»‡n tÆ°á»£ng ban Ä‘áº§u_: `evaluateCandidateRelevance` kiá»ƒm tra `if (hasAnchor && relevanceScore > 0)`, khiáº¿n báº¥t ká»³ tá»« khÃ³a nÃ o dÃ­nh dÃ¹ chá»‰ 1 anchor token (nhÆ° "cat") Ä‘á»u Ä‘Æ°á»£c duyá»‡t báº¥t ká»ƒ Ä‘iá»ƒm liÃªn quan tháº¥p cá»¡ nÃ o, hoÃ n toÃ n bá» qua `thresholds.relevanceReject`.
   - _Kháº¯c phá»¥c_: KhÃ³a cháº·t Ä‘iá»u kiá»‡n vÃ¹ng xÃ¡m `relevanceScore >= thresholds.relevanceReject && hasAnchor`. Äá»“ng thá»i hiá»‡u chuáº©n láº¡i `LOCAL_SPARSE_THRESHOLDS.relevanceReject = 0.01` Ä‘á»ƒ vá»«a duyá»‡t cÃ¡c truy váº¥n long-tail 2 tá»« há»£p lá»‡, vá»«a loáº¡i bá» triá»‡t Ä‘á»ƒ cÃ¡c tá»« trÃ´i dáº¡t ngá»¯ nghÄ©a khÃ´ng liÃªn quan.
2. **NgÄƒn cháº·n lá»—i Regex Syntax Error & Metacharacter Injection**:
   - _Hiá»‡n tÆ°á»£ng ban Ä‘áº§u_: `new RegExp(\`\\b\${anchor}\\b\`)`vÃ `new RegExp(\`\\b\${brand}\\b\`)`dÃ¹ng trá»±c tiáº¿p chuá»—i thÃ´, sáº½ bá»‹ nÃ©m lá»—i`SyntaxError`(gÃ¢y crash stage) náº¿u entity/brand chá»©a kÃ½ tá»± Ä‘áº·c biá»‡t nhÆ°`Disney+`, `C++`, `cat (spooky)`, `100% cotton`, `[limited]`.
   - _Kháº¯c phá»¥c_: Bá»• sung hÃ m `safeWordBoundaryRegex` vÃ  `escapeRegex`, tá»± Ä‘á»™ng escape toÃ n bá»™ metacharacter vÃ  chá»‰ Ä‘áº·t `\b` khi kÃ½ tá»± biÃªn lÃ  `\w`.
3. **Äá»“ng bá»™ hÃ³a Ä‘á»‹nh danh Provider & TÆ°Æ¡ng thÃ­ch Corpus**:
   - _Hiá»‡n tÆ°á»£ng ban Ä‘áº§u_: `VertexTextEmbeddingProvider` dÃ¹ng `providerId = "vertex"` trong khi analyzer vÃ  unit tests kiá»ƒm tra `"vertex_ai"`, dáº«n Ä‘áº¿n `model` bá»‹ gÃ¡n nháº§m thÃ nh `"local_tfidf"` trong `StoredEmbedding`.
   - _Kháº¯c phá»¥c_: Äá»“ng bá»™ hÃ³a `providerId = "vertex_ai"`, Ä‘á»“ng thá»i `isEmbeddingCompatible` cháº¥p nháº­n cáº£ hai alias `"vertex"` vÃ  `"vertex_ai"` lÃ  tÆ°Æ¡ng thÃ­ch hoÃ n toÃ n.
4. **Báº£o vá»‡ toÃ n váº¹n máº£ng vector (Vector Batch Length Guard)**:
   - _Hiá»‡n tÆ°á»£ng ban Ä‘áº§u_: `createVectorSession` khÃ´ng kiá»ƒm tra sá»‘ lÆ°á»£ng vector tráº£ vá» tá»« API cÃ³ khá»›p vá»›i sá»‘ lÆ°á»£ng keywords yÃªu cáº§u hay khÃ´ng.
   - _Kháº¯c phá»¥c_: Bá»• sung kiá»ƒm tra nghiÃªm ngáº·t `candidateQueryVectors.length === candidateKeywords.length && candidateSimVectors.length === candidateKeywords.length`, tá»± Ä‘á»™ng kÃ­ch hoáº¡t fallback táº¥t Ä‘á»‹nh náº¿u cÃ³ máº¥t mÃ¡t dá»¯ liá»‡u batch.
5. **Chuáº©n hÃ³a dáº¥u cÃ¢u Ä‘áº§u/cuá»‘i chuá»—i (Canonicalization Punctuation Trimming)**:
   - Bá»• sung khá»­ cÃ¡c kÃ½ tá»± dáº¥u cÃ¢u Ä‘áº§u/cuá»‘i (`"`, `,`, `.`, `!`, `?`) trong `canonicalizeKeyword` Ä‘á»ƒ cÃ¡c tá»« khÃ³a nhÆ° `"vintage tee,"` vÃ  `"vintage tee"` Ä‘Æ°á»£c khá»­ trÃ¹ng láº·p chÃ­nh xÃ¡c ngay táº¡i BÆ°á»›c 1 (`exact_duplicate`).
6. **Bá»• sung siÃªu dá»¯ liá»‡u phá»¥c vá»¥ BÆ°á»›c B5**:
   - Má»Ÿ rá»™ng `ConflictResult` vá»›i `relevanceScores` (báº£ng Ä‘iá»ƒm liÃªn quan cho tá»«ng tá»« khÃ³a) vÃ  `keywordClusters` (danh sÃ¡ch phÃ¢n cá»¥m ngá»¯ nghÄ©a theo Ä‘áº¡i diá»‡n), táº¡o Ä‘áº§u vÃ o lÃ½ tÆ°á»Ÿng cho Stage B5 viáº¿t Content.

### 4.2. Pháº§n Má»Ÿ Rá»™ng: Cross-Product Keyword Cannibalization Prevention & File-based Catalog Keyword Database

Äá»ƒ ngÄƒn cháº·n hiá»‡n tÆ°á»£ng tá»± triá»‡t tiÃªu tá»« khÃ³a (cannibalization) giá»¯a cÃ¡c sáº£n pháº©m khÃ¡c nhau trÃªn toÃ n site:

1. **CÆ¡ sá»Ÿ dá»¯ liá»‡u Danh má»¥c File-based (`FileSeoConflictCorpus`)**:
   - LÆ°u trá»¯ dáº¡ng versioned JSON file (`SeoConflictCorpusFile`: `schemaVersion: 1`, `revision`, `updatedAt`, `products[]`).
   - Ghi file nguyÃªn tá»­ (Atomic write): Ghi ra file táº¡m `.tmp` trong cÃ¹ng thÆ° má»¥c -> `handle.sync()` (`fsync`) -> `fs.rename`.
   - CÆ¡ cháº¿ File Locking an toÃ n: Sá»­ dá»¥ng lockfile nguyÃªn tá»­ vá»›i cá» `"wx"`, há»— trá»£ phÃ¡t hiá»‡n stale lock (>10s), backoff retry ngáº«u nhiÃªn vÃ  hÃ ng Ä‘á»£i in-process queue tuáº§n tá»± hÃ³a an toÃ n trong cÃ¹ng event loop.
   - Kiá»ƒm soÃ¡t tÆ°Æ¡ng tranh láº¡c quan (Optimistic Concurrency Control): Nháº­n `expectedRevision`, nÃ©m `CorpusRevisionConflictError` náº¿u snapshot bá»‹ sá»­a Ä‘á»•i bá»Ÿi worker khÃ¡c.
   - VÃ²ng Ä‘á»i sáº£n pháº©m an toÃ n: Thay tháº¿ toÃ n bá»™ claim set cá»§a sáº£n pháº©m (replace-not-append, giá»›i háº¡n top keywords theo rank) Ä‘á»ƒ loáº¡i trá»« triá»‡t Ä‘á»ƒ "zombie/ghost keywords". Há»— trá»£ `removeProduct` giáº£i phÃ³ng quyá»n sá»Ÿ há»¯u tá»« khÃ³a.
   - NgÄƒn cháº·n tá»± xung Ä‘á»™t (Self-Conflict Exclusion): Nháº­n diá»‡n sáº£n pháº©m sá»Ÿ há»¯u qua `productId`, `handle`, hoáº·c `url` (`isSameProduct`), cho phÃ©p rerun má»™t sáº£n pháº©m nhiá»u láº§n trÃªn cÃ¹ng catalog mÃ  khÃ´ng tá»± Ä‘Ã¡nh dáº¥u xung Ä‘á»™t vá»›i chÃ­nh nÃ³.
2. **Kiá»ƒm soÃ¡t Xung Ä‘á»™t Ngá»¯ nghÄ©a ToÃ n site (Cross-Product Semantic Ownership)**:
   - **Tier 1 (Exact Match)**: Äá»‘i chiáº¿u normalized keyword vá»›i cÃ¡c sáº£n pháº©m khÃ¡c trong snapshot.
   - **Tier 2 (Dense Semantic Vector Match)**: So sÃ¡nh cosine similarity giá»¯a embedding cá»§a á»©ng viÃªn vá»›i embedding cá»§a tá»« khÃ³a catalog:
     - NgÆ°á»¡ng $\ge 0.90$: Xung Ä‘á»™t ngá»¯ nghÄ©a máº¡nh (`existing_url_cannibalization`).
     - VÃ¹ng xÃ¡m $[0.86, 0.90)$: ÄÃ¡nh giÃ¡ bá»‘i cáº£nh (`contextual-conflict-evaluator.ts`) dá»±a trÃªn ngÃ nh hÃ ng (`category`) vÃ  Ã½ Ä‘á»‹nh (`intent`). CÃ¹ng ngÃ nh/Ã½ Ä‘á»‹nh -> xung Ä‘á»™t; khÃ¡c biá»‡t rÃµ rá»‡t -> duyá»‡t (`approve/keep`).
   - **Offline Vector Fallback (Shared Local TF-IDF Session)**: Khi khÃ´ng cÃ³ Vertex dense embeddings, há»‡ thá»‘ng trÃ­ch xuáº¥t toÃ n bá»™ tá»« khÃ³a thÃ´ tá»« catalog snapshot, káº¿t há»£p cÃ¹ng `[identityReference, shoppingIntentReference]` vÃ  candidate keywords Ä‘á»ƒ xÃ¢y dá»±ng **Má»˜T session `LocalTfidfVectorizer` duy nháº¥t**. ToÃ n bá»™ candidate vÃ  catalog keywords Ä‘Æ°á»£c vector hÃ³a trong cÃ¹ng vocabulary, IDF weights vÃ  L2 norm rá»“i so sÃ¡nh cosine, báº£o toÃ n nguyÃªn táº¯c Vector-First ngay cáº£ trong mÃ´i trÆ°á»ng offline.
3. **Snapshot Consistency & Lan truyá»n Revision (Transaction Flow)**:
   - Láº¥y duy nháº¥t 1 báº£n snapshot báº¥t biáº¿n táº¡i Ä‘áº§u hÃ m `analyze()`: `const corpusSnapshot = await corpus.getSnapshot()`.
   - Cáº£ bÆ°á»›c Exact Check vÃ  Semantic Check Ä‘á»u thá»±c thi trÃªn cÃ¹ng snapshot nÃ y trong bá»™ nhá»›.
   - `ConflictResult` tráº£ vá» `corpusRevision: corpusSnapshot.revision`.
   - Pipeline chuyá»ƒn tiáº¿p `corpusRevision` lÃ m `expectedRevision` cho `registerProductKeywords(corpus, product, approvedKeywords, { expectedRevision })` sau khi hoÃ n táº¥t B5/B6.
   - Cung cáº¥p helper `retryOnCorpusRevisionConflict` tá»± Ä‘á»™ng reload catalog má»›i vÃ  cháº¡y láº¡i tá»« B4 náº¿u phÃ¡t hiá»‡n tranh cháº¥p ghi dá»¯ liá»‡u.

### 4.3. Sá»‘ liá»‡u kiá»ƒm thá»­ tá»± Ä‘á»™ng & Nghiá»‡m thu

- ToÃ n bá»™ **210/210 tests** trong test suite dá»± Ã¡n Ä‘á»u vÆ°á»£t qua xuáº¥t sáº¯c (`pass 210, fail 0`), trong Ä‘Ã³ cÃ³ **56 tests chuyÃªn sÃ¢u** bao phá»§ toÃ n diá»‡n Stage B4 (tá»« Intra-Product matrix Ä‘áº¿n Cross-Product matrix AC $\rightarrow$ BC, race conditions, vÃ  Group Audit Invariant Verification).
- Kiá»ƒm tra TypeScript nghiÃªm ngáº·t (`npm run typecheck`): **0 lá»—i** (strict mode, khÃ´ng dÃ¹ng `any`, khÃ´ng `ts-ignore`).
- Báº£n dá»±ng chÃ­nh (`npm run build`): ThÃ nh cÃ´ng trong 985ms.
- Báº£n dá»±ng mÃ´i trÆ°á»ng mock (`npm run build:mock`): ThÃ nh cÃ´ng trong 637ms.
- **Nghiá»‡m thu chÃ­nh thá»©c (Official Verdict)**: ChatGPT Web (Planner & Reviewer) Ä‘Ã£ chá»‘t **`STAGE B4 â€” OFFICIALLY APPROVED âœ…`** cho toÃ n bá»™ Intra-Product Engine vÃ  Cross-Product Catalog Extension. Há»‡ thá»‘ng Ä‘Ã£ sáºµn sÃ ng 100% Ä‘á»ƒ bÆ°á»›c sang Stage B5 (SEO Content Generation).

### 4.4. Kiá»ƒm toÃ¡n Äá»™c láº­p Bá»• sung (Audit Fixes & Deep Verification)

1. **Kháº¯c phá»¥c lá»—i nháº­n diá»‡n sáº£n pháº©m trong `isSameProduct`**:
   - KhÃ³a cháº·t phÃ¢n cáº¥p Ä‘á»‹nh danh: Náº¿u cáº£ hai sáº£n pháº©m Ä‘á»u cÃ³ `productId` thÃ¬ so sÃ¡nh strictly theo `productId`. Hai sáº£n pháº©m cÃ³ ID khÃ¡c nhau tuyá»‡t Ä‘á»‘i khÃ´ng bao giá» Ä‘Æ°á»£c coi lÃ  cÃ¹ng má»™t sáº£n pháº©m dÃ¹ cÃ³ trÃ¹ng handle (ngÄƒn cháº·n triá»‡t Ä‘á»ƒ nguy cÆ¡ ghi Ä‘Ã¨ máº¥t dá»¯ liá»‡u sáº£n pháº©m khÃ¡c trong database hoáº·c bá» qua xung Ä‘á»™t cannibalization).
2. **Kháº¯c phá»¥c lá»—i bá» sÃ³t xung Ä‘á»™t trong Tier 2b (`FileSeoConflictCorpus`)**:
   - Khi embedding cá»§a á»©ng viÃªn vÃ  tá»« khÃ³a catalog khÃ´ng tÆ°Æ¡ng thÃ­ch (vÃ­ dá»¥ má»™t bÃªn lÃ  Vertex 768 chiá»u, má»™t bÃªn lÃ  Local TF-IDF), há»‡ thá»‘ng tá»± Ä‘á»™ng kÃ­ch hoáº¡t Tier 2b Token Jaccard vá»›i tá»« Ä‘iá»ƒn Ä‘á»“ng nghÄ©a (`extractCanonicalTokens`) thay vÃ¬ bá» qua hoÃ n toÃ n.
3. **Lan truyá»n Embedding TÃ¡i sá»­ dá»¥ng qua `ConflictResult.approvedEmbeddings`**:
   - Bá»• sung `approvedEmbeddings` vÃ o `ConflictResult`, cho phÃ©p `registerProductKeywords` tá»± Ä‘á»™ng tiáº¿p nháº­n vÃ  lÆ°u trá»¯ vector Vertex AI vÃ o Ä‘Ä©a JSON, giÃºp cÃ¡c láº§n cháº¡y sau tÃ¡i sá»­ dá»¥ng trá»±c tiáº¿p mÃ  khÃ´ng cáº§n gá»i láº¡i API Vertex AI.
4. **Hiá»‡u chuáº©n NgÆ°á»¡ng Catalog Step 9 theo Session**:
   - Sá»­ dá»¥ng `session.thresholds.duplicateStrong` vÃ  `duplicateReview` thay cho giÃ¡ trá»‹ cá»‘ Ä‘á»‹nh, giÃºp nháº­n diá»‡n chÃ­nh xÃ¡c xung Ä‘á»™t chÃ©o catalog á»Ÿ cáº£ cháº¿ Ä‘á»™ Vertex AI (ngÆ°á»¡ng 0.90 / 0.86) láº«n Local TF-IDF (ngÆ°á»¡ng 0.72 / 0.62).
5. **Gia cá»‘ An toÃ n I/O & File Locking**:
   - Chuáº©n hÃ³a Ä‘Æ°á»ng dáº«n tuyá»‡t Ä‘á»‘i `path.resolve` cho hÃ ng Ä‘á»£i in-process queue vÃ  lockfile.
   - Tá»± Ä‘á»™ng dá»n dáº¹p file `.tmp` náº¿u tiáº¿n trÃ¬nh ghi hoáº·c Ä‘á»•i tÃªn gáº·p sá»± cá»‘.
   - Xá»­ lÃ½ an toÃ n file 0-byte khá»Ÿi táº¡o corpus sáº¡ch thay vÃ¬ nÃ©m lá»—i cÃº phÃ¡p JSON.

