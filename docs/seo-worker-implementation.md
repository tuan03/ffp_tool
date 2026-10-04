# SEO worker implementation status

## Delivery boundary

This is an incremental implementation of the approved worker plan, not a
production-ready worker release. No store is automatically switched to worker
mode. Do not call `enableStore` in production until the new MCP, source guards,
administration, and publish integration have passed acceptance testing.

Implemented:

- Additive PostgreSQL worker metadata referencing existing `gpt_jobs`.
- Hashed, store/machine-bound credentials with 24-hour expiry and revocation.
- Worker session fencing, persistent runs, pause/resume, and exactly-once success
  accounting based on the existing durable Review delivery.
- Single-job claims, lease versions, ten-minute leases, bounded retry, attempt
  history, and a thirty-minute progress deadline independent of heartbeats.
- Server recovery every minute, including preservation of committed drafts while
  their Review delivery is pending.
- Cutover preflight for duplicate product identities and unfinished legacy work.
- Legacy claim/mutation guard and enqueue uniqueness for converted stores.
- Disabling new claims does not reopen the legacy batch protocol.
- `/mcp/seo-worker` with store-bound worker/run/lease tools, image access,
  checkpoint analysis, real keyword research/conflict checks and draft submission.
  No approval, publish, store administration or GSC tools are exposed.
- Live Shopify `updatedAt` checks before reading context and submitting existing
  products. Unversioned existing-product snapshots fail closed. External reads
  occur outside SQL transactions and writes recheck the lease afterwards.
- Authenticated, idempotent checkpoint receipts; ordered checkpoints and a
  two-repair limit within an attempt. Existing finalizers and delivery outbox are
  reused; submission acceptance never increments run success.
- Operator-only `/api/seo-agent/tokens`, `/runs`, `/revoke`, guarded by Basic
  operator authentication, JSON/custom-header CSRF checks and no CORS. Worker and
  gateway bearer credentials alone cannot administer tokens. Responses are no-store.
- Queue Agent Access panel: create/copy-once/revoke credentials, paginated machine
  and run lists, token-free Start Prompt. Store changes remount the panel.
- Preview Agent Pack under `tools/seo-agent-pack`: Python STDIO HTTPS bridge,
  hidden terminal login, OS-vault-only credentials, bounded heartbeat and additive
  project MCP/skill setup. No automatic credential installation or production login.
- Durable publish core: additive operation
  and version-history tables, frozen approved fields/review fingerprint, one active
  operation per product, expiring writer lease, and bounded read retries. An
  uncertain write is read back, never blindly resent. Mismatching fields block the
  operation and preserve the existing sync guard/product reservation.
- Exactly-once local version recording after read-back confirmation, with legacy
  browser finish/reconcile APIs prevented from overriding a backend receipt.
  Active operations freeze Review edits. A known source baseline is retained;
  absent historical versions are not interpreted as a count of previous SEO runs.
- A Shopify transport allowlist for title, description, SEO metadata, existing image
  alt text and AEO metafields; no vendor, handle, prices or variants are sent.
  Version-guarded updates now fail closed when the current product is unreadable,
  missing, or has no version, rather than proceeding with an unverifiable write.
- Opt-in backend integration through `SEO_WORKER_PUBLISH_ENABLED=true`: the
  Gateway attaches the Shopify transport at startup, and its persistent queue tick
  processes pending operations without a browser tab. Operator authentication and
  PostgreSQL are required. This does not convert any store automatically.
- Operator-only `GET/POST /api/seo-agent/publish` and
  `POST /api/seo-agent/publish-reconcile`, with the same CSRF/no-store protection as
  Agent Access. Responses expose a receipt, never internal lease IDs. Reconciliation
  only rereads a possibly written operation; it never resends a Shopify mutation.
- Review exposes backend receipts/status, polls pending operations, and routes both
  individual and batch Sync through the backend for converted stores. A disabled
  backend fails closed instead of falling back to browser writes. Approve remains
  separate from Sync. Published Review snapshots are immutable. Detail view includes
  source/proposed content comparison; direct browser rollback/force is blocked.

The compatibility adapter retains the existing PostgreSQL advisory transaction
lock across legacy and new writers. Claims also lock selected job rows. This
intentionally serializes short database mutations during migration; no external
API request belongs inside a worker repository transaction.

## Remaining implementation before activation

1. Complete Review lifecycle presentation, including full run/worker/validation
   metadata and revision-chain browsing. New-revision regeneration and the Shopify
   SEO-version transport are implemented for converted Codex stores (see below).
   Read-only reconciliation is implemented; no force
   overwrite or release of an unresolved write is exposed.
   Backend Sync is opt-in and only applies to converted stores. Unconverted stores
   retain the existing browser-driven flow. No production activation was performed.
   This core accepts existing Shopify products only; new-product creation and
   storefront/theme rendering are outside this increment.
