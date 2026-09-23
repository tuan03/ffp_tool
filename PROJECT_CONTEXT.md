# PROJECT_CONTEXT.md

> **Purpose:** This file is the compact project context for AI coding agents working on **FFP Tool**.  
> Read this file first so you can understand the product direction, system design, repository architecture, module boundaries, important business logic, and engineering constraints **without scanning the entire codebase**.
>
> This document describes both:
>
> 1. the **current repository state**, and
> 2. the **intended business architecture** that the team is building toward.
>
> When those two differ, the distinction is called out explicitly.

---

# 1. Project summary

**FFP Tool** is an internal modular application for processing e-commerce product data and automating product workflows around Shopify.

The target system is composed of multiple independently owned business modules connected through a central application/orchestration layer.

Important product/workflow areas in the project include:

- Main UI / workflow control
- Amazon product crawler (`amazon-crawler` with Python distributed engine)
- Customization normalizer (`customization-normalizer`)
- SEO + Content (`seo-content` with B1-B6 pipeline & adapters)
- Auto SEO (`auto-seo` with SQLite backup)
- Pinterest POD (`pinterest-pod` with Python backend & AI Vision)
- Shopify Sync (`shopify-sync`)
- Shopify API Gateway (`gateway/` standalone GraphQL proxy)

The project is intentionally organized so multiple developers can implement modules in parallel while sharing one React/TypeScript application and one build.

---

# 2. Current technical stack

The current repository is a **single React application**, not a monorepo.

Core stack:

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Node/npm tooling

Current package baseline:

- React 19
- React DOM 19
- React Router DOM 7
- TypeScript 5.7
- Vite 8
- Tailwind CSS 4
- `tsx` for Node-based TypeScript tests
- `better-sqlite3` for local transactional backups
- `@google/genai` for Vertex AI ADC integrations

There is:

- one root `package.json`;
- one root `tsconfig.json` & one `tsconfig.gateway.json`;
- one application build;
- one `src/` tree;
- one standalone `gateway/` server.

Do **not** turn modules into separate npm packages or workspaces.

### Runtime environment & external AI services

- **Node.js runtime**: The application executes on a Node.js runtime, allowing standard Node.js libraries such as `fs` (`node:fs`, `node:path`, `Buffer`, `node:crypto`) to be used within business modules, runners, and scripts whenever needed.
- **Python Backend Engines**: Supporting long-running or distributed backend jobs:
  - Amazon Crawler engine on ports `8765` & `8766` (FastAPI / Uvicorn).
  - Pinterest POD engine on port `8768` (`src/modules/pinterest-pod/server/server.py`).
- **Gemini API**: The Gemini API (via Google Cloud ADC / Vertex AI, including Gemini 2.5 Flash Vision, Text-Embedding-004, and Gemini LLM) is officially authorized and available for use across the entire pipeline.
- **Optional storefront niche inference**: SEO Content accepts an optional `siteDomain`; when present, its server-side resolver renders the homepage, derives a bounded evidence set, and asks Gemini for the niche. A missing or failed domain inference always falls back to the caller-supplied `niche`.
- **SQLite Database**: Local SQLite databases (`better-sqlite3`) are utilized for transactional audit logs and backups (e.g. `data/auto_seo_backups.db`).

---

# 3. Repository architecture

Current high-level source layout:

```text
src/
├── app/
│   ├── providers/
│   ├── routes/
│   └── runtime/
│
├── config/
├── layouts/
├── pages/
├── styles/
│
├── modules/
│   ├── orchestrator/
│   ├── amazon-crawler/
│   ├── customization-normalizer/
│   ├── auto-seo/
│   ├── pinterest-pod/
│   ├── seo-content/
│   ├── shopify-sync/
│   ├── module-api/
│   └── [scaffolding: module-a, module-b, module-c]
│
└── shared/
    ├── constants/
    ├── errors/
    ├── types/
    └── utils/
gateway/                # Standalone Shopify GraphQL proxy gateway & server
```

Responsibilities:

```text
app / config / layouts / pages
        │
        │ application composition
        ▼
   orchestrator
        │
        │ coordinates business modules
        ▼
 business modules
        │
        ▼
      shared
```

The modules under `src/modules` are **code ownership boundaries inside the same application**. They are not separately deployed packages.

---

# 4. Ownership model

Default ownership boundaries:

