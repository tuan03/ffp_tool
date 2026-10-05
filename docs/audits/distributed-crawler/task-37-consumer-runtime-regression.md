# Task 37 — Shared consumers and runtime regression

**Status:** Automated regression and local runtime smoke passed on 2026-10-05.
**Branch:** `cua_pro`. No container or agent was restarted; no external Shopify/AI write was performed.

## Scope

Checklist Task 37 maps to original specification sections 49 and 56 and the FFP three-container constraint. Coverage includes Amazon Reviews, Pinterest POD, Review Studio, pipeline worker, internal routes, and the unified runtime topology.

## Evidence

- Fresh full `npm test` after Task 36 — exit 0: tooling 51 passed/1 skipped, web 905 passed/7 skipped, Gateway 402 passed/53 skipped, crawler engine 534 passed/17 skipped, Review Image 34 passed, Pinterest 22 passed. Optional/environment-specific skips were not counted as executed tests.
- Review Studio/operator cross-composition on isolated local PostgreSQL: `FFP_REVIEW_AUDIT_POSTGRES=1 python -m unittest scripts.audits.test_review_operator_boundary -v` — 2 passed. The test creates and drops only a unique audit schema.
- Read-only inspection of local Compose project `ffp-crawler-staging`: exactly `client`, `server`, `database`; all three report healthy. The `server` container process table showed Main Gateway, Crawler Coordinator, Pinterest POD, and Pipeline Worker.
- Direct internal health probes: Gateway `:3001/health` = 200; Coordinator `:8766/api/v1/health` = 200; Pinterest `:8768/api/pinterest-pod/health` = 200. Coordinator health through the local Nginx public client port = 200.
- Source-level unified architecture tests in `npm test` verify three production services, no published internal ports, and Nginx route ownership for Amazon Reviews, Pinterest, Review Studio, Gateway, Coordinator, and internal paths.

## Limits

- No real Shopify mutation, Amazon Reviews AI generation, Pinterest account/OAuth operation, or browser UI write was performed; these would require external credentials and could have external side effects. Their local unit/contract tests passed.
- One optional real-Nginx test is skipped without `FFP_NGINX_TEST_IMAGE`; the running local client Nginx and coordinator health route were smoke-tested directly.
- The root working tree has no `.env`, so `docker compose` from the current repository cannot resolve `POSTGRES_PASSWORD`. Existing `.env.local` points `DATABASE_URL` at `127.0.0.1`, which is not valid as a container-to-database address; it was not passed into Compose. No stack rebuild/restart was attempted.

Task 38 is a separate full 20-agent fault-acceptance scenario. The two-agent recovery test and component-level command tests are not substitutes for that acceptance criterion.
