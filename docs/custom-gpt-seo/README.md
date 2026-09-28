# Custom GPT SEO

This module supports Amazon → Customize → SEO and Auto SEO → backup → SEO. Gemini remains the default. Select Custom GPT at `/gpt-seo` to enqueue new products. Batch size is 1–10 (default 5). Results stay on the server until a human reviews them.

## Setup

For commands and expected results, follow the [step-by-step setup guide](setup.md): local setup, HTTPS, GPT Builder and the first batch.

1. Deploy the gateway and pipeline worker, with the existing Amazon coordinator for Amazon flows. Use a supported Node 22 patch release with `node:sqlite` (tested locally on 22.22.0). Keep SQLite and `.runtime` on persistent local storage shared by the gateway and pipeline worker; do not deploy multiple gateway writers across machines.
2. Configure server-only environment variables:

```dotenv
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=3001
GATEWAY_AUTH_TOKEN=<dedicated-internal-admin-secret>
GPT_SEO_ACTION_KEYS_JSON={"capozen":"<capozen-random-action-secret>","wrydeco":"<wrydeco-random-action-secret>"}
GPT_SEO_DB_PATH=.local-data/custom-gpt-seo.sqlite3
GPT_SEO_PUBLIC_URL=https://seo.example.com
SHOPIFY_GATEWAY_URL=http://127.0.0.1:3001/api/shopify
```

Generate an independent random Action secret for every store using your password manager. Never commit them. The Bearer key determines the store; a GPT cannot select another store through request input. Legacy single-store deployments may continue using `GPT_SEO_ACTION_KEY` with `GPT_SEO_STORE_ID`, but `GPT_SEO_ACTION_KEYS_JSON` takes precedence when set. Set `GPT_SEO_PUBLIC_URL` after selecting your domain; omit it for local mock work. When set, image Actions return short-lived store-scoped signed URLs. Internal administration uses the gateway key. Changing providers does not convert existing GPT jobs.

3. Serve HTTPS using the supplied Caddy example. Merge it with the existing deployment routes and environment configuration for image processing, Shopify and the Amazon coordinator; it is not a replacement for the complete application deployment. Protect browser/admin routes with authentication. Never expose the gateway or coordinator ports directly to the internet.
4. In GPT Builder create a private Custom GPT. Enable available image-understanding capabilities. Paste `gpt-instructions.md` into Instructions.
5. Import `openapi.json` into Actions, replacing `https://seo.example.com` with the HTTPS domain. Set Authentication → API Key → Bearer to that GPT's store-specific key from `GPT_SEO_ACTION_KEYS_JSON`. Reuse the schema for other stores, but never reuse a store's key. Do not add secrets to schema or instructions.
6. Add `seo-knowledge.md` as Knowledge. Test capabilities and queue access in Builder before using products.
7. Run the vision acceptance below. Configure provider and batch size at `/gpt-seo`, then send products from Amazon or Auto SEO.

To generate the schema after choosing a domain, without editing tracked files:

```sh
node scripts/export-custom-gpt-schema.mjs https://your-domain.example > /tmp/ffp-gpt-openapi.json
```

## Operator guide

- “Xem các sản phẩm Capozen đang chờ SEO.”
- “Xử lý một batch, lưu từng sản phẩm để tôi duyệt.”
- “Tiếp tục batch đang dở, rồi xử lý các batch tiếp theo.”
- “Báo các sản phẩm cần bổ sung ảnh hoặc dữ liệu.”

If images cannot be viewed from URLs, open the product details on `/gpt-seo`, download/open each image and attach it to GPT, including the displayed jobId/imageId. The job stays waiting until the evidence is available. This is an accepted manual fallback, not an AI API fallback.

Queue pages contain at most 50 summaries; individual details load separately. Auto SEO results load into SEO Review from the backend. Amazon results return through the pipeline worker and coordinator's existing review/image-processing flow. Approving still requires an explicit Sync action in the existing Review UI.

## Live acceptance — operator account required

Use safe fixtures first. The automated suite does not prove that a particular GPT/account can open images.