| Area                            | Responsibility                                                       |
| ------------------------------- | -------------------------------------------------------------------- |
| `src/app`                       | Application composition and runtime wiring                           |
| `src/config`                    | Environment parsing/configuration                                    |
| `src/layouts`                   | Application-wide layouts                                             |
| `src/pages`                     | Application-level pages                                              |
| `src/styles`                    | Global styles                                                        |
| `src/modules/orchestrator`      | Workflow coordination                                                |
| `src/modules/<business-module>` | That module's contract, implementation, mocks, tests                 |
| `src/shared`                    | Small stable abstractions genuinely shared across independent owners |

Important rule:

> A developer/agent should normally modify only its assigned ownership area.

Do not make unrelated changes to another module, root configuration, or `shared`.

---

# 5. Module boundary rules

Every business module should behave like a black box:

```text
         Public Input
             │
             ▼
      ┌───────────────┐
      │ Business      │
      │ Module        │
      │               │
      │ private logic │
      └───────────────┘
             │
             ▼
         Public Output
```

Other modules should only know:

- what input is required;
- what output is returned;
- what public runner/function is exported.

They should **not** depend on how the module implements its internal steps.

## Dependency direction

Allowed general direction:

```text
app / pages / layouts
        ↓
   orchestrator
        ↓
 business modules
        ↓
      shared
```

Forbidden:

```text
business module A
      ↓
business module B internal files
```

Business modules must not directly import another business module's:

- `service.ts`
- `runtime.ts`
- `mocks/`
- `ui/`
- tests
- private helpers

If output from one module is needed by another, the **orchestrator** should coordinate the handoff.

---

# 6. Standard module structure

Target structure for a business module:

```text
module-x/
├── index.ts
├── types.ts
├── service.ts
├── runtime.ts
├── mocks/
│   ├── data.ts
│   └── runner.ts
├── ui/                  # optional
├── routes.tsx           # optional
└── __tests__/
    └── service.test.ts
```

Responsibilities:

## `types.ts`

Defines the module's **public contract**:

- public input types;
- public output types;
- public status/result structures where needed.

This is the most important integration surface.

## `service.ts`

Contains the real business implementation and real integration logic.

## `mocks/data.ts`

Contains safe, deterministic representative fixtures.

Never store:

- production records;
- tokens;
- credentials;
- secrets;
- sensitive personal data.

## `mocks/runner.ts`

Provides mock behavior that follows the **same public input/output contract** as the real service.

## `runtime.ts`

Selects between:

- mock runner in mock mode;
- real service in development/production.

## `index.ts`

Public exports only.

Do not put business logic in `index.ts`.

Consumers should import from the module root:

```ts
import { getSomeModuleRunner } from "../some-module";
```

not from internal files.

---

# 7. Environment/runtime model

Application environment:

```ts
type AppEnvironment = "mock" | "development" | "production";
```

Environment resolution is centralized in:

```text
src/config/environment.ts
```

Current runtime pattern:

```text
VITE_APP_ENV=mock
    ↓
module runtime
    ↓
mocks/runner.ts

VITE_APP_ENV=development | production
    ↓
module runtime
    ↓
service.ts
```

Important constraints:

- Do not scatter environment checks throughout business logic.
- Do not silently fall back to mock data in production.
- Missing required real configuration should fail explicitly.
- Browser-exposed environment variables use the `VITE_` prefix.
- Never place secrets in browser-exposed `VITE_` variables.

---

# 8. Current repository status

The repository began with generic demonstration modules:

```text
module-a
module-b
module-c
```

These currently demonstrate:

- public contracts;
- service/runtime separation;
- mock/real runner parity;
- orchestration;
- tests.

They are scaffolding/reference implementations, not necessarily the final business module names.

## Important: `seo-content` current state

The real SEO + Content module (`src/modules/seo-content/`) is **100% implemented, fully verified, and production-ready**:

- Standardized folder name: `src/modules/seo-content/` (replacing the initial scaffold).
- **Public contract**: `SeoContentInput` and `SeoContentOutput` are fully established in `types.ts`.
- **Complete Pipeline B1 → B6**:
  - **B1**: Product-anchored understanding (Gemini Vision batch analysis returns Typography, Visual Entities, Scene Context and Physical Product Identity; deterministic identity-only fallback).
  - **B2**: Shopping Context (Target audience, suitable occasions, use cases, buyer intent keywords).
  - **B3**: Search Suggestions (Gemini-generated prefix probes for product-grounded seeds, Google Autocomplete API client, in-memory LRU cache, circuit breaker, normalizer, fallback collector).
  - **B4**: Conflict Control (Vector-first hybrid engine with Vertex `text-embedding-004` & local TF-IDF, representative clustering, atomic file-locked conflict corpus).
  - **B5**: Content Generation (Dual-engine Gemini LLM & heuristic generator, anti-hallucination fact sheets, length fitters, semantic HTML Shopify description).
  - **B6**: Image Processing & Alt Text (Sharp WebP converter, magic bytes validator, SSRF redirect hop inspector, gallery alt uniqueness budget reservation).
