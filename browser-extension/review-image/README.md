# FFP Review Image Bridge

Load this directory as an unpacked Chrome extension (Chrome 116+). With Docker, connect to `ws://127.0.0.1:3011/api/review-images/extension` (adjust the published client port), or `wss://YOUR_DOMAIN/api/review-images/extension` remotely. Nginx forwards this socket to Review Image inside the existing Coordinator process. No separate Review Image server is needed.

Configure distinct, random `REVIEW_IMAGE_BRIDGE_TOKEN` and `REVIEW_IMAGE_EXTENSION_TOKEN` values (at least 24 characters), plus `SHOPIFY_PIPELINE_TOKEN`, in the server `.env` before running `docker compose up -d --build`. Keep these secrets out of Git and browser build variables. Enter only `REVIEW_IMAGE_EXTENSION_TOKEN` in the extension popup. The internal bridge token must not be shared with the extension. The Review Studio UI continues to use the Gateway operator credential.

Pin a signed-in ChatGPT tab, reload it, save the extension URL/token, grant the requested domain permission and enable the connection. One extension executor may connect at a time. Authentication uses the first WebSocket message, not a query parameter. Existing installations preserve their settings: change the old URL/token manually when switching to Docker.

The extension and ChatGPT tab still run on the operator's computer; Docker does not open a desktop browser or sign in for you. Legacy standalone development at `ws://127.0.0.1:8770/ws/extension` remains supported with its old local bridge credential; it is not the Docker production route.

Docker stores job, approval, template and upload metadata in the shared PostgreSQL database; image files live under `/app/.runtime/review-image` in the existing durable runtime volume. Back up both. Existing standalone files are not silently moved: re-upload needed templates through the UI and preserve legacy outputs separately. Old in-memory jobs cannot be reconstructed as approved jobs.

Shopify uploads run in the existing Pipeline Worker. An interrupted or ambiguous write is not automatically replayed: inspect Shopify Files before reconciliation. Interrupted ChatGPT jobs fail explicitly on restart; completed approvals and downloads survive restart. A timed-out UI upload can be checked again using the same job without enqueueing a duplicate.

Staging verification: run `python scripts/review-studio-smoke.py` inside `server`, restart `server`, then rerun with the printed job ID. This uses a fixture extension through client Nginx, creates a small `review-smoke` template/job, and never calls Shopify or ChatGPT. Do not run this fixture against a live operator deployment.

The extension attaches the scene template first and product image second. It waits for both uploads before sending the prompt. ChatGPT can still alter fine artwork or text, so approve only after visual inspection in the FFP Tool page.