1. Provide an image containing a distinctive visual detail absent from its name and product metadata.
2. Ask GPT to describe it through the URL path. Verify the detail independently.
3. If unsuccessful, attach the image manually and verify the same observation.
4. Run one Amazon and one Auto SEO fixture through all Actions; ensure both reach human Review with correct image IDs and original backups.
5. Interrupt after analysis, reopen the conversation and resume without losing progress.
6. Verify no Gemini/Vertex/OpenAI API traffic on the custom branch. Google Suggest requests are expected.
7. Only then run a marked Capozen test product. Review and sync manually; verify Shopify and rollback using the normal workflow.

## Recovery and limitations

- A lease lasts 30 minutes. An expired owner cannot write. Reclaim using a new requestId.
- Duplicate submissions with the same ID/content are safe; a different payload needs a new ID.
- Queue state survives process restarts. The finalizer processes one product at a time. A crash after corpus registration can replay the same product registration.
- A new enqueued source revision cancels older unfinished work and unsynced Review drafts. Already started or completed sync operations retain their history. Changes made directly in Shopify after enqueue still require human comparison before sync.
- Keyword conflict retrieval is local; GPT performs semantic reasoning on returned matches. It is not equivalent to exhaustive semantic search and has no ranking guarantee.
- Old committed keywords are conservatively retained while a replacement is only a draft. Do not assume a rejected draft automatically frees all keywords.
- Image evidence is self-reported by GPT; the backend validates coverage and IDs, not the truth of visual interpretation. Human review remains essential.
- Auto SEO retains existing source images and applies new alt text. Amazon's existing image-processing worker handles image conversion/artifacts. A source image URL is not proof a WebP conversion occurred.
- ChatGPT may require user interaction or stop between batches. Queue persistence enables resume; it cannot make ChatGPT an unattended daemon.

## Operations

Back up SQLite using SQLite's online backup command/API, not a copy of the database file alone while WAL writes are active. Back up `.runtime/seo-conflict-corpus-*.json` and image artifacts during a maintenance pause. Stop services before restoring matching backups. Rotate the Action key on the server and in Builder together; never rotate by placing the key in a URL.

For a 2-core/4-GB VPS, keep one finalizer, one image-processing task and bounded crawler concurrency. Test 10, 100, then 1000 mock jobs before live load. Measure RSS and latency on the VPS; local queue test timings do not establish production throughput. Stop increasing load above 80% memory consumption.

To roll back provider selection, choose Gemini for new work. To change a specific waiting job, release its batch and use the explicit provider-transfer controls in its details; switching to Gemini starts paid API work and clears incompatible reasoning checkpoints. Do not delete the database to change providers.

Official constraints: [Actions production](https://developers.openai.com/api/docs/actions/production), [file support](https://developers.openai.com/api/docs/actions/sending-files). Actions use HTTPS, a 45-second request timeout and text payload limits; file responses do not support images directly.

### Uncertain Shopify writes

A timeout after a write starts retains the sync lock; automatic retries cannot safely decide whether Shopify changed. Stop the pipeline worker and close active Review tabs before reconciliation. Verify the product and operation logs in Shopify first.

Use the internal gateway with `X-Gateway-Key` (never the GPT Actions key):

1. GET `/api/v1/gpt-seo/admin/sync-state?storeId=capozen&jobId=<jobId>` returns the current token/status.
2. POST `/api/v1/gpt-seo/admin/reconcile-sync` with JSON `{"storeId":"capozen","jobId":"<jobId>","token":"<current-token>","outcome":"SYNCED","note":"<what you verified in Shopify>"}`.
3. Use `NOT_WRITTEN` only after verifying that no write occurred or the write was fully rolled back. This permits a new claim; a superseded source remains blocked. Partial writes must be resolved through existing Shopify reconciliation before clearing this lock.
4. Restart the worker and refresh Review. Reconciliation is audited and never performs a Shopify mutation itself. It does not update coordinator review state; use the existing coordinator reconciliation flow for Amazon products as well.

The reconciliation endpoints are intentionally excluded from GPT Actions.

See [validation.md](validation.md) for exact automated results and deferred live acceptance.
