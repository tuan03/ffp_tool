# Custom GPT SEO: setup and first batch

This guide enables the Custom GPT provider for Capozen. Both Amazon and Auto SEO results require human approval and an explicit sync in SEO Review.

## 1. Choose the setup stage

| Stage | Available behavior | Requirements |
| --- | --- | --- |
| Local mock UI | Settings screen and deterministic fixtures | No domain or real credentials |
| Local real queue | Enqueue products and inspect pending jobs | Existing store configuration; Amazon also needs coordinator, agent and worker |
| Live GPT Actions | GPT claims batches and returns drafts | Public HTTPS domain, Action key, GPT Builder setup and image acceptance |

The domain can be selected later. Leave `GPT_SEO_PUBLIC_URL` unset until then. A localhost URL in the Action schema does not expose your computer to ChatGPT.

Run commands from the repository root. All Node services must use the same working directory so relative SQLite and keyword corpus paths resolve consistently.

## 2. Prerequisites

- Use a Node version supporting the repository dependencies and `node:sqlite`; this implementation was verified with Node 22.22.0.
- On a fresh checkout, install dependencies using `npm ci`. Changing SEO providers does not require reinstalling dependencies.
- For Amazon, follow the existing [development guide](../development-guide.md) for Python, Playwright and crawler-agent setup. Starting the web app does not register an agent automatically.
- Keep the existing Capozen store registry/client credentials. The GPT Action key does not authenticate Shopify.
- Live processing requires a ChatGPT account/workspace with access to creating GPTs and Actions.

Check Node:

```powershell
node --version
node -e "require('node:sqlite'); console.log('SQLite available')"
```

An experimental SQLite warning is acceptable. An unknown-module error means the Node executable is too old. Restart terminals and services after changing Node.

## 3. Configure the environment

Edit the existing root `.env.local`; do not overwrite an existing file. Node services read this file, with process environment variables taking precedence. A plain `.env` alone is not the Node gateway's configuration source. Never put secrets in `VITE_` variables.

```dotenv
GATEWAY_STORE_ID=capozen
GATEWAY_AUTH_TOKEN=<internal-admin-secret>
GPT_SEO_ACTION_KEY=<different-random-action-secret>
GPT_SEO_STORE_ID=capozen
GPT_SEO_DB_PATH=.local-data/custom-gpt-seo.sqlite3
GATEWAY_PORT=3001
SHOPIFY_PIPELINE_COORDINATOR_URL=http://127.0.0.1:8766
SHOPIFY_PIPELINE_WORKERS=1
# Set only after choosing the public HTTPS origin:
# GPT_SEO_PUBLIC_URL=https://seo.your-domain.example
```

Generate the two secrets independently using your password manager. Preserve existing `GATEWAY_SHOP_DOMAIN`, `GATEWAY_CLIENT_ID`, `GATEWAY_CLIENT_SECRET` and `STORE_CAPOZEN_*` settings. Do not place real keys in GPT instructions, Knowledge, screenshots or committed examples.

The environment file does not select the SEO provider. Provider and batch size are stored per store through the GPT SEO page. Gemini is the default; existing jobs retain their settings snapshot when you change provider.

If using `SHOPIFY_PIPELINE_TOKEN`, inject the same value into the Python coordinator process environment and worker configuration. Do not assume Python reads Node's `.env.local`. Production services should receive it through their service environment files.

## 4. Start locally without a domain

### Mock UI

```powershell
npm run dev:mock
```

Open `/gpt-seo` on the Vite URL. This uses deterministic module fixtures; it does not validate real SQLite persistence or live GPT Actions. Stop it before starting another UI on the same port.

### Real Auto SEO queue

```powershell
npm run dev:web
```

Vite gateway middleware serves the queue/admin APIs. Open `http://127.0.0.1:5173/gpt-seo`, enter `capozen`, choose **GPT Custom**, set batch size to **5**, and save. Refresh to verify persistence before sending products.

Use Auto SEO to select a safe fixture or approved test product, then run its backup/SEO handoff. Expect navigation to GPT SEO and a `PENDING` product, with no generated content yet. An empty queue is normal until a source sends work.

### Real Amazon queue

For the combined local launcher, leave `SHOPIFY_GATEWAY_URL` unset in both `.env.local` and the terminal environment. The pipeline worker starts its embedded gateway on port 3001. Do not start another gateway on that port.

```powershell
npm run dev
```

The launcher starts Vite, the coordinator on port 8766 and the pipeline worker. It does not start a crawler agent. Configure/start the existing agent separately using `npm run dev:agent` and the repository's agent configuration.

```text
Amazon agent -> coordinator -> Normalize/Customize -> GPT queue PENDING
-> GPT processing -> REVIEW_READY -> worker image processing
-> coordinator SEO Review -> human approval -> explicit Shopify sync
```

A product waiting for GPT releases its worker claim. It does not occupy a crawler tab while you work in ChatGPT.

If using a separate gateway, set `SHOPIFY_GATEWAY_URL=http://127.0.0.1:3001/api/shopify` and start that gateway through the existing deployment. The worker does not start an embedded gateway when this variable is set.

## 5. Connect HTTPS later

