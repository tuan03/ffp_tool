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
- Durable publish **core, not connected to the Sync button yet**: additive operation
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

The compatibility adapter retains the existing PostgreSQL advisory transaction
lock across legacy and new writers. Claims also lock selected job rows. This
intentionally serializes short database mutations during migration; no external
API request belongs inside a worker repository transaction.

## Remaining implementation before activation

1. Complete Review lifecycle integration: reapproval/regeneration/rollback
   reservation handling and diff metadata. Connect the tested publish core to an
   operator-only HTTP API, background scheduler and Review UI; add manual resolution
   for blocked operations and reconcile the existing Shopify SEO-version metafield.
   The new publisher is deliberately not scheduled or exposed as an endpoint yet.
   The current Sync button still uses the existing browser-driven flow.
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

On 2026-10-04 the focused worker/queue/publish suite passed 35/35 with an isolated
PostgreSQL 17 test container. A subsequent full Gateway regression with the test
database configured passed 425 tests, with 47 unrelated environment-dependent
tests skipped. Test containers contain synthetic data only; no production store
was converted and no Shopify mutation was executed against a real store.

Read-back compares all intended fields (JSON metafields semantically). A mismatch
after a possibly successful write requires operator reconciliation; the core does
not assume that retrying is safe. Shopify read/version-check/write is not an atomic
remote compare-and-swap. AEO metafield storage alone does not prove theme rendering.

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
