# Crawler classification at Codex SEO

New crawler jobs default to `classificationMode: automatic`. Missing mode means legacy/manual; existing jobs and Auto SEO keep their current behavior. The user can select manual mode before creating a job. Prices remain operator controlled, and the editable draft resets to zero surcharge/no compare-at only after job creation succeeds.

The crawler pipeline snapshots `crawlerClassificationMode` in the original execution snapshot. MCP semantic product input remains images, niche and store profile. Separate classification context supplies all target-store collections (fully paginated), their assignment capability and existing product types. This catalog is categorization metadata, never product evidence or instructions. Codex compares dominant visual themes across all collections with equal priority for manual and supported smart collections. Availability, list order, or matching only the physical product type is not evidence of a theme match. It cannot create collections, change collection rules or pricing.

`job_submit_draft.submission.classification` contains `status`, `collectionId`, `productType`, and `reason`. Automatic crawler submissions require `ready` and valid fields before the durable submission checkpoint; legacy/manual and Auto SEO submissions remain compatible. Missing, malformed, unresolved, wrong-store and unavailable catalog cases return specific `CLASSIFICATION_*` errors with repair hints. Codex retains its draft and saved analysis/research/keyword checkpoints and resubmits the complete payload with a new request ID after repairing only classification. Rejected submissions are not persisted or counted as completed. Never force a match when evidence is insufficient. Historical incomplete Review records still support operator repair without rerunning SEO. The catalog cache lives for 60 seconds and coalesces same-store reads. Failed fetches are not cached. Shopify `productTypes` and `collections` are read with full cursor pagination; collections with a rule set cannot be directly assigned.

The pipeline copies classification from the checkpoint to the per-product Review record. Automatic publication requires complete SEO, images and ready classification. Review edits can repair the selection without rerunning SEO. Coordinator sync endpoints and bulk queueing reject incomplete classification. Before product writes, the pipeline queries the chosen collection live. Manual collections use collection joins; supported smart collections use exact server-derived tags, merged into the final Shopify input after the product adapter. Tags participate in the sync checksum. Supported rules are one `TAG EQUALS` rule or an AND of such rules; complex, mixed, negative, multi-choice OR, or malformed rules fail closed without changing price, vendor or Shopify rule definitions. Deleted collections return to Review. Existing sync idempotency and image staging stay in force. Channel-only publication retries do not require reclassification.

Automatic submissions additionally require evidence containing current image IDs, the observed visual theme, the matching collection theme and a comparison against another catalog collection when alternatives exist. This makes choices auditable and rejects missing evidence, but is not an independent semantic classifier and does not guarantee perfect AI accuracy. No category names or store IDs are hardcoded. Historical results remain unchanged until explicitly repaired. Reconnect MCP sessions after updating the server to refresh the schema.

No new environment variables, database columns, token permissions or Windows Agent update are required. Existing JSON job/review payloads carry the additive fields. Update the Gateway, Coordinator, pipeline worker and frontend together; reconnect MCP clients to refresh the tool schema. No historical jobs or Shopify products are automatically reclassified.

Task branch: `feature/module-a-add-seo-product-classification`, based on `cua_pro` at the user's explicit request (exception to the handbook's default main-based workflow).

References: [Shopify productTypes](https://shopify.dev/docs/api/admin-graphql/latest/queries/productTypes), [Shopify collections](https://shopify.dev/docs/api/admin-graphql/latest/queries/collections).

## Verification and handoff

### Smart collection follow-up

- Branch `fix/module-a-support-rule-based-classification` continues the current feature stack without resetting earlier approved changes.
- Root cause: the manual-only catalog excluded rule-based thematic collections; ID validity alone did not prove thematic relevance.
- Focused classification/workflow/MCP tests: 21 passed. Typecheck and build passed. Full test run passed tooling (80) and web (1,106), then hit the existing Ads MCP audit failure and non-terminating Gateway suite; it was stopped, not reported green.
- Local server/client rebuilt and healthy. Read-only live verification returned all 30 collections for the affected store; the selected smart collection projected its exact current rule tag and no direct collection join. No Shopify mutations, historical repairs, VPS deployment or Git push performed.
- Four inspected historical products were already synced. Their incorrect collection assignments require an explicit, targeted Shopify repair; changing classification code does not retroactively rewrite published products.

### Classification repair follow-up

- Strict submission validation and actionable MCP repair hints prevent missing classification from silently becoming completed SEO. No new environment variables or database migration.
- Focused classification, V2 boundary and MCP tests: 17 passed. Typecheck and production build passed.
- Full `npm test`: tooling 80 passed, web 1,100 passed; Ads MCP user audit test failed and Gateway did not terminate, so the run was stopped. This is not an all-green suite.
- Local server image rebuilt and restarted; no Git push or VPS deployment. Two existing portrait Review records were repaired through the version-checked Coordinator update path, preserving SEO and images without requesting Shopify sync. The remaining leopard-stiletto design needs operator collection confirmation; no forced match was made.

### Initial implementation

- Gateway/MCP classification, V2 boundary, source-leakage, MCP access and auto-publish tests: 21 passed.
- Engine suite with isolated `LOCALAPPDATA`: 705 tests, 23 skipped, no failures. Focused classification/Review repair tests also passed after the final Coordinator edits.
- Web suite: 1,099 passed, 14 skipped; the additional direct-sync classification guard test passed in the focused seven-test Review suite.
- Crawler browser QA passed on desktop/mobile against an isolated mock preview using Chrome, including automatic/manual switching and preserved drafts.
- Typecheck, production build and mock build passed. `git diff --check` passed.
- `npm test` passed tooling and web, then encountered the existing Ads MCP `McpUserManager manages users, verifies tokens, and records audit logs` failure and did not complete the Gateway suite; it is not reported as an all-green run.
- No Shopify writes, VPS deployment, Docker service restart or Git push was performed for this task. Live classification accuracy and automatic Shopify publishing still need an operator-selected end-to-end test after local service deployment. Reconnect existing MCP sessions to load the new schema.