- **Multi-Module Adapters**:
  - `customization-adapter.ts` (adapts Amazon crawler / customization product to SEO input).
  - `auto-seo-adapter.ts` (adapts Shopify / candidate products to SEO input; connected to Gateway).
  - `pinterest-pod-adapter.ts` (adapts Pinterest POD deliverables to SEO input).
- **Test coverage**: 271/271 unit tests in `src/modules/seo-content/__tests__/` passing 100% offline (zero-network test invariant).

---

# 9. Current orchestrator status

The existing orchestrator is also a demonstration workflow.

Current demo behavior is conceptually:

```text
Workflow Input
      ↓
   Module A
      ↓
 normalized items
     ↙    ↘
Module B  Module C
     \      /
      \    /
    Workflow Output
```

Module B and Module C run in parallel after Module A.

This is a **reference orchestration pattern**, not the final business workflow.

The real project workflow will evolve as the actual modules and contracts are finalized.

---

# 10. Intended business system

The overall business system discussed by the team contains approximately these functional areas:

```text
                  ┌─────────────────────┐
                  │      Main UI        │
                  │ workflow / review   │
                  └─────────┬───────────┘
                            │
                     Orchestrator
                            │
        ┌───────────────────┼────────────────────┐
        │                   │                    │
        ▼                   ▼                    ▼
 Amazon Crawl          Auto SEO              Pinterest
        │
        ▼
 Customize Crawl
        │
        └───────────────┐
                        ▼
                  SEO + Content
                        │
                        ▼
                 prepared result
                        │
                        ▼
                  Shopify API
                        │
                        ▼
                     Shopify
```

This is a conceptual target flow. Exact sequencing and module ownership can still be adjusted by the leader.

Key architectural intent:

- Crawlers collect/normalize product data.
- SEO + Content transforms product information into optimized content/media.
- Main/orchestrator controls cross-module flow.
- Shopify API handles Shopify-specific read/write integration.
- SEO + Content should not directly reach into unrelated modules.

---

# 11. SEO + Content module — business purpose

The **SEO + Content** module receives raw/current product information and returns a product content package optimized for SEO and ready for downstream review/synchronization.

At module level:

```text
RAW PRODUCT DATA
       ↓
SEO + CONTENT
       ↓
OPTIMIZED PRODUCT DATA
```

The caller should not need to know how B1–B6 are implemented internally.

---

# 12. SEO + Content — planned public input

The current agreed input is intentionally small.

## Input

1. **Product images**
2. **Product niche**
3. **Current product description data**
   - title
   - description
4. **Current product handle**

Conceptually:

```text
SeoContentInput
├── productImages
├── niche
├── title
├── description
└── handle
```

A future implementation may wrap these fields in richer typed structures, but the module should preserve the agreed semantics unless the contract is explicitly revised.

## Important input behavior

- Product image can be one or multiple images/mockups.
- `title` and `description` are the current/raw product text, not final optimized output.
- `description` may be HTML when coming from Shopify or another upstream source.
- `niche` provides explicit business context and should not be silently replaced by an unrelated inferred niche.
- `handle` is the current product handle and can be used as both source context and a candidate for optimization.

---

# 13. SEO + Content — planned public output

The currently agreed output is:

1. **Product title**
2. **Product description**
3. **Product SEO title**
4. **Product SEO description**
5. **Product image data**
   - image alt text
   - product image converted to WebP
6. **Product handle**

Conceptually:

```text
SeoContentOutput
├── productTitle
├── productDescription
├── productSeoTitle
├── productSeoDescription
├── productImages[]
│   ├── alt
│   └── webp
└── productHandle
```

The output should be deterministic in shape so the orchestrator/Main/Shopify API layer can consume it safely.

---

# 14. SEO + Content — internal processing model

The handwritten business notes have been normalized into the following high-level internal flow:

