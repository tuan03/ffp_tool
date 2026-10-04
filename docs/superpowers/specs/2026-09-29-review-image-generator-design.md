# Review Image Generator — Design

## Purpose

Add a native **Tạo ảnh review** page to the FFP Tool navigation. A user selects a product image, chooses whether to place only the handbag or the handbag and matching wallet, and sends it with one randomly selected local scene template and an editable prompt to the existing ChatGPT browser-extension workflow. The result is previewed, retried with the same or another template, manually approved, and downloaded.

## Scope and constraints

- The page is a React route at `/review-images`; it is not an iframe of `Tool_crawer_New_update`.
- The extension and backend source live in this repository. They do not import or execute files from `Tool_crawer_New_update`.
- Templates live in `data/review-image-templates/`; generated images live in `exports/review-images/`. Both directories are local and ignored by Git. One sample template from the supplied reference is copied into the local template directory for testing.
- Local Bridge service binds to `127.0.0.1:8770`, leaving crawler coordinator port `8766` untouched. The browser uses same-origin `/api/review-images/*`; the gateway forwards those requests to the Bridge service and keeps its token server-side. The extension connects directly to the local Bridge WebSocket.
- V1 accepts PNG, JPEG and WebP images up to 5 MB each, and only handbag/wallet product photos. The template's scene is the background; its existing product must be removed. Product design, print and legible text should be preserved as faithfully as the generator allows. The user always checks the output manually before approval.
- Local-only workflow: no Shopify write, no public image upload, and no automatic product approval.

## Components and flow

1. `src/modules/review-image/` owns the typed client, route and page. The page uploads one product file, displays the chosen template, accepts an editable prompt and mode, polls job status, and gates download behind approval.
2. `src/modules/review-image/server/` owns the local FastAPI Bridge and review-image job service. It validates image bytes and path access, selects templates, sends two ordered images (`template`, `product`) to the connected extension, and stores the resulting image locally.
3. `gateway/review-image-handler.ts` owns a bounded, authenticated same-origin proxy to the local service. Both the Vite development middleware and production gateway register it.
4. `browser-extension/review-image/` owns the Chrome extension. It attaches both images to the ChatGPT composer, waits until upload is accepted, sends the prompt, and returns the generated image bytes or an explicit error.
5. `npm run dev` starts the Bridge process in addition to the existing app services; production may start it with a documented separate command. The extension is loaded unpacked from this repository.

## Failure handling and verification

- No template, unsupported/oversized input, disconnected extension, generation timeout, text-only reply, malformed output and missing approved file produce actionable errors.
- A retry keeps the selected template; changing the background excludes the last template where another valid one exists.
- Automated checks cover the Python job service and Bridge, the gateway proxy, extension behavior and React page rendering/interaction, followed by `npm test`, `npm run typecheck`, `npm run build`, and a local health smoke test.
- Real visual fidelity cannot be asserted automatically; verify it in a logged-in ChatGPT tab before considering an image usable.
