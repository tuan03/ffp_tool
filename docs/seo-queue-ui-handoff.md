# Desktop SEO Queue refinement

## Summary

- Prioritized monitoring products and resolving issues on `/gpt-seo`, as requested. The queue is the default workspace; machines, Codex setup, runs and batch release live in a separate workspace. Switching preserves queue filters/page, settings drafts and the mounted machine panel. Store changes reset store-scoped state.
- Retained the four store-wide status summaries, with explicit selected states and unknown counts while loading. Server status/provider filters still run before pagination; text search is explicitly limited to the current page.
- Desktop table combines product name, thumbnail, readable ASIN/Shopify identity, source/provider and copyable job ID. Checkpoint names and safe operator error summaries replace opaque progress and raw internal messages. A bounded, keyboard-scrollable table keeps its header visible.
- Product details prioritize issues, eligible retry actions and recorded progress. Images, provider transfer and technical checkpoint/result payloads are collapsed below. Only ready jobs offer the Review handoff action; no automatic review approval or Shopify publishing was added.
- Moved queue cleanup into collapsed settings/secondary operations, explained its whole-store scope and retained the existing confirmation. A failed queue load displays recovery UI rather than stale actionable rows or an endless skeleton.
- Existing light/dark appearance retained. Desktop widths are the acceptance target; no mobile-specific redesign was implemented by explicit user instruction. No Crawler UI source was modified.

## Changed files

- `src/modules/custom-gpt-seo/ui/CustomGptSeoPage.tsx`: workspace composition, filtering/loading presentation, secondary operations and drawer wiring. Existing retry, transfer, release, configuration and cleanup endpoints are retained.
- `src/modules/custom-gpt-seo/ui/components/`: queue table, detail panel, reusable status/image presentation and clipboard control with manual-copy fallback.
- `src/modules/custom-gpt-seo/ui/queue-styles.ts`, `seo-queue-view-model.ts`: module-local styles and deterministic presentation helpers, with old-gateway fallbacks.
- `src/modules/custom-gpt-seo/types.ts`: optional, read-only `queueDisplay` catalog metadata on jobs.
- `gateway/custom-gpt-seo/queue-display.ts`, `handler.ts`: an allowlisted display projection on the existing admin job-list response. Source snapshots, full checkpoint bodies, results and instructions remain redacted. The projection does not modify stored jobs.
- Module/Gateway tests and `scripts/seo-queue-ui-smoke.mjs`: presentation, endpoint redaction and isolated desktop interaction coverage.

## Verification

- Focused module and Gateway checks: 52 passed, including the actual admin response, redaction and unchanged stored-job assertions.
- `npm run typecheck`: passed for app, Gateway and pipeline.
- `npm run build:mock`: passed.
- `npm run build`: passed in production mode, including worker/crawler packaging.
- `npm test`: tooling passed (76 passed, one skipped); web passed (1,089 passed, 14 skipped). Gateway reproduced the existing `McpUserManager` identity failure and retained workers. The test process tree alone was stopped at 120 seconds. The overall suite is not green; downstream stages were not reached.
- `node scripts/seo-queue-ui-smoke.mjs`: passed six desktop/theme combinations at 1280/1440/1920px with 55 fixture jobs. Covers server filters before pagination, source metadata, no per-row detail fetches, legacy fallback, clipboard, sticky table header, preserved workspaces/drafts, error drawer/focus, eligible retry, canceled cleanup, ready-only Review handoff, store reset and failed-load recovery. All APIs were intercepted; no live mutations.
- Authenticated Docker browser verification at `http://localhost:3011/gpt-seo`: passed metadata/title rendering, two themes and persistence, desktop bounds, machine workspace, drawer and zero runtime errors. Production verification triggered zero business writes. Also verified the Crawler's expanded collection/pricing and inline ASIN checker remain intact.
- `git diff --check`: passed. Logs/screenshots are ignored under `.cache/seo-queue-*`; no credentials or production records were committed.

## Contract / environment / route changes

- User explicitly approved the coordinated Gateway display-data addition. Existing `admin/jobs` jobs optionally include `queueDisplay: { sourceTitle, sourceHandle, checkpointStages }`. Titles/handles are bounded strings or null; stages contain only the four supported checkpoint names. No schema migration, new endpoint, environment variable or dependency.
- Compatible in both deployment directions: old clients ignore metadata; new clients on old Gateways show a readable source identity and explicitly unknown checkpoint detail, never an invented `0/4`.
- Processing, leasing, retry, transfer, validation, publishing, authentication and pagination logic are unchanged. No new polling or paid-provider calls.
- Retained `feature/main-redesign-tool-interface` by the user's explicit instruction, overriding the default new-branch workflow. No push or merge.

## Deployment and recovery

- Rebuilt the client and server images and replaced only those two containers in the existing `ffp-crawler-staging` Compose project. The database container ID/start time and durable mounts were preserved.
- Immediately before replacement: zero active SEO batches, processing SEO jobs, Worker runs, Spy jobs, crawler tasks, Pinterest jobs or pipeline claims. Existing items waiting for review/retry were not cleared or requeued by this work.
- After startup, the existing pipeline resumed scheduled work from its pre-existing retry backlog (three active claims observed). This is normal worker recovery, not a UI retry/publish request. No further backend restart was performed.
- Previous local images retained as `ffp-tool-client:before-seo-queue-9adf0fa` and `ffp-tool-server:before-seo-queue-9adf0fa`. Do not replace/restart an active backend for rollback without checking current work first. No images were pushed.

## Remaining TODOs or risks

- The existing Gateway MCP identity/test-worker shutdown issue remains outside this UI change.
- Text search remains page-local, and freshness remains manual via the existing refresh action; neither is presented as a global/live query.
- Unknown internal errors receive safe general guidance; detailed worker investigation still belongs in the worker/run tooling.