```text
INPUT
  │
  ▼
B1 — Product/image understanding
  │
  ▼
B2 — Audience & buying-context understanding
  │
  ▼
B3 — Search suggestion/query collection
  │
  ▼
B4 — SEO conflict/overlap control
  │
  ▼
B5 — Search-intent classification + keyword/content allocation
  │
  ▼
B6 — Image/media processing
  │
  ▼
OUTPUT
```

These steps are an internal implementation plan. They are not separate public modules unless the architecture is intentionally changed later.

---

# 15. B1 — Product/image understanding

Purpose:

> Convert a product-image batch into product-anchored evidence while keeping its scene separate.

B1 receives the full image batch and uses `niche` plus title only to identify the sold object. It returns four internal English evidence groups:

- `typography`: visible text on the product/design and its styling;
- `visualEntities`: one product-design-only summary;
- `sceneContext`: the placement/space, kept separate for search discovery only;
- `physicalProductIdentity`: the physical blank/object, such as `area rug`.

It does not infer or write Shopify Standard Product Taxonomy `category` or merchant `productType`. Background props never become product facts; B5 receives only physical identity, typography and visual entities.

Example:

```text
Image contains:
- black cat
- full moon
- pumpkin
- custom family name

B1 produces structured understanding such as:
- theme: Halloween
- visual entities: black cat, full moon, pumpkin
- personalization: family name
```

B1 does **not** generate final SEO content.

Its job is product understanding.

---

# 16. B2 — Audience & buying context

Purpose:

> Convert product understanding into likely shopping context.

B2 can identify information such as:

- likely recipient/user;
- possible buyer;
- relationship between buyer and recipient;
- occasion;
- use context;
- gift context.

Example:

```text
Product says: "Best Grandma Ever"

Possible interpretation:
- recipient: grandma
- buyers: child / grandchild
- occasions: birthday, Mother's Day, Christmas
- context: gift for grandma
```

B2 is **not Search Intent classification**.

B2 answers:

```text
Who is this for?
Who may buy it?
For what occasion/context?
```

---

# 17. B3 — Search suggestion/query collection

Purpose:

> Start from product-related seed keywords and collect real search suggestions/query expansions rather than relying only on AI-invented keywords.

Planned sources:

1. **Google Autocomplete API**
2. **Etsy Suggest Scraper**
3. **People Also Ask (PAA)** for relevant question-style search data

## Current implementation priority

At the current project stage:

> **Focus first on Google Autocomplete API.**

Etsy Suggest Scraper and PAA remain part of the overall direction, but they do not need to block the first Google Autocomplete implementation.

## Expected B3 behavior

Input:

```text
seed keywords
```

Output:

```text
suggestions/query expansions associated with those seeds
```

Keep source provenance where practical:

```text
seed keyword
    ↓
source
    ↓
suggestion
```

Example concept:

```json
{
  "seedKeyword": "personalized halloween rug",
  "suggestions": [
    {
      "text": "personalized halloween rug with name",
      "source": "google_autocomplete"
    }
  ]
}
```

B3 should mainly **collect and lightly normalize** search data.

For each product-grounded seed, Gemini may generate up to two safe prefix probes
(for example, `music player ru`) before calling Google Autocomplete. The original
seed is always queried; scene-context seeds never receive Gemini probes. Probe
metadata remains trace-only and must not become a B4/B5 keyword candidate unless
Google itself returns it as a suggestion.

B3 should not be responsible for final primary-keyword selection or final content generation.

---

# 18. B4 — SEO conflict/overlap control

Purpose:

> Reduce duplicate targeting and SEO cannibalization between products/URLs.

B4 checks whether candidate queries/keywords overlap with targets already associated with other products or URLs.

Possible checks:

- exact duplicate keyword;
- semantically very similar keyword/query;
- existing keyword ownership/mapping;
- potential cannibalization with another product or collection.

The handwritten notes reference a store/database + vector mapping concept.

High-level idea:

```text
candidate keyword/query
      ↓
compare against existing SEO mappings
      ↓
accepted / conflict / avoid / adjust
```

Possible internal data may include:

```text
keyword
URL/product owner
semantic vector/embedding
target type
```

B4 does not need to generate final prose.

Its purpose is **conflict control and target allocation support**.

---

# 19. B5 — Search intent + content/keyword allocation

Purpose:

> Decide how useful queries/keywords should be used in the product's final SEO fields and generate/optimize the text output.

B5 is where Search Intent classification belongs in the current interpretation.

Examples of intent classes:

- transactional;
- commercial;
- informational;
- navigational when relevant.

The main purpose is not merely to label intent. The intent classification helps decide **where a query is useful**.

Example:

