# SEO worker implementation status

## Delivery boundary

This is the first implementation increment of the approved worker plan, not a
production-ready worker release. No store is automatically switched to worker
mode. Do not call `enableStore` in production until the new MCP, source guards,
administration, and publish integration have passed acceptance testing.

Implemented in this increment:

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

The compatibility adapter retains the existing PostgreSQL advisory transaction
lock across legacy and new writers. Claims also lock selected job rows. This
intentionally serializes short database mutations during migration; no external
API request belongs inside a worker repository transaction.

## Remaining implementation before activation

1. New MCP endpoint and checkpoint service, with live Shopify source/version
   validation, image access, existing SEO/AEO rules, and submission receipts.
2. Operator-only Agent Access APIs, CSRF protection, UI, pagination, worker/run
   status, safe token issuance, and a guarded cutover command with backup/report.
3. Cross-platform Agent Pack, OS credential storage, STDIO bridge, heartbeat,
   login/status/logout/doctor, archive checksum, and setup smoke tests.
4. Complete Review lifecycle integration: reapproval/regeneration/rollback
   reservation handling, diff metadata, durable backend publish operation,
   uncertain-write reconciliation, and exactly-once SEO version history.
5. Expand real PostgreSQL multi-process tests to endpoint crash/recovery; run two
   actual Codex sessions, cross-platform credential tests, and an operator-selected
   pilot product/store.

Existing Gemini, Custom GPT, SEO Performance, and stores not converted keep their
current behavior. The worker credentials are not accepted by any HTTP endpoint
in this increment. There is no worker publish or arbitrary database tool.

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

Required regression commands remain `npm test`, `npm run typecheck`,
`npm run build`, and `npm run build:mock`.

## Defaults and operational constraints

- Token: 24 hours; claim denied with less than ten minutes remaining.
- Lease: ten minutes; heartbeat: sixty seconds; recovery: sixty seconds.
- No-progress deadline: thirty minutes, not extended by heartbeat alone.
- Attempts: at most five; retry starts at thirty seconds with bounded jitter,
  capped at ten minutes. Invalid-draft repair limit is reserved for the checkpoint
  integration and is not implemented by the repository alone.
- A run counts a job only after `REVIEW_READY` and its durable delivery flag.
- Accepted drafts awaiting delivery are never regenerated due to lease expiry.
- Failed/blocked work keeps its pipeline reservation until explicitly resolved.
- Store conversion is one-way at the protocol level. Pause claims instead of
  returning new-state jobs to an old application binary.

Work is on the existing `rua` branch by explicit user instruction, overriding the
handbook's new-branch default. No production cutover or Shopify write is part of
this increment.
