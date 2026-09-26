# Káº¿ Hoáº¡ch Triá»ƒn Khai: Phase 0 â€” Chuáº©n HÃ³a Public Contract & Khung Module SEO Content

TÃ i liá»‡u nÃ y lÃ  báº£n káº¿ hoáº¡ch hÃ nh Ä‘á»™ng chi tiáº¿t cho **Phase 0** cá»§a module `SEO + Content` (thÆ° má»¥c: [`src/modules/seo-content/`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/)), Ä‘Æ°á»£c xÃ¢y dá»±ng dá»±a trÃªn:
1. Äáº·c táº£ ká»¹ thuáº­t táº¡i [`docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/docs/SEO_CONTENT_DETAILED_IMPLEMENTATION_PLAN.md).
2. Quy táº¯c kiáº¿n trÃºc & ranh giá»›i module táº¡i [`AGENTS.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/AGENTS.md).
3. Há»£p Ä‘á»“ng dá»¯ liá»‡u tá»•ng thá»ƒ vÃ  cÆ¡ cháº¿ truy xuáº¥t á»• Ä‘Ä©a táº¡i [`docs/CONTRACT_MAIN_TO_PINTEREST_POD.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/docs/CONTRACT_MAIN_TO_PINTEREST_POD.md) vÃ  [`docs/CONTRACT_PINTEREST_POD_TO_SEO.md`](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/docs/CONTRACT_PINTEREST_POD_TO_SEO.md).
4. XÃ¡c nháº­n tá»« Leader vá» kháº£ nÄƒng cháº¡y mÃ´i trÆ°á»ng Node.js backend vÃ  sá»­ dá»¥ng thÆ° viá»‡n `node:fs` / `Buffer`.

---

## 1. Má»¥c TiÃªu Cá»‘t LÃµi Cá»§a Phase 0

- **XÃ³a sáº¡ch mÃ£ scaffold cÅ©**: Loáº¡i bá» toÃ n bá»™ cÃ¡c Ä‘á»‹nh danh vÃ  logic táº¡m thá»«a káº¿ tá»« `Module B` (`ModuleBInput`, `ModuleBOutput`, `runModuleB`, `getModuleBRunner`, `moduleBMockData`).
- **Thiáº¿t láº­p Há»£p Ä‘á»“ng CÃ´ng khai (Public Contract) thá»±c táº¿**: Khai bÃ¡o cÃ¡c interface chuáº©n má»±c cho module trong `types.ts`, báº£o Ä‘áº£m module lÃ  má»™t "há»™p Ä‘en Ä‘á»™c láº­p" theo cÃ´ng thá»©c:
  $$\text{SeoContentInput} \longrightarrow \mathbf{\text{SEO + Content}} \longrightarrow \text{SeoContentOutput}$$
- **Há»— trá»£ toÃ n diá»‡n cáº£ Node.js Backend & Web Client**: Äá»‹nh nghÄ©a `SeoContentWebpAsset` vÃ  `SeoContentImageInput` Ä‘a nÄƒng vá»›i `localFilePath` (Ä‘á»ƒ Node.js `fs` Ä‘á»c/ghi cá»±c nhanh trÃªn Ä‘Ä©a), `url` (Ä‘á»ƒ web UI hiá»ƒn thá»‹), vÃ  `data` (`Buffer` hoáº·c `Blob`).
- **XÃ¢y dá»±ng Mock Runner chuáº©n xÃ¡c**: Cung cáº¥p dá»¯ liá»‡u máº«u Ä‘áº¡i diá»‡n (sáº£n pháº©m tháº£m Halloween/Rug) vÃ  runner giáº£ láº­p cÃ³ tÃ­nh báº¥t biáº¿n (immutability) Ä‘á»ƒ Main UI vÃ  Orchestrator cÃ³ thá»ƒ dev song song.
- **Báº£o Ä‘áº£m cháº¥t lÆ°á»£ng ká»¹ thuáº­t**: Viáº¿t má»›i bá»™ unit test Ä‘á»™c láº­p, cam káº¿t pass 100% táº¥t cáº£ cÃ¡c lá»‡nh kiá»ƒm thá»­ há»‡ thá»‘ng: `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock`.

---

## 2. Chi Tiáº¿t CÃ¡c Thay Äá»•i MÃ£ Nguá»“n (Proposed Changes)

Pháº¡m vi tÃ¡c Ä‘á»™ng: **100% náº±m trong `src/modules/seo-content/`**, khÃ´ng thay Ä‘á»•i báº¥t ká»³ file nÃ o bÃªn ngoÃ i.

```text
src/modules/seo-content/
â”œâ”€â”€ types.ts              # [MODIFY] Há»£p Ä‘á»“ng dá»¯ liá»‡u nghiá»‡p vá»¥ chÃ­nh thá»©c
â”œâ”€â”€ service.ts            # [MODIFY] Service cÆ¡ sá»Ÿ (baseline runner)
â”œâ”€â”€ runtime.ts            # [MODIFY] Bá»™ chá»n runner theo mÃ´i trÆ°á»ng (mock vs real)
â”œâ”€â”€ index.ts              # [MODIFY] Public exports duy nháº¥t cá»§a module
â”œâ”€â”€ mocks/
â”‚   â”œâ”€â”€ data.ts           # [MODIFY] Fixture dá»¯ liá»‡u máº«u thá»±c táº¿
â”‚   â””â”€â”€ runner.ts         # [MODIFY] Mock runner Ä‘á»™c láº­p, báº¥t biáº¿n
â””â”€â”€ __tests__/
    â””â”€â”€ service.test.ts   # [MODIFY] Unit tests kiá»ƒm thá»­ contract vÃ  mock/real parity
```

---

### Chi tiáº¿t tá»«ng file:

#### 1. [types.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/types.ts)
Äá»‹nh nghÄ©a cÃ¡c interface cÃ´ng khai chuáº©n TypeScript strict mode:
```ts
export interface SeoContentImageInput {
  readonly id?: string;
  readonly url: string;
  readonly alt?: string;
  readonly localFilePath?: string; // ÄÆ°á»ng dáº«n trÃªn á»• Ä‘Ä©a Ä‘á»ƒ Node.js fs Ä‘á»c trá»±c tiáº¿p
}

export interface SeoContentInput {
  readonly images: readonly SeoContentImageInput[];
  readonly niche: string;
  readonly title: string;
  readonly description: string;
  readonly handle: string;
}

export interface SeoContentWebpAsset {
  readonly filename: string;                  // TÃªn file WebP chuáº©n SEO (kebab-case)
  readonly localFilePath?: string;            // ÄÆ°á»ng dáº«n file trÃªn á»• Ä‘Ä©a
  readonly url?: string;                      // Relative URL (/api/...) Ä‘á»ƒ web view hiá»ƒn thá»‹
  readonly data?: Buffer | Uint8Array | Blob; // Há»— trá»£ Buffer cá»§a Node.js hoáº·c Blob
}

export interface SeoContentImageOutput {
  readonly sourceUrl: string;
  readonly alt: string;
  readonly webp: SeoContentWebpAsset;
}

export interface SeoContentOutput {
  readonly productTitle: string;
  readonly productDescription: string;
  readonly productSeoTitle: string;
  readonly productSeoDescription: string;
  readonly images: readonly SeoContentImageOutput[];
  readonly productHandle: string;
}
```

#### 2. [service.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/service.ts)
- Thay tháº¿ hÃ m `runModuleB` báº±ng:
  ```ts
  export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput>
  ```
- Khá»Ÿi táº¡o xá»­ lÃ½ cÆ¡ sá»Ÿ (baseline transformation):
  - Chuyá»ƒn tiáº¿p an toÃ n cÃ¡c trÆ°á»ng vÄƒn báº£n `title`, `description`, `handle`.
  - Thiáº¿t láº­p giÃ¡ trá»‹ ban Ä‘áº§u cho `productSeoTitle` vÃ  `productSeoDescription`.
  - Ãnh xáº¡ máº£ng áº£nh `images` sang cáº¥u trÃºc Ä‘áº§u ra cÃ³ `alt` vÃ  asset `webp` há»£p lá»‡.
  - Ghi chÃº TODO cáº¥u trÃºc rÃµ rÃ ng trá» tá»›i cÃ¡c Phase tiáº¿p theo (Pipeline B1 $\rightarrow$ B6).

#### 3. [mocks/data.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/mocks/data.ts)
- XÃ³a bá» `moduleBMockData`.
- XÃ¢y dá»±ng bá»™ fixture máº«u thá»±c táº¿ Ä‘áº¡i diá»‡n cho sáº£n pháº©m POD (VÃ­ dá»¥ Tháº£m Halloween phong cÃ¡ch cá»• Ä‘iá»ƒn):
  - `seoContentMockInput`: Chá»©a danh sÃ¡ch áº£nh (kÃ¨m cáº£ `url` vÃ  `localFilePath`), niche `vintage distressed rug`, tiÃªu Ä‘á» thÃ´, mÃ´ táº£ thÃ´ vÃ  handle ban Ä‘áº§u.
  - `seoContentMockData`: Dá»¯ liá»‡u Ä‘áº§u ra máº«u hoÃ n chá»‰nh gá»“m tiÃªu Ä‘á» tá»‘i Æ°u chuáº©n SEO, mÃ´ táº£ HTML 5 khá»‘i, SEO Title (<58 kÃ½ tá»±), SEO Description (140-155 kÃ½ tá»±), danh sÃ¡ch áº£nh kÃ¨m `alt` riÃªng cho tá»«ng gÃ³c vÃ  WebP asset.

#### 4. [mocks/runner.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/mocks/runner.ts)
- Thay tháº¿ `runMockModuleB` báº±ng:
  ```ts
  export async function runMockSeoContent(input: SeoContentInput): Promise<SeoContentOutput>
  ```
- Thá»±c hiá»‡n cÆ¡ cháº¿ sao chÃ©p Ä‘á»™c láº­p (fresh clone/deep copy) Ä‘á»ƒ Ä‘áº£m báº£o khÃ´ng lÃ m biáº¿n Ä‘á»•i fixture tÄ©nh trong `data.ts`.
- Ãnh xáº¡ Ä‘á»™ng `productHandle` theo input náº¿u cÃ³, tráº£ vá» káº¿t quáº£ dá»± Ä‘oÃ¡n Ä‘Æ°á»£c (deterministic).

#### 5. [runtime.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/runtime.ts)
- Thay tháº¿ `getModuleBRunner` báº±ng:
  ```ts
  export function getSeoContentRunner(environment: AppEnvironment): typeof runSeoContent {
    return environment === "mock" ? runMockSeoContent : runSeoContent;
  }
  ```
- Báº£o Ä‘áº£m module tá»± quáº£n lÃ½ viá»‡c lá»±a chá»n runner mÃ  khÃ´ng lÃ m rÃ² rá»‰ logic ra ngoÃ i.

#### 6. [index.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/index.ts)
- Xuáº¥t kháº©u cÃ´ng khai danh sÃ¡ch API sáº¡ch sáº½:
  ```ts
  export { seoContentMockData, seoContentMockInput } from "./mocks/data";
  export { runMockSeoContent } from "./mocks/runner";
  export { getSeoContentRunner } from "./runtime";
  export { runSeoContent } from "./service";
  export type {
    SeoContentImageInput,
    SeoContentImageOutput,
    SeoContentInput,
    SeoContentOutput,
    SeoContentWebpAsset,
  } from "./types";
  ```

#### 7. [__tests__/service.test.ts](file:///d:/D-Jobs/ae-B6/Shopify/tools/FFP-tool/ffp_tool/src/modules/seo-content/__tests__/service.test.ts)
- Viáº¿t má»›i cÃ¡c bÃ i unit test Ä‘á»™c láº­p sá»­ dá»¥ng `node:test` vÃ  `node:assert/strict`:
  - `Test 1`: `runSeoContent` tiáº¿p nháº­n `SeoContentInput` vÃ  tráº£ vá» `SeoContentOutput` há»£p lá»‡, Ä‘áº§y Ä‘á»§ cÃ¡c trÆ°á»ng báº¯t buá»™c.
  - `Test 2`: `runMockSeoContent` tráº£ vá» dá»¯ liá»‡u máº«u khá»›p 100% vá»›i há»£p Ä‘á»“ng cÃ´ng khai mÃ  khÃ´ng lÃ m thay Ä‘á»•i fixture tÄ©nh.
  - `Test 3`: `getSeoContentRunner` chá»n Ä‘Ãºng runner theo mÃ´i trÆ°á»ng (`mock` $\rightarrow$ mock runner; `development`/`production` $\rightarrow$ real service).
  - `Test 4`: Kiá»ƒm tra toÃ n diá»‡n, kháº³ng Ä‘á»‹nh khÃ´ng cÃ²n báº¥t ká»³ dáº¥u váº¿t nÃ o cá»§a `Module B` cÅ©.

---

## 3. Lá»™ TrÃ¬nh Tá»•ng Thá»ƒ CÃ¡c Cháº·ng Tiáº¿p Theo (Roadmap)

Sau khi hoÃ n thÃ nh Phase 0, cÃ¡c cháº·ng tiáº¿p theo sáº½ Ä‘Æ°á»£c triá»ƒn khai theo cÃ¡c cá»¥m Milestone logic:

| Cháº·ng (Milestone) | Ná»™i dung & Nhiá»‡m vá»¥ nghiá»‡p vá»¥ |
| :--- | :--- |
| **Phase 0 (Hiá»‡n táº¡i)** | **Chuáº©n hÃ³a Public Contract, Mock Runner & Khung Module** |
| **Milestone 1 (B1 + B2)** | **Tháº¥u hiá»ƒu Sáº£n pháº©m & Ngá»¯ cáº£nh Mua hÃ ng**<br>- TrÃ­ch xuáº¥t vÄƒn báº£n tá»« HTML thÃ´, nháº­n diá»‡n thá»±c thá»ƒ & chá»§ Ä‘á».<br>- Abstraction OCR & Vision cho hÃ¬nh áº£nh.<br>- PhÃ¢n tÃ­ch Ä‘á»‘i tÆ°á»£ng ngÆ°á»i mua, ngÆ°á»i nháº­n, dá»‹p táº·ng quÃ . |
| **Milestone 2 (B3 + B4)** | **Má»Ÿ rá»™ng TÃ¬m kiáº¿m & Chá»‘ng Xung Ä‘á»™t SEO**<br>- Bá»™ sinh tá»« khÃ³a máº§m (Seed Keyword Builder).<br>- TÃ­ch há»£p Google Autocomplete API thu tháº­p gá»£i Ã½ tÃ¬m kiáº¿m thá»±c táº¿.<br>- Thuáº­t toÃ¡n phÃ¡t hiá»‡n xung Ä‘á»™t tá»« khÃ³a Exact & Semantic (Embedding). |
| **Milestone 3 (B5)** | **PhÃ¢n loáº¡i Ã Ä‘á»‹nh & Sinh Ná»™i dung Sáº£n pháº©m**<br>- PhÃ¢n loáº¡i Search Intent (Transactional / Commercial / Informational).<br>- Láº­p káº¿ hoáº¡ch phÃ¢n bá»• tá»« khÃ³a (`ContentPlan`).<br>- Sinh Title (50-65 chars), Description HTML 5 khá»‘i, SEO Meta, Handle.<br>- Validator kiá»ƒm duyá»‡t chá»‘ng bá»‹a Ä‘áº·t dá»¯ liá»‡u (Anti-hallucination). |
| **Milestone 4 (B6)** | **Xá»­ lÃ½ áº¢nh Chuáº©n SEO**<br>- Sinh `alt text` cÃ¡ nhÃ¢n hÃ³a theo tá»«ng gÃ³c chá»¥p vÃ  khÃ´ng gian phÃ²ng.<br>- Chuyá»ƒn Ä‘á»•i Ä‘á»‹nh dáº¡ng sang WebP vÃ  Ä‘áº·t tÃªn file thÃ¢n thiá»‡n SEO báº±ng Node.js `fs` / `Buffer`. |
| **Milestone 5 (Integration)** | **Láº¯p RÃ¡p Service, Xá»­ LÃ½ Lá»—i & TÃ­ch Há»£p Orchestrator**<br>- Káº¿t ná»‘i tuáº§n tá»± B1 $\rightarrow$ B6 trong `service.ts`.<br>- Bá»c mÃ£ lá»—i chuáº©n `SEO_CONTENT_*` qua `AppError`.<br>- TÃ­ch há»£p vá»›i Orchestrator Ä‘á»ƒ nháº­n gÃ³i `PinterestPodDeliverables`. |

---

## 4. Káº¿ Hoáº¡ch XÃ¡c Minh & Kiá»ƒm Thá»­ (Verification Plan)

TrÆ°á»›c khi nghiá»‡m thu Phase 0, toÃ n bá»™ cÃ¡c lá»‡nh sau báº¯t buá»™c pháº£i cháº¡y vÃ  pass 100%:

```powershell
# 1. Cháº¡y riÃªng bÃ i kiá»ƒm thá»­ cá»§a module SEO Content
npx tsx --test src/modules/seo-content/__tests__/*.test.ts

# 2. Cháº¡y toÃ n bá»™ test suite cá»§a cáº£ dá»± Ã¡n
npm test

# 3. Kiá»ƒm tra tÃ­nh toÃ n váº¹n kiá»ƒu dá»¯ liá»‡u TypeScript strict mode
npm run typecheck

# 4. Kiá»ƒm tra build báº£n sáº£n xuáº¥t
npm run build

# 5. Kiá»ƒm tra build cháº¿ Ä‘á»™ mock
npm run build:mock
```

Äá»“ng thá»i kiá»ƒm tra `git status` vÃ  `git diff` Ä‘á»ƒ Ä‘áº£m báº£o:
- KhÃ´ng cÃ³ báº¥t ká»³ file nÃ o ngoÃ i `src/modules/seo-content/` bá»‹ chá»‰nh sá»­a ngoÃ i Ã½ muá»‘n.
- KhÃ´ng cÃ²n báº¥t ká»³ tá»« khÃ³a `ModuleB*` nÃ o trong toÃ n bá»™ thÆ° má»¥c module.