```text
Transactional query
→ product title
→ SEO title
→ handle
→ meta/SEO description

Informational question
→ product description
→ FAQ/content section when supported
```

B5 is responsible for producing/optimizing the text fields required by the public output:

- product title;
- product description;
- product SEO title;
- product SEO description;
- product handle.

Avoid blindly repeating the exact same keyword in every field.

Use primary/secondary terms naturally and keep content readable.

---

# 20. B6 — Product image processing

Purpose:

> Prepare product images for the optimized output.

Current intended responsibilities:

- convert product images to **WebP**;
- generate SEO-friendly image filenames based on the product target/context;
- generate **image alt text** based on the actual image/product content.

The handwritten note refers to naming images according to the product's “target”, interpreted as the SEO target/primary theme or target keyword selected earlier in the pipeline.

Example concept:

```text
Original:
IMG_8372.PNG

Target:
personalized black cat halloween rug

Processed:
personalized-black-cat-halloween-rug.webp
```

For multiple images, avoid blindly assigning every image the identical filename.

Use image-specific suffix/context when appropriate.

B6 public output requirement:

```text
image alt
+
image as WebP
```

---

# 21. Shopify synchronization boundary

An early handwritten workflow included a final Shopify synchronization step.

However, the current modular project architecture already has a separate Shopify/API concern.

Therefore, unless the leader explicitly changes the contract:

> **SEO + Content should return optimized data; it should not directly own final Shopify write/sync behavior.**

Preferred separation:

```text
SEO + Content
     ↓
optimized result
     ↓
Main / Orchestrator
     ↓
Shopify API module
     ↓
Shopify
```

This keeps SEO + Content reusable and prevents it from becoming tightly coupled to Shopify transport logic.

---

# 22. SEO + Content implementation principle

Treat the module as one public black box with internal stages.

Do not expose B1/B2/B3/B4/B5/B6 as public cross-module dependencies unless there is a clear architectural reason.

Preferred shape:

```ts
runSeoContent(input: SeoContentInput): Promise<SeoContentOutput>
```

Internally the implementation may compose private helpers/services for B1–B6.

This gives the team a stable integration contract while allowing internal implementation to evolve.

### Multi-Module Integration Adapters

To allow upstream modules to easily invoke the SEO Content pipeline without violating black-box boundaries or introducing direct coupling, `src/modules/seo-content` provides three dedicated adapters:

1. **`customization-adapter.ts`**:
   - `fromCustomizationProduct(product, defaultNiche): SeoContentInput`
   - `runCustomizationSeoPipeline(products, options): Promise<CustomizationSeoBatchResult>`
   - Adapts products crawled from Amazon / Customization Normalizer.
2. **`auto-seo-adapter.ts`**:
   - `fromAutoSeoProduct(product, defaultNiche): SeoContentInput`
   - `runAutoSeoPipeline(products, options): Promise<AutoSeoBatchResult>`
   - Adapts products from Shopify or Auto SEO candidate lists; connected directly to Gateway Backend (`gateway/seo-content/service.ts`).
3. **`pinterest-pod-adapter.ts`**:
   - `fromPinterestPodItem(item, defaultNiche): SeoContentInput`
   - `fromPinterestPodBatch(deliverables, defaultNiche): readonly SeoContentInput[]`
   - `runPinterestPodSeoPipeline(deliverables, options): Promise<PinterestPodSeoBatchResult>`
   - Adapts deliverables from Pinterest POD Studio according to `docs/CONTRACT_PINTEREST_POD_TO_SEO.md`.

---

# 23. HTML product description handling

Product descriptions may arrive as HTML.

Important rule:

> Do not treat raw HTML markup itself as useful natural-language SEO content.

When analyzing the current description:

- parse/extract meaningful text safely;
- preserve relevant structured content when producing final HTML;
- do not destroy meaningful formatting unnecessarily;
- do not pass unsafe/untrusted HTML directly to UI rendering without sanitization;
- if the final public output expects HTML, clearly distinguish HTML output from plain text in types/naming.

Do not solve this by weakening types or using unsafe React rendering.

---

# 24. Main UI intent

The Main UI is intended to act as the user's control/review layer across modules.

Conceptually it should support workflows such as:

```text
load/select products
      ↓
run selected workflow/module(s)
      ↓
review proposed result
      ↓
approve / revise / draft / skip / other supported action
      ↓
send approved data to downstream API/sync flow
```

The exact UI is still evolving.

Important architecture rule:

