# Custom GPT SEO validation

Validated on Windows with Node 22.22.0 and the repository's existing dependencies. No live Shopify writes, paid AI calls, browser/GPU sessions or crawler load were used.

| Command | Result |
| --- | --- |
| `npm test` | Tooling 6/6; web 659/659; gateway 250/251. Overall exit 1 due to the existing Windows symlink test below. |
| `npm run test:engine` | 180 tests completed, 1 skipped; success. Run separately because the top-level command stops at gateway failure. |
| `npm run typecheck` | Pass across application, gateway and pipeline projects. |
| `npm run build` | Pass; bundle-size and browser-externalization warnings remain. |
| `npm run build:mock` | Pass; same warning categories. |
| Focused Custom GPT and external SEO tests | 25/25 passed. |
| `git diff --cached --check` | Pass before commit. |

## Existing environment failure

`gateway/__tests__/staged-uploads.test.ts`: `assertPathInAllowedRoots blocks arbitrary file reads, traversal, and symlink escapes` fails with Windows `EPERM` while creating its symlink fixture. The test is unchanged by this branch. The full suite is therefore not green and must be rerun in a symlink-capable environment before merge.

## Covered behavior

- HTTP Actions from enqueue through analysis, mocked search suggestions, real local conflict validation, submission and human Review readiness.
- Large original snapshots retained behind admin authentication while Actions receive bounded product context.
- Persistent queue restart and a 1,000-fixture drain with batches bounded to ten, without duplicate processing. This is queue-level validation, not a VPS or browser performance benchmark.
- Cross-store/authentication isolation, idempotent replay, stale lease fencing, checkpoint invalidation and expired batch recovery.
- Validation failures, missing/wrong image evidence, conflicting keywords, unsupported content claims, and explicit provider transfer boundaries.
- Auto SEO backup outbox replay with provider/settings snapshots.
- Amazon worker release while pending, preserved job identity through human approval and sync, stable corpus ownership after Shopify identity resolution.
- Duplicate sync fencing, uncertain-write reconciliation, superseded draft rejection, and completed no-op bookkeeping recovery.
- External finalization with network access mocked to fail, proving that path does not call paid providers.
- Signed image URL expiry and allowed-host checks.

## Deferred acceptance

The operator chose to configure the HTTPS domain later. Live Custom GPT image access/manual attachments, Actions Builder validation, VPS deployment/load, and real Capozen publish/rollback remain unverified. Follow the live acceptance steps in README before production use.

Keyword ownership is conservative: old targets remain reserved during draft review, and rejected drafts do not automatically release every reservation. Local conflict retrieval is not exhaustive semantic coverage. Reconciliation after an uncertain Shopify write requires operator verification; the runbook describes the protected admin endpoints.
