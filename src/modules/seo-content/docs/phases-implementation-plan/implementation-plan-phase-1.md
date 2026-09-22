# Káº¿ Hoáº¡ch Triá»ƒn Khai: Phase 1 â€” XÃ¢y Dá»±ng Internal Pipeline & Domain Types

TÃ i liá»‡u nÃ y lÃ  báº£n káº¿ hoáº¡ch hÃ nh Ä‘á»™ng chi tiáº¿t Ä‘á»ƒ báº¯t tay vÃ o code **Phase 1** cá»§a module `SEO + Content` (thÆ° má»¥c: [`src/modules/seo-content/`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/)), Ä‘Æ°á»£c xÃ¢y dá»±ng dá»±a trÃªn:
1. Äáº·c táº£ ká»¹ thuáº­t táº¡i má»¥c **3. Phase 1 â€” Táº¡o internal pipeline vÃ  domain types** trong [`docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md).
2. Quy chuáº©n kiáº¿n trÃºc, quy táº¯c Ä‘Ã³ng gÃ³i ranh giá»›i module vÃ  phong cÃ¡ch code trong [`AGENTS.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/AGENTS.md).
3. Há»£p Ä‘á»“ng API chuáº©n táº¡i [`docs/CONTRACT_SEO_CONTENT_INPUT_OUTPUT.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/docs/CONTRACT_SEO_CONTENT_INPUT_OUTPUT.md).
4. Hiá»‡n tráº¡ng mÃ£ nguá»“n sau khi hoÃ n thÃ nh Phase 0 (Ä‘Ã£ cÃ³ public contract chuáº©n trong `types.ts`, `service.ts` baseline vÃ  bá»™ 10 unit tests).

---

## 1. Má»¥c TiÃªu Cá»‘t LÃµi Cá»§a Phase 1

Hiá»‡n táº¡i á»Ÿ Phase 0, `service.ts` Ä‘ang lÃ  má»™t hÃ m chuyá»ƒn Ä‘á»•i dá»¯ liá»‡u pháº³ng (flat baseline mapping). Äá»ƒ chuáº©n bá»‹ cho cÃ¡c giai Ä‘oáº¡n xá»­ lÃ½ chuyÃªn sÃ¢u vá» AI Vision, OCR, Google Autocomplete vÃ  sinh vÄƒn báº£n (tá»« Phase 2 Ä‘áº¿n Phase 13), **Phase 1 cÃ³ nhiá»‡m vá»¥ xÃ¢y dá»±ng bá»™ khung xÆ°Æ¡ng (Skeleton) ná»™i bá»™ vá»¯ng cháº¯c**:

- **Thiáº¿t láº­p Kiáº¿n trÃºc Pipeline Äa Táº§ng (Multi-Stage Pipeline)**: TÃ¡ch luá»“ng xá»­ lÃ½ thÃ nh 6 stage tuáº§n tá»± Ä‘á»™c láº­p:
  $$\text{B1 (Understanding)} \longrightarrow \text{B2 (Context)} \longrightarrow \text{B3 (Search)} \longrightarrow \text{B4 (Conflict)} \longrightarrow \text{B5 (Content)} \longrightarrow \text{B6 (Images)}$$
- **XÃ¢y dá»±ng Há»‡ thá»‘ng Kiá»ƒu Ná»™i bá»™ (Internal Domain Types)**: Äá»‹nh nghÄ©a kiá»ƒu dá»¯ liá»‡u cÃ³ cáº¥u trÃºc cho tá»«ng stage mÃ  **khÃ´ng Ä‘á»ƒ lá»™ (no leak) ra ngoÃ i `index.ts`**.
- **Báº£o toÃ n Dá»¯ liá»‡u Gá»‘c (No Data Loss)**: Thiáº¿t káº¿ `SeoPipelineContext` dáº¡ng báº¥t biáº¿n (immutable context), tÃ­ch lÅ©y dáº§n káº¿t quáº£ qua tá»«ng bÆ°á»›c mÃ  khÃ´ng lÃ m máº¥t hoáº·c thay Ä‘á»•i cÃ¡c thÃ´ng tin gá»‘c ban Ä‘áº§u (`images`, `niche`, `title`, `description`, `handle`).
- **PhÃ¢n Ä‘á»‹nh Ranh giá»›i Lá»—i (Error Boundaries)**: XÃ¢y dá»±ng cÆ¡ cháº¿ báº¯t lá»—i theo tá»«ng stage (`SeoStageError`), phÃ¢n biá»‡t lá»—i nghiÃªm trá»ng (Fatal error - dá»«ng pipeline) vÃ  lá»—i thá»© yáº¿u (Recoverable error - kÃ­ch hoáº¡t fallback an toÃ n).
- **Kháº£ nÄƒng Kiá»ƒm thá»­ Äá»™c láº­p (Testability & Dependency Injection)**: Thiáº¿t káº¿ pipeline dáº¡ng Factory (`createSeoPipeline`) cho phÃ©p inject mock stage handlers Ä‘á»ƒ kiá»ƒm thá»­ thá»© tá»± cháº¡y, tÃ­nh báº¥t biáº¿n vÃ  kháº£ nÄƒng cÃ´ láº­p lá»—i mÃ  khÃ´ng phá»¥ thuá»™c vÃ o API bÃªn ngoÃ i.

---

## 2. Cáº¥u TrÃºc ThÆ° Má»¥c & PhÃ¢n Chia TrÃ¡ch Nhiá»‡m

ToÃ n bá»™ cÃ¡c tá»‡p má»›i cá»§a Phase 1 sáº½ náº±m gá»n trong thÆ° má»¥c `src/modules/seo-content/internal/`. Tuyá»‡t Ä‘á»‘i khÃ´ng can thiá»‡p vÃ o báº¥t ká»³ thÆ° má»¥c nÃ o khÃ¡c trong dá»± Ã¡n:

```text
src/modules/seo-content/
â”œâ”€â”€ internal/                                # [NEW] ToÃ n bá»™ mÃ£ nguá»“n ná»™i bá»™ cá»§a module
â”‚   â”œâ”€â”€ domain-types.ts                      # [NEW] Kiá»ƒu dá»¯ liá»‡u trung gian cho B1â€“B6 vÃ  PipelineContext
â”‚   â”œâ”€â”€ pipeline-context.ts                  # [NEW] Quáº£n lÃ½ khá»Ÿi táº¡o & cáº­p nháº­t Context an toÃ n, báº¥t biáº¿n
â”‚   â”œâ”€â”€ pipeline-errors.ts                   # [NEW] Error model ná»™i bá»™ & cÆ¡ cháº¿ bá»c lá»—i tá»«ng stage
â”‚   â”œâ”€â”€ pipeline.ts                          # [NEW] Bá»™ Ä‘iá»u phá»‘i tuáº§n tá»± (Pipeline Runner & Factory)
â”‚   â””â”€â”€ stages/                              # [NEW] ThÆ° má»¥c chá»©a baseline handler cho tá»«ng cÃ´ng Ä‘oáº¡n
â”‚       â”œâ”€â”€ b1-product-understanding.ts      # [NEW] Baseline Stage B1
â”‚       â”œâ”€â”€ b2-shopping-context.ts           # [NEW] Baseline Stage B2
â”‚       â”œâ”€â”€ b3-search-suggestions.ts         # [NEW] Baseline Stage B3
â”‚       â”œâ”€â”€ b4-conflict-control.ts           # [NEW] Baseline Stage B4
â”‚       â”œâ”€â”€ b5-content-generation.ts         # [NEW] Baseline Stage B5
â”‚       â””â”€â”€ b6-image-processing.ts           # [NEW] Baseline Stage B6
â”œâ”€â”€ service.ts                               # [MODIFY] Chuyá»ƒn tiáº¿p thá»±c thi qua default pipeline
â”œâ”€â”€ types.ts                                 # [PRESERVE] Giá»¯ nguyÃªn Public Contract Phase 0
â”œâ”€â”€ runtime.ts                               # [PRESERVE] Giá»¯ nguyÃªn Runtime Selector
â”œâ”€â”€ index.ts                                 # [PRESERVE] Giá»¯ nguyÃªn Public API (khÃ´ng export internal/)
â”œâ”€â”€ mocks/                                   # [PRESERVE] Giá»¯ nguyÃªn Mock Fixtures & Runner Phase 0
â””â”€â”€ __tests__/
    â”œâ”€â”€ service.test.ts                      # [PRESERVE] Duy trÃ¬ 10 tests báº£o Ä‘áº£m tÃ­nh tÆ°Æ¡ng thÃ­ch
    â””â”€â”€ pipeline.test.ts                     # [NEW] Bá»™ unit tests chuyÃªn sÃ¢u cho Pipeline Phase 1
```

---

## 3. Äáº·c Táº£ Thiáº¿t Káº¿ Chi Tiáº¿t Tá»«ng Tá»‡p MÃ£ Nguá»“n

### 3.1. `internal/domain-types.ts`
Chá»©a cÃ¡c interface mÃ´ táº£ dá»¯ liá»‡u Ä‘áº§u ra trung gian cá»§a tá»«ng stage (B1 $\rightarrow$ B6) vÃ  `SeoPipelineContext`:

```typescript
import type { SeoContentInput, SeoContentOutput } from "../types";

/** B1: Káº¿t quáº£ phÃ¢n tÃ­ch sáº£n pháº©m vÃ  hÃ¬nh áº£nh (OCR, Vision, Theme) */
export interface ProductUnderstanding {
  readonly ocrTexts: readonly string[];
  readonly detectedEntities: readonly string[];
  readonly dominantColors: readonly string[];
  readonly visualStyle: string;
  readonly productCategory: string;
}

/** B2: Bá»‘i cáº£nh mua sáº¯m, chÃ¢n dung khÃ¡ch hÃ ng & dá»‹p sá»­ dá»¥ng */
export interface ShoppingContext {
  readonly targetAudience: readonly string[];
  readonly suitableOccasions: readonly string[];
  readonly useCases: readonly string[];
  readonly buyerIntentKeywords: readonly string[];
}

/** B3: Táº­p dá»¯ liá»‡u nghiÃªn cá»©u tá»« khÃ³a má»Ÿ rá»™ng (Google Suggest, Long-tail) */
export interface SearchResearchResult {
  readonly seedKeywords: readonly string[];
  readonly suggestedQueries: readonly string[];
  readonly querySources: Record<string, string>; // query -> "google_suggest" | "niche_seed"
}

/** B4: Káº¿t quáº£ kiá»ƒm tra xung Ä‘á»™t vÃ  trÃ¹ng láº·p tá»« khÃ³a */
export interface ConflictResult {
  readonly approvedKeywords: readonly string[];
  readonly discardedKeywords: readonly string[];
  readonly conflictReasons: Record<string, string>;
}

/** B5: Káº¿t quáº£ sÃ¡ng táº¡o ná»™i dung vÄƒn báº£n (Copywriting) */
export interface ContentResult {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly productHandle: string;
}

/** B6: Káº¿t quáº£ tá»‘i Æ°u hÃ³a hÃ¬nh áº£nh (WebP & Alt Text) */
export interface ImageProcessingResult {
  readonly processedImages: SeoContentOutput["images"];
}

/** Context tÃ­ch lÅ©y cháº¡y xuyÃªn suá»‘t qua 6 Stage cá»§a Pipeline */
export interface SeoPipelineContext {
  readonly source: SeoContentInput;
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
  readonly searchResearch?: SearchResearchResult;
  readonly conflictResult?: ConflictResult;
  readonly contentResult?: ContentResult;
  readonly imageResult?: ImageProcessingResult;
}
```

### 3.2. `internal/pipeline-context.ts`
Cung cáº¥p cÃ¡c hÃ m nguyÃªn tá»­ (pure helper functions) Ä‘á»ƒ khá»Ÿi táº¡o vÃ  cáº­p nháº­t context mÃ  khÃ´ng lÃ m biáº¿n Ä‘á»•i (mutate) Ä‘á»‘i tÆ°á»£ng cÅ©:
- `createInitialContext(input: SeoContentInput): SeoPipelineContext`: ÄÃ³ng bÄƒng `source` vÃ  tráº£ vá» context rá»—ng ban Ä‘áº§u.
- `evolveContext(context: SeoPipelineContext, updates: Partial<Omit<SeoPipelineContext, "source">>): SeoPipelineContext`: Tráº£ vá» má»™t shallow clone má»›i Ä‘Æ°á»£c gá»™p thÃªm dá»¯ liá»‡u cá»§a stage vá»«a hoÃ n thÃ nh.
- `finalizePipelineOutput(context: SeoPipelineContext): SeoContentOutput`: TrÃ­ch xuáº¥t vÃ  Ä‘á»‹nh hÃ¬nh láº¡i dá»¯ liá»‡u cuá»‘i cÃ¹ng tá»« `context.contentResult` vÃ  `context.imageResult` thÃ nh Ä‘Ãºng chuáº©n `SeoContentOutput`.

### 3.3. `internal/pipeline-errors.ts`
Äá»‹nh nghÄ©a há»‡ thá»‘ng xá»­ lÃ½ lá»—i chuyÃªn biá»‡t cho Pipeline:
- Class `SeoStageError` káº¿ thá»«a tá»« `AppError` cá»§a shared module (hoáº·c Error chuáº©n vá»›i mÃ£ lá»—i á»•n Ä‘á»‹nh `SEO_STAGE_FAILED`):
  - `stageName: "b1" | "b2" | "b3" | "b4" | "b5" | "b6"`
  - `isRecoverable: boolean`
  - `cause: unknown`
- HÃ m `wrapStageError(stageName: string, error: unknown, isRecoverable?: boolean): SeoStageError`

### 3.4. `internal/pipeline.ts`
TrÃ¡i tim Ä‘iá»u phá»‘i quy trÃ¬nh thá»±c thi tuáº§n tá»±:
- Äá»‹nh nghÄ©a interface Stage:
  ```typescript
  export interface SeoPipelineStage {
    readonly name: "b1" | "b2" | "b3" | "b4" | "b5" | "b6";
    execute(context: SeoPipelineContext): Promise<SeoPipelineContext>;
  }
  ```
- Factory táº¡o Pipeline:
  ```typescript
  export function createSeoPipeline(customStages?: readonly SeoPipelineStage[]): {
    execute(input: SeoContentInput): Promise<SeoContentOutput>;
  }
  ```
- CÆ¡ cháº¿ cháº¡y tuáº§n tá»± qua vÃ²ng láº·p `for (const stage of stages)`:
  - Gá»i `stage.execute(currentContext)`
  - Kiá»ƒm tra tÃ­nh báº¥t biáº¿n: XÃ¡c nháº­n context tráº£ vá» lÃ  Ä‘á»‘i tÆ°á»£ng há»£p lá»‡ vÃ  khÃ´ng lÃ m máº¥t `source`.
  - Náº¿u xáº£y ra lá»—i: Báº¯t lá»—i qua Error Boundary, náº¿u `isRecoverable` thÃ¬ ghi log cáº£nh bÃ¡o vÃ  tiáº¿p tá»¥c; náº¿u fatal error thÃ¬ nÃ©m `SeoStageError` Ä‘á»ƒ dá»«ng pipeline an toÃ n.

### 3.5. CÃ¡c Baseline Stage Handlers trong `internal/stages/`
Táº¡i Phase 1, cÃ¡c stage handler Ä‘Ã³ng vai trÃ² lÃ  "chÃ¢n Ä‘áº¿" chuáº©n má»±c (baseline functional stubs), Ä‘áº£m báº£o luá»“ng dá»¯ liá»‡u thÃ´ng suá»‘t trÆ°á»›c khi láº¯p ghÃ©p logic tháº­t á»Ÿ cÃ¡c Phase sau:
1. **`b1-product-understanding.ts`**: TrÃ­ch xuáº¥t sÆ¡ bá»™ cÃ¡c entity tá»« `source.title` vÃ  `source.niche`, táº¡o `ProductUnderstanding` máº«u.
2. **`b2-shopping-context.ts`**: Äá»c dá»¯ liá»‡u tá»« `context.productUnderstanding` vÃ  `source.niche` Ä‘á»ƒ sinh chÃ¢n dung ngÆ°á»i mua vÃ  ngá»¯ cáº£nh cÆ¡ báº£n.
3. **`b3-search-suggestions.ts`**: Táº¡o danh sÃ¡ch query ban Ä‘áº§u tá»« `source.title` vÃ  `context.shoppingContext`.
4. **`b4-conflict-control.ts`**: Lá»c bá» cÃ¡c tá»« rá»—ng, chuáº©n hÃ³a chá»¯ thÆ°á»ng vÃ  bÃ n giao táº­p tá»« khÃ³a há»£p lá»‡ vÃ o `context.conflictResult`.
5. **`b5-content-generation.ts`**: Sinh ná»™i dung vÄƒn báº£n (káº¿ thá»«a logic baseline tá»« Phase 0 vá»›i title, description, meta title/description vÃ  handle).
6. **`b6-image-processing.ts`**: Chuyá»ƒn Ä‘á»•i vÃ  Ä‘á»‹nh dáº¡ng danh sÃ¡ch áº£nh `source.images` sang chuáº©n `SeoContentImageOutput[]` (káº¿ thá»«a logic baseline tá»« Phase 0).

### 3.6. Cáº­p nháº­t `service.ts`
Chuyá»ƒn Ä‘á»•i `service.ts` thÃ nh Ä‘iá»ƒm gá»i tinh gá»n á»§y quyá»n hoÃ n toÃ n cho default pipeline:
```typescript
import { createSeoPipeline } from "./internal/pipeline";
import type { SeoContentInput, SeoContentOutput } from "./types";

const defaultPipeline = createSeoPipeline();

export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return defaultPipeline.execute(input);
}
```

---

## 4. Káº¿ Hoáº¡ch Kiá»ƒm Thá»­ & XÃ¡c Thá»±c (Verification Plan)

### 4.1. Unit Test Má»›i: `src/modules/seo-content/__tests__/pipeline.test.ts`
XÃ¢y dá»±ng tá»‘i thiá»ƒu 7 bÃ i test chuyÃªn sÃ¢u cho kiáº¿n trÃºc Pipeline:
1. **Thá»© tá»± thá»±c thi tuáº§n tá»± (Sequential Order)**: Táº¡o cÃ¡c spy stage Ä‘á»ƒ kiá»ƒm tra pipeline gá»i chÃ­nh xÃ¡c theo thá»© tá»± `b1 -> b2 -> b3 -> b4 -> b5 -> b6`.
2. **Báº£o toÃ n dá»¯ liá»‡u Ä‘áº§u vÃ o (Source Data Preservation)**: XÃ¡c nháº­n Ä‘á»‘i tÆ°á»£ng `context.source` á»Ÿ Stage B6 váº«n giá»¯ nguyÃªn 100% cÃ¡c trÆ°á»ng ban Ä‘áº§u (`images`, `niche`, `title`, `description`, `handle`).
3. **TÃ­nh báº¥t biáº¿n (Immutability)**: XÃ¡c nháº­n `currentContext !== previousContext` sau má»—i bÆ°á»›c xá»­ lÃ½.
4. **Error Boundary - Dá»«ng khi lá»—i Fatal**: BÆ¡m vÃ o má»™t stage giáº£ láº­p nÃ©m lá»—i nghiÃªm trá»ng $\rightarrow$ xÃ¡c nháº­n pipeline dá»«ng láº¡i ngay láº­p tá»©c, tráº£ vá» `SeoStageError` vá»›i Ä‘Ãºng `stageName`.
5. **Error Boundary - Kháº£ nÄƒng phá»¥c há»“i (Recoverable Fallback)**: BÆ¡m vÃ o má»™t stage nÃ©m lá»—i recoverable $\rightarrow$ pipeline ghi nháº­n fallback vÃ  váº«n hoÃ n táº¥t Ä‘áº¿n stage cuá»‘i cÃ¹ng.
6. **Kiá»ƒm tra Dependency Injection**: XÃ¡c minh `createSeoPipeline(customStages)` cho phÃ©p tÃ¹y biáº¿n hoáº·c hoÃ¡n Ä‘á»•i báº¥t ká»³ stage nÃ o mÃ  khÃ´ng phá»¥ thuá»™c vÃ o mÃ´i trÆ°á»ng bÃªn ngoÃ i.
7. **End-to-End Pipeline Baseline Output**: Kiá»ƒm tra khi Ä‘Æ°a `seoContentMockInput` qua default pipeline thÃ¬ Ä‘áº§u ra nháº­n Ä‘Æ°á»£c thá»a mÃ£n toÃ n bá»™ cáº¥u trÃºc cá»§a `SeoContentOutput`.

### 4.2. Báº£o LÆ°u vÃ  XÃ¡c Thá»±c Tests Hiá»‡n CÃ³ (`service.test.ts`)
- 10 bÃ i unit test Ä‘Ã£ viáº¿t á»Ÿ Phase 0 trong [`service.test.ts`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/__tests__/service.test.ts) pháº£i tiáº¿p tá»¥c pass 100% mÃ  khÃ´ng cáº§n sá»­a Ä‘á»•i lá»›n.

### 4.3. CÃ¡c Lá»‡nh Kiá»ƒm Tra Nghiá»‡m Thu Báº¯t Buá»™c (Theo `AGENTS.md`)
```bash
# 1. Cháº¡y toÃ n bá»™ unit test cá»§a module SEO Content (bao gá»“m cáº£ service.test.ts vÃ  pipeline.test.ts)
npx tsx --test src/modules/seo-content/__tests__/*.test.ts

# 2. Cháº¡y toÃ n bá»™ test suite dá»± Ã¡n (bao gá»“m Module A, B, C vÃ  Orchestrator)
npm test

# 3. Kiá»ƒm tra kiá»ƒu dá»¯ liá»‡u TypeScript (Strict mode - KhÃ´ng cÃ³ lá»—i type nÃ o)
npm run typecheck

# 4. Kiá»ƒm tra Build Production cá»§a Vite
npm run build

# 5. Kiá»ƒm tra Build Mock cá»§a Vite
npm run build:mock
```

---

## 5. Rá»§i Ro Tiá»m áº¨n & Biá»‡n PhÃ¡p PhÃ²ng Ngá»«a

| Rá»§i ro | Nguy cÆ¡ | Biá»‡n phÃ¡p phÃ²ng ngá»«a |
| :--- | :--- | :--- |
| **RÃ² rá»‰ kiá»ƒu ná»™i bá»™ ra `index.ts`** | Vi pháº¡m quy táº¯c ranh giá»›i module cá»§a `AGENTS.md` | Tuyá»‡t Ä‘á»‘i khÃ´ng export báº¥t ká»³ file nÃ o tá»« `internal/` trong `src/modules/seo-content/index.ts`. Chá»‰ export public contract tá»« `types.ts`. |
| **Mutate nháº§m dá»¯ liá»‡u context** | GÃ¢y side-effects khÃ³ debug giá»¯a cÃ¡c stage | Sá»­ dá»¥ng `readonly` trÃªn toÃ n bá»™ thuá»™c tÃ­nh cá»§a `SeoPipelineContext` vÃ  cÃ¡c domain types; Ä‘Ã³ng bÄƒng Ä‘á»‘i tÆ°á»£ng (freeze/shallow copy) khi chuyá»ƒn stage. |
| **Lá»—i TypeScript `strict` mode** | Bá»‹ lá»—i khi build hoáº·c typecheck | KhÃ´ng sá»­ dá»¥ng `any`, kiá»ƒm tra cháº·t cháº½ `undefined` khi truy xuáº¥t cÃ¡c trÆ°á»ng tÃ¹y chá»n trong `context`. |
| **LÃ m gÃ£y 10 test cÃ³ sáºµn cá»§a Phase 0** | GÃ¢y há»“i quy (regression) | Giá»¯ nguyÃªn logic chuáº©n hÃ³a chuá»—i vÃ  fallback an toÃ n trong stage B5 vÃ  B6 tÆ°Æ¡ng Ä‘Æ°Æ¡ng vá»›i `service.ts` cá»§a Phase 0. |

---

## 6. TiÃªu ChÃ­ HoÃ n ThÃ nh (Definition of Done)

- [ ] Táº¡o Ä‘áº§y Ä‘á»§ thÆ° má»¥c `internal/` vÃ  cÃ¡c tá»‡p: `domain-types.ts`, `pipeline-context.ts`, `pipeline-errors.ts`, `pipeline.ts`, vÃ  6 stage baseline trong `stages/`.
- [ ] Cáº­p nháº­t `service.ts` Ä‘á»ƒ káº¿t ná»‘i vÃ o default pipeline.
- [ ] KhÃ´ng chá»‰nh sá»­a hoáº·c thÃªm export ná»™i bá»™ vÃ o `index.ts`.
- [ ] Táº¡o má»›i `__tests__/pipeline.test.ts` vá»›i tá»‘i thiá»ƒu 7 test cases bao phá»§ toÃ n diá»‡n.
- [ ] ToÃ n bá»™ cÃ¡c lá»‡nh kiá»ƒm thá»­ há»‡ thá»‘ng: `npx tsx --test ...`, `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock` Ä‘á»u pass 100%.
- [ ] Táº¡o commit Git cÃ³ thÃ´ng Ä‘iá»‡p rÃµ rÃ ng tuÃ¢n thá»§ `AGENTS.md`: `feature(module-seo): implement Phase 1 internal pipeline and domain types`.