> Main UI should consume public module/orchestrator outputs; it should not embed SEO business rules or import module internals.

---

# 25. Auto SEO context

The Auto SEO area is intended to work with already-existing product data.

Conceptually discussed responsibilities:

- scan products;
- allow selecting one or multiple products;
- send selected product data through SEO + Content;
- review optimized result;
- then allow downstream actions such as approve/synchronize, edit, draft, delete, or skip depending on the final workflow.

Auto SEO should use the SEO + Content public contract rather than duplicating SEO logic.

---

# 26. Amazon crawler / Customize relationship

The intended product-flow discussion indicates:

```text
Amazon Crawl
     ↓
may request customization-related data
     ↓
Customize
```

The exact crawler contracts are not finalized in this context file.

Important architectural constraint:

> If one business module needs another module, prefer orchestrator coordination rather than importing the other module's internal service directly.

Do not invent direct cross-module dependencies merely because the conceptual business flow shows one module following another.

---

# 27. Mock-first parallel development model

The repository is intentionally designed so teams can develop in parallel.

Expected workflow:

```text
1. Agree public Input/Output contract
2. Define `types.ts`
3. Create representative mock data/runner
4. Main/orchestrator can integrate against mock contract
5. Module owner implements real `service.ts`
6. Real and mock runners remain contract-compatible
```

This allows Main UI work to continue while a module's real integration is unfinished.

Public contract changes require coordination because they affect consumers.

---

# 28. Error-handling model

Cross-module workflow failures use the repository's `AppError` pattern:

```ts
class AppError extends Error {
  code: string;
  cause?: unknown;
}
```

Principles:

- never swallow errors;
- use stable, specific error codes;
- preserve original error in `cause` when wrapping;
- do not expose internal raw errors directly to end users;
- convert failures to safe UI messages at the UI boundary.

The orchestrator owns cross-module wrapping/coordination errors.

Business modules should use domain-specific errors where useful and let the orchestrator preserve module identity.

---

# 29. TypeScript constraints

TypeScript strict mode is mandatory.

Do not use:

```text
any
as any
@ts-ignore
@ts-nocheck
```

Use:

- `unknown` for untrusted external data;
- type guards for narrowing;
- `import type` for type-only imports;
- `interface` for object-shaped public contracts;
- union types for state variants;
- readonly inputs where mutation is unnecessary;
- explicit output types for exported functions.

Avoid non-null assertion (`!`) when validation/branching can solve the problem.

Do not weaken `tsconfig.json` to make errors disappear.

---

# 30. Naming conventions

Use English for:

- source code;
- technical docs;
- routes;
- error codes;
- commits.

Naming:

```text
folders              kebab-case
React components     PascalCase
hooks                 useX
variables/functions  camelCase
types/interfaces      PascalCase
booleans              is*/has*/can*/should*/did*
event handlers        handle*
IDs                    <noun>Id
true constants         UPPER_SNAKE_CASE
error codes            UPPER_SNAKE_CASE
```

Do not prefix interfaces with `I`.

Avoid vague domain names such as:

```text
data
item
result
handler
utils
common
```

when a more precise name is available.

---

# 31. React/UI constraints

- Function components only.
- Providers belong in `src/app/providers`.
- Page-level UI belongs in `src/pages`.
- Module-specific UI belongs in that module's `ui/`.
- Do not perform API calls or side effects directly during render.
- Keep state local unless multiple consumers genuinely need shared state.
- Prefer derived state instead of storing duplicate derived values.
- Async UI should handle loading, empty, error, and success states.
- Use semantic HTML.
- Buttons should have explicit `type`.
- Inputs need labels.
- Icon-only controls need accessible names.
- Do not use `dangerouslySetInnerHTML` unless sanitization is intentionally implemented.

Styling:

- use Tailwind utilities;
- keep global CSS minimal;
- do not introduce another UI/CSS framework without explicit approval.

---

# 32. Routing constraints

Application routing is owned by:

```text
src/app/routes/AppRoutes.tsx
```

General rules:

- layouts use `Outlet`;
- module-owned routes can live in that module's `routes.tsx`;
- module route collections should be exported through the module public API;
- Main registers public routes instead of importing module-private pages;
- route paths use lowercase kebab-case;
- route parameters use meaningful names.

---

# 33. Dependency/package constraints

Before adding a dependency:

1. check whether the repository/platform already provides the needed capability;
2. verify the package solves a real requirement;
3. ensure it does not duplicate the existing stack;
4. place runtime packages in `dependencies`;
5. place build/test-only packages in `devDependencies`.