2. Guarded operator cutover command with verified backup/dry-run/report and
   integration with the latest deployment topology on `main`. No activation API
   is intentionally exposed yet.
3. Expand real PostgreSQL multi-process tests to endpoint crash/recovery; run two
   actual Codex sessions, cross-platform credential tests, and an operator-selected
   pilot product/store.
4. Complete pack distribution/schema resources, image-view enforcement evidence,
   user-action validation feedback, Retry-After/backoff and run recovery UX. The
   helper currently stops safely on transport errors rather than retrying blindly.

Existing Gemini, Custom GPT, SEO Performance, and stores not converted keep their
current behavior. The new endpoint accepts worker credentials, but claims remain
disabled until explicit store conversion. There is no worker publish or arbitrary
database tool. Do not treat availability of a token or tool as rollout approval.

## Verification

Focused deterministic SQL tests use PGlite and injected time. They are not proof
of multi-process PostgreSQL behavior or two independent Codex workers.

```powershell
node node_modules/tsx/dist/cli.mjs --test gateway/__tests__/seo-worker-*.test.ts
```

The live PostgreSQL test uses the existing `SEO_QUEUE_TEST_DATABASE_URL` setting
and creates/removes its own randomly named `seo_worker_test_*` schema. Configure
a dedicated test database, never production. Without that setting it is skipped.

On 2026-10-04 the focused suite passed 23/23 against an isolated PostgreSQL 17
container, including legacy queue migration regression, two simultaneous Node
processes claiming different jobs, and deterministic lease/recovery tests.
This is not a two-Codex-session or multi-platform Agent Pack acceptance result.

Additional deterministic tests cover operator authentication/CSRF/store isolation,
checkpoint receipts and revocation, live-source guard failure modes, MCP tool
capabilities and stateless HTTP JSON compatibility. Helper tests cover additive
setup, refusal to overwrite config, plaintext vault refusal, HTTPS-only endpoints,
redirect refusal and idle heartbeat stopping. These do not use production records.

The follow-up focused suite passed 28/28 (zero skips) on 2026-10-04 with an
isolated PostgreSQL 17 container, including the existing two-process claim test
and queue migration regressions. The container used only tmpfs test data and was
removed afterwards. HTTP/MCP tests use PGlite; they do not yet prove multi-Gateway
crash recovery on live PostgreSQL. Production databases were not accessed.

Build the public preview archive after web builds (which replace `dist`):

```text
python scripts/build-seo-agent-pack.py
```

See `tools/seo-agent-pack/README.md` for configuration, supported vaults and the
remaining platform acceptance boundary. Setup follows the official Codex MCP and
skills documentation linked there; the skill preserves the draft-only workflow.

Required regression commands remain `npm test`, `npm run typecheck`,
`npm run build`, and `npm run build:mock`.

### Publish core verification boundary

`gateway/__tests__/seo-publish*.test.ts` covers lost write responses, lease expiry,
stale-writer fencing, same-timestamp Review edits, changed source, bounded retries,
store isolation, protected-field exclusion and exactly-once local version history.
The optional PostgreSQL test uses two independent queue clients and tests exclusive
claim, enqueue replay and legacy API protection. This is not an actual Shopify
write, multi-Gateway crash drill or end-to-end UI acceptance result.

The follow-up PostgreSQL test also starts a separate Node process which exits
after persisting a write intent. Two fresh processes race to recover the expired
lease; one read-back confirmation records one version, without sending another
write. Shopify is an injected test transport here, not a real remote API. Actual
two-machine Codex/Gateway and Shopify fault-injection acceptance remain outstanding.

On 2026-10-04 the focused worker/queue/publish suite passed 35/35 with an isolated
PostgreSQL 17 test container. A subsequent full Gateway regression with the test
database configured passed 425 tests, with 47 unrelated environment-dependent
tests skipped. Test containers contain synthetic data only; no production store
was converted and no Shopify mutation was executed against a real store.

Read-back compares all intended fields (JSON metafields semantically). A mismatch
after a possibly successful write requires operator reconciliation; the core does
not assume that retrying is safe. Shopify read/version-check/write is not an atomic
remote compare-and-swap. AEO metafield storage alone does not prove theme rendering.

## Backend publish configuration and pilot gate

1. Complete the backup/cutover preflight and resolve duplicate active jobs first.
   Do not manually enable all production stores to test this feature.
