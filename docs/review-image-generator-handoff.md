# Review Image Generator — Handoff

Updated: 2026-09-29. This document is the continuation point for the native FFP Tool review-image task.

## Repository and branch

- Repository requested by the user: `D:\Shopify_Workspace\Tool\ffp_tool`. The feature is **not** in `Tool_crawer_New_update` and has no runtime dependency on that child tool.
- Safe working directory for this feature: `D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree`. This is a linked worktree of the **same Git repository**, not a second project.
- Branch: `feature/main-add-review-image-generator`, forked from `main` at `87ed6b3`.
- Feature commits: `71b98d9` (Bridge and extension), `4143566` (gateway), `f774530` (page/menu), `2a236f7` (browser startup fix), and `0f763a5` (review fixes). The branch was clean when this handoff was written.
- The original `ffp_tool` checkout was on `feature/main-add-amazon-reviews-tab` when last inspected. Do not switch, reset, merge, or overwrite that checkout without checking its current status and coordinating with the user.
- Two old `review-image WIP` Git stashes remain in the shared repository. Their contents have already been restored and committed on this branch. **Do not apply them again** unless a fresh comparison proves something is missing.

To orient a new terminal:

```powershell
Set-Location 'D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree'
git branch --show-current
git status --short
git log -5 --oneline
```

If `git branch` says “not a git repository,” first run `Set-Location` above. Do not run Git commands from `codex_switcher` or another unrelated folder.

## Delivered behavior

- A dedicated **Tạo ảnh review** menu page at `/review-images` in the native React app.
- Input: a random or explicitly retried local scene template (Image 1), an uploaded product image (Image 2), and an editable prompt. The prompt instructs ChatGPT to remove the old product from Image 1 and place the selected handbag or handbag-and-wallet set from Image 2 into that scene.
- Local FastAPI Bridge on `127.0.0.1:8770`; same-origin gateway endpoints under `/api/review-images/*`; Chrome extension in `browser-extension/review-image/` connects to the Bridge WebSocket.
- Validation for PNG/JPEG/WebP (at most 5 MB), ordered image attachments, bounded pending jobs, actionable failures, preview, retry with same/different template, explicit approval, then download. No Shopify write.
- The page can accept a `GATEWAY_AUTH_TOKEN` when a production gateway requires it; previews and downloads use authenticated binary requests rather than token-bearing URLs.
- The extension preserves saved settings on updates, defaults to no chat-turn hiding, uses reversible hiding only when chosen, and verifies a fresh chat before uploading product images.

Key files: `src/modules/review-image/`, `gateway/review-image-handler.ts`, `gateway/vite-plugin.ts`, `gateway/server.ts`, `browser-extension/review-image/`, and `README.md`. The original design and implementation plan are in `docs/superpowers/specs/2026-09-29-review-image-generator-design.md` and `docs/superpowers/plans/2026-09-29-review-image-generator.md`.

## Local data and running services

- The supplied scene sample is an ignored local file at `D:\Shopify_Workspace\Tool\ffp_tool\data\review-image-templates\sample-bedroom-bag.png`. It is **not** committed and is not presently duplicated in the review-image worktree.
- Generated files go to `exports/review-images/` under whichever checkout starts the Python Bridge. The last running Bridge was started from the original `ffp_tool` checkout, so it reads that checkout's template and output folders.
- At handoff, the review page was listening at `http://127.0.0.1:5175/review-images` and the Bridge at `127.0.0.1:8770`. These processes are temporary; verify ports and health instead of assuming they remain alive.
- If restarting the Bridge from the review-image worktree, first put at least one valid scene template in **that worktree's** `data/review-image-templates/`; otherwise the page will report zero templates.
- Install Bridge dependencies with `python -m pip install -r src/modules/review-image/server/requirements.txt`. The manual Bridge command is `python src/modules/review-image/server/api.py`. The normal `npm run dev` starts more unrelated services, including the Shopify pipeline worker; avoid starting it just to test this page when those services are already running.

## Verification already performed

- On commit `0f763a5`: `npm test` passed (tooling 25, web 757, gateway 306, crawler 304 with one skipped, review-image Python 14 plus extension JS tests).
- `npm run typecheck`, `npm run build`, and `npm run build:mock` passed. Vite's existing browser-externalization and large-chunk warnings did not fail builds.
- Browser smoke loaded the menu page and found one valid template. A synthetic UI flow exercised product upload, generated-image preview, approval, and download. Earlier, a fake WebSocket extension also exercised the actual local HTTP/Bridge path. These are not a real ChatGPT generation test.
- A real image-generation run with the user's signed-in ChatGPT tab remains **unverified**. Image fidelity, lettering, and current ChatGPT DOM compatibility require the user to import the extension and inspect the result.

## Next safe steps

1. Read `AGENTS.md`, this handoff, the design/plan, and the review-image section of `README.md`; inspect `git status` before changing anything.
2. For a real test, load `D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree\browser-extension\review-image` via `chrome://extensions` → Developer mode → **Load unpacked**. Disable any older child-tool Bridge extension. Pin and reload a signed-in `chatgpt.com` tab. The extension URL is `ws://127.0.0.1:8770/ws/extension`; use the Bridge token configured in `.env.local`, or the local default `change-this-token` if none is set.
3. Generate with a product photo on `/review-images`, visually check whether the original template product is gone and whether the new product's shape, artwork, text, lighting, and shadows are accurate. Approve only a good result. If the ChatGPT markup has changed, capture a non-sensitive DOM fixture and fix selectors/tests before claiming live success.
4. Ask the user whether to merge the feature branch into `main`, push/create a PR, or keep it as-is. No merge or push has been authorized yet. Preserve the Amazon Reviews checkout and other worktrees.

Do not expose Bridge or gateway tokens in logs, screenshots, commits, or handoff text. Do not delete the old stashes or temporary worktrees without an explicit user decision.
