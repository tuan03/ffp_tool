# FFP Review Image Bridge

Version 1.5.1 fixes QA text completion detection and reports waiting/reading/sending
progress. Reload both the extension and the pinned ChatGPT tab after updating;
settings and credentials remain unchanged. A timed-out response is not resent automatically.

Load this directory as an unpacked Chrome extension (Chrome 116+). With Docker, connect to `ws://127.0.0.1:3011/api/review-images/extension` (adjust the published client port), or `wss://YOUR_DOMAIN/api/review-images/extension` remotely. Nginx forwards this socket to Review Image inside the existing Coordinator process. No separate Review Image server is needed.

Configure distinct, random `REVIEW_IMAGE_BRIDGE_TOKEN` and `REVIEW_IMAGE_EXTENSION_TOKEN` values (at least 24 characters), plus `SHOPIFY_PIPELINE_TOKEN`, in the server `.env` before running `docker compose up -d --build`. Keep these secrets out of Git and browser build variables. Enter only `REVIEW_IMAGE_EXTENSION_TOKEN` in the extension popup. The internal bridge token must not be shared with the extension. The Review Studio UI continues to use the Gateway operator credential.

Pin a signed-in ChatGPT tab, reload it, save the extension URL/token, grant the requested domain permission and enable the connection. One extension executor may connect at a time. Authentication uses the first WebSocket message, not a query parameter. Existing installations preserve their settings: change the old URL/token manually when switching to Docker.

The extension and ChatGPT tab still run on the operator's computer; Docker does not open a desktop browser or sign in for you. Legacy standalone development at `ws://127.0.0.1:8770/ws/extension` remains supported with its old local bridge credential; it is not the Docker production route.

Docker stores job, approval, template and upload metadata in the shared PostgreSQL database; image files live under `/app/.runtime/review-image` in the existing durable runtime volume. Back up both. Existing standalone files are not silently moved: re-upload needed templates through the UI and preserve legacy outputs separately. Old in-memory jobs cannot be reconstructed as approved jobs.

Shopify uploads run in the existing Pipeline Worker. An interrupted or ambiguous write is not automatically replayed: inspect Shopify Files before reconciliation. Interrupted ChatGPT jobs fail explicitly on restart; completed approvals and downloads survive restart. A timed-out UI upload can be checked again using the same job without enqueueing a duplicate.

Staging verification: run `python scripts/review-studio-smoke.py` inside `server`, restart `server`, then rerun with the printed job ID. This uses a fixture extension through client Nginx, creates a small `review-smoke` template/job, and never calls Shopify or ChatGPT. Do not run this fixture against a live operator deployment.

The extension attaches the scene template first and product image second. It waits for both uploads before sending the prompt. ChatGPT can still alter fine artwork or text, so approve only after visual inspection in the FFP Tool page.

Reference roles: the server adds a visible `SCENE_BACKGROUND` or `REPLACEMENT_PRODUCT` header to each transport-only image copy. Step 2 supplies the scene; step 3 supplies the replacement product, never its background. Original uploads and saved templates are unchanged. References retain the full photograph and aspect ratio, are oriented using EXIF, and may be resized/compressed to stay within 4096 pixels and 5 MB. Prompts explicitly exclude headers and padding from the generated image. Existing custom prompts cannot change this role contract; the server applies it to every store.

After updating to extension 1.4.1, reload the unpacked extension at `chrome://extensions` and reload the pinned ChatGPT tab. Docker updates do not reload a browser content script. Server-side visual labels also work with older extensions; 1.4.1 repeats the label/framing rule at the final send step. Previously generated images are not automatically regenerated or uploaded to Shopify. Test a new image and visually compare both its scene and product with the two sources before approval.

Extension 1.4.2 prevents duplicate attachments for all stores (including Preaureum, Jeminise and Capozen). Each file is dispatched once; an ambiguous confirmation timeout stops the job instead of uploading again. The composer must start empty, gain exactly one preview per upload, and contain exactly two completed attachments immediately before Send. Wrapping cards and their image previews count as one attachment. Extra/missing attachments or an unrecognized composer stop the job without sending or deleting operator content. Inspect/clear leftover drafts or open a new chat before retrying. Reload both the unpacked extension and its pinned ChatGPT tab to activate this change; no Windows Agent update is needed.
# Review text support (1.5.0)

The unified Review Studio runtime now supports synthetic QA review text as well as
image tasks. Reload this extension and the pinned ChatGPT tab after upgrading;
keep the existing server URL and token. No Vertex credentials or Windows crawler
update are needed. Use the unified `/api/review-images/extension` connection.

Image and text tasks share one serial executor. Text prompts open a fresh chat so
previous image instructions cannot affect the response. Do not manually edit the
composer while a task is running. If ChatGPT requests login/verification or reaches
a usage limit, resolve it manually; the bridge does not bypass those requirements.
See `docs/review-text-bridge.md` for job persistence, cancellation and save retry.