2. Configure server-only `SEO_WORKER_PUBLISH_ENABLED=true` with existing operator
   authentication and PostgreSQL, then restart the Gateway. Leave it `false` until
   the selected store and source snapshots have passed cutover checks.
3. Human approval saves the Review only. Sync returns HTTP 202 and a receipt.
   Reopening Review reads the persisted operation; the server owns completion.
4. A blocked possibly-written operation can request read-back through Retry Sync.
   A pre-write source/review failure requires reassessment, not resending old content.
5. Turning the flag off pauses processing and denies new publish requests. It does
   not delete operations, reopen legacy sync for converted stores, or undo writes.

On 2026-10-04 the user selected Shopify product `8901018878151` in `jeminise-real`
for the pilot. Read-only inspection of the VPS found its job `PENDING`, with no
approved Review, and found no worker/publish tables in the production schema.
No production mutation, migration, approval or publish was performed. The pilot
therefore requires a validated draft, human approval and a reviewed deployment
before an actual Shopify write can be tested.

The helper's five unit tests passed on Windows and inside a network-disabled Linux
Python 3.13 container. These are not OS-vault integration or real Codex-session
tests. macOS and actual credential vault login/logout remain unverified.

## Revision and Shopify version increment (2026-10-04)

- Operator-only `POST /api/seo-agent/revisions?storeId=...` accepts `jobId`, a UUID
  `requestId`, and optional instructions. It fetches the current Shopify product
  outside the SQL transaction. The transaction rechecks the parent, closes its
  reservation and enqueues a fresh revision with empty checkpoints. The old job and
  Review remain unchanged. Instructions supplement, not replace, existing rules.
- The Review regeneration dialog selects this route for converted stores. Only
  `codex_mcp` is supported here; Gemini/Custom GPT providers are never silently changed.
  Legacy unconverted regeneration remains unchanged.
- One successor per parent and store/request fingerprint prevent duplicate revisions.
  Retry with the same key returns the stored receipt without another Shopify read.
  Parent Reviews cannot be edited or newly published after being superseded.
- Unresolved writes block regeneration. A pre-write BLOCKED operation can be marked
  `superseded_by` while retaining its receipt/history; the active-product index now
  excludes those superseded operations. This migration replaces only that index,
  adds columns/tables and does not delete business records.
- New publish operations read `custom.seo_version` (`number_integer`) from Shopify.
  The frozen target is one above the maximum remote/local/baseline version. The
  intended mutation includes that metafield; read-back must match it before local
  success is recorded. Invalid remote versions fail closed. Operations with a write
  intent predating this change are reconciled against their original frozen fields;
  no extra remote write is invented to backfill their version.
- A Windows Credential Manager write/read/delete probe passed using a temporary
  random credential, not a production token. Python dependencies were installed in
  an ignored `.runtime/seo-vault-test` environment. macOS/Linux vault and two physical
  Codex sessions remain pending. Follow the pack README acceptance checklist.

No production migration, approval, Shopify write, or store conversion was performed
for this increment. A real Shopify version round-trip remains part of the pilot.

Verification for this increment: `npm test` passed (tooling 42; web 845 passed/6
skipped; Gateway 432 passed/47 skipped; engine 305 tests/1 skipped). The isolated
PostgreSQL 17 test database was enabled for the full run, including revision
concurrency/history preservation and publish subprocess recovery tests. Typecheck,
production build, mock build and five helper unit tests passed. Builds retain the
existing large-chunk warning. Live Shopify is still replaced with test transports.
The temporary PostgreSQL container used only synthetic tmpfs data and was removed.
The rebuilt preview ZIP has SHA-256
`8fd094eb35fb7c462e0e854ab1d6564e5b75af369a07311bdb35ab62740e2beb`.

## Defaults and operational constraints

- Token: 24 hours; claim denied with less than ten minutes remaining.
- Lease: ten minutes; heartbeat: sixty seconds; recovery: sixty seconds.
- No-progress deadline: thirty minutes, not extended by heartbeat alone.
- Attempts: at most five; retry starts at thirty seconds with bounded jitter,
  capped at ten minutes. At most two revisions after invalid output per attempt.
- A run counts a job only after `REVIEW_READY` and its durable delivery flag.
- Accepted drafts awaiting delivery are never regenerated due to lease expiry.
- Failed/blocked work keeps its pipeline reservation until explicitly resolved.
- Store conversion is one-way at the protocol level. Pause claims instead of
  returning new-state jobs to an old application binary.

Work is on the existing `rua` branch by explicit user instruction, overriding the
handbook's new-branch default. No production cutover or Shopify write is part of
this increment.