If `package.json` changes:

- run `npm install`;
- include the generated `package-lock.json` change;
- never manually edit the lockfile.

Do not upgrade dependencies as unrelated cleanup.

---

# 34. Security constraints

Never commit or log:

- API keys;
- passwords;
- access tokens;
- cookies/session secrets;
- full sensitive request headers;
- production personal data;
- production records used as mock fixtures.

Validate external/untrusted data at boundaries.

Do not put secret values in `VITE_` variables because they are browser-exposed.

---

# 35. Git/task discipline

Do not implement normal task work directly on `main`.

Expected branch format:

```text
<type>/<scope>-<short-description>
```

Common types:

```text
feature
fix
refactor
test
docs
chore
```

Existing documented scopes include:

```text
main
orchestrator
amazon-crawler
customization-normalizer
auto-seo
pinterest-pod
seo-content
shopify-sync
module-api
gateway
module-a
module-b
module-c
shared
tooling
```

Git safety:

- no force-push;
- no destructive reset of other people's work;
- no rebase of a shared branch;
- no unrelated file staging;
- no self-merge into `main` without leader instruction;
- preserve unrelated local changes.

---

# 36. Testing and verification

Repository scripts:

```bash
npm run dev
npm run dev:mock
npm test
npm run typecheck
npm run build
npm run build:mock
npm run preview
```

Before handoff, run fresh:

```bash
npm test
npm run typecheck
npm run build
```

If mock/runtime behavior changed, also run:

```bash
npm run build:mock
```

Never claim a command passed unless it was actually run against the current change.

Tests should be:

- focused;
- deterministic;
- independent of uncontrolled network;
- independent of wall clock/randomness unless injected;
- owned by the module being tested.

For behavior changes, add/update focused tests before or alongside implementation.

---

# 37. Orchestrator responsibilities

The orchestrator is responsible for:

- workflow ordering;
- dependency injection;
- mapping one module's public output to another module's public input;
- deciding which independent steps can run concurrently;
- aggregating workflow output;
- wrapping cross-module failures.

The orchestrator must **not** duplicate domain/business rules that belong in SEO + Content, crawlers, Shopify API, etc.

Prefer:

```text
Module A output
      ↓
orchestrator maps
      ↓
Module B input
```

instead of:

```text
Module B imports Module A internal service
```

---

# 38. Public contract change checklist

Changing a module public input/output is a coordination event.

If a public contract changes:

1. update `types.ts`;
2. update real `service.ts`;
3. update mock fixture/runner;
4. update module tests;
5. update the module `index.ts` public exports if needed;
6. coordinate orchestrator mapping changes;
7. update visible UI only if required by the changed semantics.

Do not mix contract changes with unrelated cleanup.

---

# 39. Current SEO + Content implementation status & next priorities

The core pipeline implementation of **SEO + Content** (`src/modules/seo-content`) is **100% completed, verified, and operational**:

- **Phase 1**: Public contract `SeoContentInput` / `SeoContentOutput` finalized and tested.
- **Phase 2**: B1 (Product Understanding) and B2 (Shopping Context) fully built and verified with Gemini 2.5 Flash Vision.
- **Phase 3**: B3 (Search Suggestions) implemented with Google Autocomplete API & caching.
- **Phase 4**: B4 (Conflict Control) implemented with Text-Embedding-004, local TF-IDF, clustering, and atomic file-locked corpus.
- **Phase 5**: B5 (Content Generation) implemented with dual-engine LLM/heuristic, anti-hallucination fact sheets, and Shopify HTML output.
- **Phase 6**: B6 (Image Processing) implemented with WebP conversion, magic bytes validation, SSRF redirect protection, and unique alt text generation.
- **Multi-Module Adapters**: 3 dedicated adapters (`customization-adapter.ts`, `auto-seo-adapter.ts`, `pinterest-pod-adapter.ts`) implemented and tested.
- **Verification**: 271/271 unit tests PASS, typecheck 0 errors, build clean.

Current next priorities:

1. Orchestrator workflow wiring and end-to-end data pass-through.
2. Main UI preview and review surfaces.
3. Downstream synchronization to Shopify via `shopify-sync` / Gateway.

---

# 40. Important non-goals / do-not-assume list

Do **not** assume:

