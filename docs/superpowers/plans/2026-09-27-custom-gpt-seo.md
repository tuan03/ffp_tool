# Custom GPT SEO implementation plan

Goal: add a persistent, store-scoped Custom GPT Actions queue for Amazon and Auto SEO, with human review before Shopify writes.

## Contract
- Provider is selected per store and snapshotted when work is enqueued. Gemini remains the default.
- GPT performs all reasoning and image interpretation. No paid AI fallback in the custom provider.
- Batch size defaults to 5, is bounded to 1–10, with one active batch per store and a renewable 30-minute lease.
- Persist source snapshots, per-stage checkpoints, submissions and delivery state in SQLite. Mutations are fenced and idempotent.
- Stages: product/image evidence, shopping context, real search suggestions, keyword conflict decisions, content, deterministic image processing.
- Results remain drafts until human review. Actions have no Shopify publishing permissions.
- HTTPS Actions use a dedicated store-scoped key. Browser administration uses existing gateway authentication.
- Verify URL vision in a real GPT; manual image attachments are the accepted fallback. Never treat an image URL as visual evidence.

## Tasks
1. Queue contracts, SQLite persistence, leases, checkpoints and focused tests.
2. Actions, authentication, limits, schema and instructions.
3. External SEO validation/finalization without paid providers.
4. Provider routing for Auto SEO and Amazon with durable handoff.
5. Configuration/queue UI and durable Review integration.
6. Deployment/runbook, mock load and regression verification.
7. Whole-branch review, focused commits and new pull request.

## Acceptance
Mock tests precede live tests. Cover restart, duplicate requests, stale leases, cross-store access, partial batches, input changes, conflicts, malformed content and missing image evidence. Run npm test, typecheck, build and build:mock. Live GPT/VPS acceptance requires operator account/domain access; report it separately.

## Ownership
Coordinated changes authorized in custom-gpt-seo, seo-content public services, orchestrator, gateway, crawler coordinator/worker, app configuration/routes and SEO Review. No unrelated refactoring, dependency upgrades, AGENTS edits or Shopify writes during automated tests.

Branch: feature/orchestrator-add-custom-gpt-seo. Base: cf1f84a. New PR against main; do not merge.