1. Point the selected domain to the VPS and configure a valid HTTPS certificate.
2. Set `GPT_SEO_PUBLIC_URL` to the HTTPS origin without a path/query; restart Node services.
3. Adapt [Caddyfile.example](../../deploy/custom-gpt-seo/Caddyfile.example) to the existing deployment. Preserve existing application, image-processing and coordinator routes. Protect browser/admin routes; Actions use their own Bearer authentication.
4. Bind the gateway to loopback. Do not expose ports 3001 or 8766 directly. Signed `/api/v1/gpt-seo/media` URLs must reach the gateway without a separate browser login.
5. For a separate Linux gateway, adapt [ffp-gateway.service.example](../../deploy/custom-gpt-seo/ffp-gateway.service.example). Configure `SHOPIFY_GATEWAY_URL` on the worker to avoid a second listener. Coordinator and worker need their own services.
6. Keep `.local-data` and `.runtime` persistent and writable by the service account. Do not run separate machines against independent copies of the same active queue.

Export the domain-specific schema on Windows PowerShell:

```powershell
node scripts/export-custom-gpt-schema.mjs https://seo.your-domain.example | Set-Content -Encoding UTF8 "$env:TEMP/ffp-gpt-openapi.json"
```

On Linux:

```sh
node scripts/export-custom-gpt-schema.mjs https://seo.your-domain.example > /tmp/ffp-gpt-openapi.json
```

The export changes the server URL, embeds no secrets and leaves the tracked schema unchanged.

## 6. Configure GPT Builder

1. Create a private GPT, for example **Capozen SEO Queue**.
2. Paste [gpt-instructions.md](gpt-instructions.md) into Instructions.
3. Upload [seo-knowledge.md](seo-knowledge.md) as Knowledge.
4. Add an Action and paste/import the exported OpenAPI JSON.
5. Set authentication to **API Key**, select **Bearer**, and enter `GPT_SEO_ACTION_KEY`.
6. Verify 16 operations appear. The schema must not include admin settings, reconciliation or Shopify publishing.
7. Test `getSeoCapabilities`, `getStoreSeoContext` and `getSeoQueueStatus`. Confirm store `capozen` and the batch size configured in the app.
8. Save the GPT. If a managed workspace restricts Actions domains, have its administrator allow the selected domain.

Use the application Action key, not an OpenAI API key or gateway admin key. Refer to the official [Actions setup guide](https://developers.openai.com/api/docs/actions/getting-started) and [authentication guide](https://developers.openai.com/api/docs/actions/authentication).

## 7. Run the first batch

1. Begin with one safe product. Ask GPT to list Capozen's pending products and process one batch for review.
2. Confirm GPT sees a distinctive image detail absent from product metadata. Receiving a URL is not proof of vision access.
3. If URLs cannot be viewed, open the job details in `/gpt-seo`, download/open the images, and attach them to the GPT conversation with the displayed `jobId/imageId`. For a `WAITING_INPUT` job, supply the missing information, use the queue's retry control, then ask GPT to resume/reclaim it.
4. GPT saves analysis, real search suggestions, keyword decisions and a draft. Backend status `VALIDATING` does not mean completion.
5. Wait for `REVIEW_READY`. Auto SEO drafts appear in SEO Review. Amazon drafts appear after the worker completes image processing; that worker must remain running.
6. Compare original and draft, edit if needed, approve, then explicitly sync only the approved test product.
7. Verify Shopify and rollback using the existing Review workflow before production batches.

Ask GPT to resume the active batch and continue subsequent batches when desired. Sessions can stop or require interaction. Checkpoints support resume, but do not make ChatGPT an unattended overnight worker.

## 8. Troubleshooting

| Symptom | Check / next action |
| --- | --- |
| `401` | Correct Action Bearer key, saved Builder authentication and gateway environment. |
| `403 STORE_FORBIDDEN` | GPT can process only `GPT_SEO_STORE_ID`. |
| `404` or HTML response | Route `/api/v1/gpt-seo/*` to the gateway instead of the SPA. |
| `409` lease/active batch | Resume or release the existing batch; reclaim expired work with a new request ID. |
| `429` | Respect Retry-After and process sequentially. |
| `WAITING_INPUT` | Supply facts/images, retry through the UI and resume in GPT. |
| `NEEDS_CHANGES` | Revise the indicated stage and submit with a new mutation request ID. |
| Still pending after selecting Gemini | Existing jobs retain provider snapshots. Release the batch and explicitly transfer the job; Gemini incurs API usage. |
| Amazon ready in GPT but absent in Review | Check worker/coordinator health, image-processing configuration and job errors. |
| `EADDRINUSE` on 3001 | Do not run standalone and embedded gateways together. |
| Unknown Shopify write / sync already started | Follow [uncertain-write reconciliation](README.md#uncertain-shopify-writes); do not repeatedly publish. |
| Queue disappears after restart | Check working directory, `GPT_SEO_DB_PATH`, persistent storage and service permissions. |

## 9. Increase load gradually

For the 2-core/4-GB target, begin with one pipeline worker, batch size five and low crawler concurrency. Validate ten products before increasing load while measuring memory and queue latency. The automated 1,000-job test covers queue behavior only; it is not a VPS throughput guarantee.

Follow the [backup/operations guide](README.md#operations). See [validation.md](validation.md) for exact automated results and deferred live acceptance.
