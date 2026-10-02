# Parallel Codex SEO Batches Design

**Date:** 2026-09-30  
**Status:** Proposed  
**Scope:** Gateway SEO queue, Codex MCP authentication, and SEO queue administration UI

## Context

The SEO queue currently permits only one active batch per Shopify store. If two
Codex installations use the same store token, both installations observe the
same active batch and lease. This makes it unsafe for two machines to process
different batches concurrently.

The required behavior is:

- Two Codex machines may process different batches for the same store at the
  same time.
- A job may belong to only one active batch, so workers cannot overwrite each
  other's work.
- Each machine may resume only its own active batch.
- Existing single-token configuration must continue to work.
- The administration UI must show every active batch for the store.
- This change must not publish products to Shopify or add an automatic publish
  step.

## Chosen design

Each Codex machine receives a separate MCP token and a stable, human-readable
worker ID. The server resolves the bearer token to both `storeId` and
`workerId`. Batch ownership is then scoped to that worker instead of the entire
store.

The invariant becomes **one active batch per worker per store**, while several
workers may each hold a different active batch for that store.

### Configuration

The current single-token form remains valid:

```json
{
  "capozen": "legacy-token"
}
```

It is interpreted as worker ID `default`.

The new form assigns one token to each named machine:

```json
{
  "capozen": {
    "office-pc": "token-for-office-pc",
    "laptop": "token-for-laptop"
  }
}
```

The parsed configuration will use an internal credential contract equivalent
to:

```ts
interface McpCredential {
  readonly storeId: string;
  readonly workerId: string;
  readonly secret: string;
}
```

Tokens must remain unique across all stores and workers. Worker IDs must be
non-empty, stable configuration labels and must never contain or reveal the
token. Existing checks preventing MCP tokens from matching other gateway keys
remain in effect.

### Authentication and isolation

The MCP HTTP handler authenticates the bearer token and passes an internal
owner ID to the MCP server. Codex ownership uses a namespace such as
`codex_mcp:<workerId>`. Custom GPT Actions use a fixed owner ID such as
`custom_gpt`.

The worker ID is server-derived. MCP clients cannot submit or override it in a
tool argument. Raw bearer tokens are never returned by an endpoint, written to
the database, logged, or displayed in the UI.

`get_seo_work` returns only the caller's resumable batch. It must not reveal
another worker's lease token. Store-wide queue counts may still be returned
because they contain no lease authority.

### Database migration

Add a non-null `owner_id` column to `gpt_batches` and increment the SQLite
schema version.

Existing rows are migrated according to their provider:

- Existing Codex MCP batches receive owner ID `codex_mcp:default`.
- Existing Custom GPT batches receive owner ID `custom_gpt`.

This preserves the ability of a legacy single-token Codex configuration to
resume an existing batch after deployment.

The existing store/request idempotency constraint remains. Batch lookup gains
an owner-scoped path, and the queue gains an administrative query that lists
all active batches for a store.

### Atomic claim behavior

Claims continue to run inside SQLite `BEGIN IMMEDIATE` transactions. Within
the transaction, the queue performs these steps:

1. Expire stale batches and return their unfinished jobs to `PENDING`.
2. Return the batch created by the same request ID when the request is retried.
3. Check for an active batch belonging to the requesting owner. If one exists,
   return or report that batch rather than claiming a second one.
4. Select only `PENDING` jobs matching the store and requested provider.
5. Insert the new owner-scoped batch and assign the selected jobs to it.
6. Commit the transaction before returning the lease.

`BEGIN IMMEDIATE` serializes competing claim writes. Even when two machines
claim at nearly the same time, the second transaction can select only jobs
that remain `PENDING` after the first transaction commits. Therefore the two
batches cannot contain the same job.

Checkpoint, completion, failure, and release operations remain authorized by
the existing batch ID and lease token checks. Releasing or expiring one batch
affects only jobs assigned to that batch.

### Provider behavior

Provider filtering remains unchanged: Codex workers claim only `codex_mcp`
jobs, and Custom GPT claims only `custom_gpt` jobs. Owners may run concurrently
because job assignment and lease checks are batch-scoped.

No AI work is moved into FFP Tool. Codex still calls the MCP tools, examines
the product images and facts, submits checkpoints, and moves jobs to
`REVIEW_READY`.

### Administration UI

The authenticated SEO queue administration response will include
`activeBatches`, containing all active batches for the selected store. The
existing singular `activeBatch` field may remain temporarily as the first
entry for backward compatibility while the UI migrates.

The SEO queue page replaces the single active-batch notice with a compact list.
Each row shows only safe operational information:

- worker ID;
- provider;
- batch ID;
- number of assigned jobs;
- expiration time;
- release action.

Releasing a row releases only that batch. The interface never displays a lease
token or MCP bearer token.

## Error and recovery behavior

- A worker requesting another batch while it owns an active one is directed to
  resume its current batch.
- A worker with no remaining matching `PENDING` jobs receives the existing
  empty-queue response and no batch is created.
- An expired lease cannot checkpoint or finalize a job.
- A failed or released batch returns only its unfinished jobs to `PENDING`.
- Invalid or duplicate token configuration fails during environment parsing;
  production must not silently fall back to a shared identity.

## Compatibility and boundaries

- Existing `storeId -> token` configuration remains supported as worker
  `default`.
- Existing MCP tool names and client-visible arguments remain unchanged.
- No new browser secret or `VITE_` environment variable is introduced.
- No Shopify mutation, sync, approval, or publishing behavior changes.
- No new dependency is required.

## Test strategy

Implementation follows test-driven development. Focused tests will first prove
the current implementation fails the new requirements, then cover:

1. Parsing both legacy and multi-worker MCP configurations.
2. Rejecting duplicate secrets and invalid worker definitions.
3. Two owners claiming the same store concurrently and receiving disjoint job
   sets.
4. One owner resuming its own active batch without seeing another owner's
   lease.
5. Independent expiry and release of parallel batches.
6. Two MCP bearer tokens for one store resolving to separate workers and
   separate batches.
7. Custom GPT provider filtering and legacy single-token behavior.
8. The admin response and SEO queue UI representing multiple active batches.

Before handoff, run the focused tests and the repository-required commands:

```bash
npm test
npm run typecheck
npm run build
```

Run `npm run build:mock` only if mock/runtime behavior is changed.

## Acceptance criteria

- With ten pending Codex jobs and batch size five, two configured Codex
  workers can claim five different jobs each for the same store.
- No job ID appears in both active batches, including under concurrent claims.
- Each worker's `get_seo_work` response contains only its own active batch and
  lease.
- Releasing, expiring, or completing one batch does not alter the other active
  batch.
- The admin UI lists both active batches and can release either one
  independently.
- Legacy one-token deployments behave as one worker without configuration
  changes.
- No code path publishes to Shopify.

## Alternatives considered

### Shared token plus a client-supplied machine name

This would avoid issuing a second token, but any client holding the shared
secret could impersonate another machine or accidentally change its name. It
also cannot reliably protect leases between machines, so it is rejected.

### Keep one store-wide batch and split jobs inside it

This would require machines to coordinate ownership at the individual-job
level and would expose a shared lease token. Recovery and checkpoint auditing
would become more complex, so it is rejected.

### Separate token and server-derived worker identity

This is the chosen option because authentication, ownership, recovery, and UI
auditing align around the same stable identity without changing MCP tool
arguments.
