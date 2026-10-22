# ChatGPT review-text jobs

Review Studio generates synthetic QA fixtures through the same authenticated browser
executor used for review images. Vertex is no longer called by the review-samples
endpoint. Other features using Google APIs are unchanged. This is a browser bridge,
not the OpenAI API; a logged-in pinned ChatGPT tab and extension 1.5.0+ are required.

## Local setup

Reload the unpacked extension at `browser-extension/review-image` in
`chrome://extensions`, then reload the pinned ChatGPT tab. Keep the existing server
URL, token, and tab selection. The extension advertises `review_text_v1`; old versions
receive an explicit update-required message. No Windows crawler update is needed.

Build/restart both local server and client, retaining database/runtime volumes.
The existing `REVIEW_IMAGE_BRIDGE_URL`, `REVIEW_IMAGE_BRIDGE_TOKEN`, operator Basic
credentials, and PostgreSQL connection are reused; no new secret is required.
This feature targets the unified Coordinator Review Studio runtime, not the legacy
standalone port-8770 bridge. Do not run multiple Gateway owners against this queue.

## API and lifecycle

- `POST /api/amazon-reviews/samples`: `{contextJobId, storeId, count, requestId}`;
  returns HTTP 202 with a public job snapshot. Count is 1–50.
- `GET /api/amazon-reviews/samples?contextJobId=...&storeId=...`: latest snapshot.
- `GET /api/amazon-reviews/samples/:id`: one snapshot.
- `POST /api/amazon-reviews/samples/:id/cancel`: cancel waiting/generating jobs.
- `POST /api/amazon-reviews/samples/:id/retry-save`: retry only persistence.

These routes retain Gateway authentication. Old synchronous callers must update;
the old request shape receives 422 instead of silently invoking a different provider.
Gateway reads authoritative context and prior samples from Coordinator. It stores
generation state in the additive `review_text_jobs` PostgreSQL table, with unique
request IDs and one active task per context, including across store selections.
Repeated request IDs cannot change context/store/count. Server-side sample IDs
continue from the greatest saved suffix, including gaps from partial results.

The shared Bridge lock serializes image and text prompts. Each text prompt opens a
new chat, including repairs: another image can run between attempts, so current-tab
history cannot safely be used as a repair context. Repair prompts are self-contained.
Text execution has a 10-minute limit; waiting plus execution is bounded at 30 minutes.
No uncertain prompt is automatically replayed. One quality-repair attempt is allowed
after a response, while accepted samples are retained if repair fails.

Gateway validates samples, persists the accepted output, then saves to Coordinator.
Reloading the UI does not stop this work. Save failures retain output and block new
generation until retry-save or cancellation. Saving is non-cancellable to avoid a
false claim that a committed result was discarded. Restarted incomplete tasks become
interrupted, or save_failed if an accepted output was stored. Late cancelled results
are ignored; deleted context is never recreated by the worker.

UI errors and health checks expose no tokens or full prompts. Output remains
`synthetic: true`, `verifiedPurchase: false`, and QA-only. Existing image approval,
Shopify-file upload and XLSX exports are unchanged. No customer reviews are published.

## Verification

Run focused Gateway job/provider tests, review module tests, unified Review Studio
Python tests, and both extension test scripts, followed by `npm test`,
`npm run typecheck`, `npm run build`, and `npm run build:mock`.
Test disconnection recovery, duplicate clicks, reload, image/text interleaving,
cancellation, invalid JSON, partial repair, save retry, and context deletion.
Fixture WebSocket/browser tests do not establish successful real ChatGPT generation;
report a live pinned-tab trial separately.