- current `module-a/b/c` names equal final business modules;
- `seo-content` is an unbuilt scaffold (it is fully implemented with 6 internal stages and adapters);
- SEO + Content should write directly to Shopify;
- B1–B6 must be public modules;
- B3 should invent keywords without search data;
- Etsy Suggest/PAA must be implemented before Google Autocomplete;
- B2 Search Context equals Search Intent;
- B4 is content generation;
- B6 decides SEO target from scratch;
- UI should contain SEO business logic;
- modules may import each other's internals;
- mock behavior can diverge from real public contracts;
- secrets may be stored in browser environment variables.

When an external API shape, credential requirement, scoring rule, SEO policy, or cross-module contract is not defined, do not fabricate it. Ask for the missing decision or implement behind a clearly typed abstraction only when the task explicitly allows it.

---

# 41. Mental model for SEO + Content

Use this short model when reasoning about the module:

```text
B1 = LOOK
What is actually in/on the product?

B2 = UNDERSTAND SHOPPING CONTEXT
Who is it for, who may buy it, and when/why?

B3 = DISCOVER SEARCH LANGUAGE
What related queries/suggestions are users actually typing?

B4 = CONTROL OVERLAP
Which candidate targets conflict with existing URLs/products?

B5 = PLAN + WRITE
What is the search intent, where should terms be used,
and what final SEO/content fields should be generated?

B6 = PREPARE MEDIA
Convert/rename/describe product images for the final output.
```

Publicly, however, the module remains:

```text
SeoContentInput
      ↓
SEO + Content
      ↓
SeoContentOutput
```

> **Runtime & AI Capabilities**: The `seo-content` pipeline executes on a **Node.js runtime** (supporting local filesystem image ingestion via `node:fs` as well as remote URLs) and is authorized to leverage the **Gemini API via Google Cloud ADC** across all pipeline stages (Vision in B1, Vector Embeddings in B4, Content Generation in B5).

---

# 42. AI agent startup protocol

An AI agent working in this repository should follow this sequence:

```text
1. Read PROJECT_CONTEXT.md.
2. Identify the assigned ownership scope.
3. Inspect only the small set of files relevant to the task.
4. Check git status/current branch before editing.
5. Confirm whether the task changes a public contract.
6. Preserve module boundaries and dependency direction.
7. Add/update focused tests.
8. Implement the smallest required change.
9. Run required verification.
10. Report changed files, behavior, verification, contract changes, risks/TODOs.
```

This file is intended to eliminate the need to scan the entire repository for context.

It does **not** mean an agent should edit code blindly without opening the files it will modify. Before changing a file, inspect that file and its directly relevant tests/contracts.

---

# 43. Recommended handoff format

After a coding task, report:

```text
Summary
- <implemented behavior>

Changed files
- <path>: <reason>

Verification
- <command>: <actual result>

Contract / environment / route changes
- <none, or exact compatibility note>

Remaining TODOs or risks
- <none, or specific item>
```

Never claim a downstream integration is complete when only an internal module or mock path has been implemented.

---

# 44. Context precedence

Use this precedence when deciding what to follow:

```text
1. Explicit user/leader instruction for the current task
2. Current approved public contract / architecture decision
3. PROJECT_CONTEXT.md
4. Existing implementation details
```

If implementation and this context differ because the repository has evolved, do not force the old description onto new code.

Instead:

- inspect the changed relevant files;
- identify the divergence;
- preserve intentional newer behavior;
- update `PROJECT_CONTEXT.md` when the project-level design has genuinely changed.

---

# 45. One-paragraph project description for agents

FFP Tool is a single React/TypeScript/Vite application organized into independently owned business modules connected by an orchestrator and supported by standalone services (Shopify Gateway, distributed crawler engines, and Pinterest POD backend). Each module exposes a stable input/output contract through its own `index.ts`, provides matching real and mock runners, and must not depend directly on another business module's internals. The target product automates Shopify-oriented product workflows including crawling, customization retrieval, SEO/content optimization, Auto SEO, Pinterest, and Shopify API synchronization. The SEO + Content module (`seo-content`) is fully implemented with a complete 6-stage pipeline (B1-B6) and multi-module adapters, receiving product images, niche, current title/description, and handle, then returning optimized product title/description, SEO title/description, WebP images with alt text, and an optimized handle. Internally it performs product/image understanding, audience/buying-context analysis, search-suggestion collection (Google Autocomplete), SEO conflict control (vector embeddings + corpus locking), search-intent-driven content generation, and image optimization. The project enforces strict TypeScript, module ownership, public API boundaries, mock/real parity, deterministic tests, orchestrator-managed dependencies, secure environment handling, and focused branch-based development.
