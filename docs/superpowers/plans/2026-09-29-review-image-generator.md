# Review Image Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native review-image page to FFP Tool that generates an image from one local scene template and one uploaded handbag/wallet product image through a Chrome extension and local ChatGPT Bridge.

**Architecture:** A local FastAPI service on `127.0.0.1:8770` owns jobs, images and the extension WebSocket. React calls same-origin endpoints through a bounded gateway proxy. The extension files are contained in this repository and attach the two images in order.

**Tech Stack:** React/TypeScript/Vite, Node gateway, Python/FastAPI/Pillow, Chrome Manifest V3.

**Spec:** `docs/superpowers/specs/2026-09-29-review-image-generator-design.md`

## Global Constraints

- No dependency on `Tool_crawer_New_update` at runtime.
- Do not use crawler coordinator port `8766` or alter the existing Shopify/SEO flows.
- Templates and outputs are local, ignored by Git; no automatic Shopify writes.
- Accept PNG/JPEG/WebP up to 5 MB; manual approval is required before download.
- Preserve any unrelated user files and changes.

## Review Focus

- A disconnected extension must fail clearly instead of leaving a queued job forever.
- A generated text-only answer must not be treated as a finished image.
- A template filename must not escape the configured template directory.
- An oversized or invalid image must be rejected before the extension receives it.
- An unapproved output must not be downloadable.

---

### Task 1: Local Bridge and review-image jobs

**Files:** Create `src/modules/review-image/server/{server.py,review_image_generator.py,api.py}` and focused Python tests; create `browser-extension/review-image/*` from the reviewed bridge implementation.

**Interfaces:** `POST /api/review-images/jobs`, `GET /api/review-images/jobs/{id}`, `GET /api/review-images/templates/{name}`, `GET /api/review-images/jobs/{id}/image`, `POST /api/review-images/jobs/{id}/approve`, `GET /api/review-images/jobs/{id}/download`; extension WebSocket and internal `POST /image-edit`.

- [x] Write tests for template selection, ordered image payload, approval gate, invalid image, text-only result and extension disconnect.
- [x] Run tests and confirm failure from missing service.
- [x] Implement the bounded job service and bridge routes; run focused tests to green.
- [x] Add extension code and run its attachment/result tests.
- [x] Commit the tested backend and extension.

### Task 2: Same-origin gateway integration and dev process

**Files:** Create `gateway/review-image-handler.ts` and tests; modify `gateway/vite-plugin.ts`, `gateway/server.ts`, `scripts/dev-processes.mjs`, `scripts/dev.mjs`, `package.json`, `.env.example`.

**Interfaces:** Gateway forwards `/api/review-images/*` to `127.0.0.1:8770` with the server-only Bridge token; `npm run dev` starts local Bridge.

- [x] Write failing proxy tests for body limits, local upstream, binary result and unavailable service.
- [x] Implement gateway route and registration; run focused tests to green.
- [x] Write failing process-spec test for port `8770`; implement dev start and port check; run tooling tests.
- [x] Commit the tested gateway and startup wiring.

### Task 3: Native React page and navigation

**Files:** Create `src/modules/review-image/{index.ts,types.ts,client.ts,routes.tsx,ui/ReviewImagePage.tsx}` and tests; modify `src/app/routes/AppRoutes.tsx`, `src/layouts/AppLayout.tsx`.

**Interfaces:** Route `/review-images` calls the same-origin gateway API, uploads a product data URL, polls job state, retries with same/new template, approves and downloads.

- [x] Write failing page/client tests for prompt, product mode and submission; verify approval and download through Chrome smoke.
- [x] Implement the route, page and menu; run focused tests to green.
- [x] Verify keyboard/label and loading/error/empty states; commit.

### Task 4: Documentation and final verification

**Files:** Modify `README.md`; create local ignored sample template in `data/review-image-templates/`.

- [x] Document extension import path, bridge token, template folder and startup/test instructions.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run build:mock`, and local HTTP/browser smoke checks; inspect `git diff --check` and unrelated changes. A real ChatGPT image-generation run remains for the user's signed-in browser.
- [x] Commit documentation and final test-backed fixes; leave the feature branch for the user to review.
