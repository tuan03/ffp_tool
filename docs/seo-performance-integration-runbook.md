# SEO Performance Integration Runbook

This runbook operates the read-only Google Search Console (GSC) and Google Analytics 4 (GA4) integration described in `todo/README_FFP_SEO_PERFORMANCE_INTEGRATION_TEAM_PLAN.md`. It does not authorize Shopify writes, SEO approval, publishing, production credential activation, or a claim that SEO caused an observed change.

The initial pilot store is `jeminise`. Do not start its backfill until the owner has confirmed the exact public origin, raw GSC property identifier, numeric GA4 Property ID, and GA4 hostname/stream scope.

## 1. Security boundary and prerequisites

- Keep client secrets, refresh tokens, encryption keys, database URLs, cookies, and authorization codes in the deployment secret store. Never paste them into chat, Git, screenshots, tickets, test fixtures, or command output captured as evidence.
- Use a dedicated Google identity with the least access needed to the selected GSC and GA4 properties.
- Use only the read-only scopes:
  - `https://www.googleapis.com/auth/webmasters.readonly`
  - `https://www.googleapis.com/auth/analytics.readonly`
- Keep `SEO_PERFORMANCE_ENABLED=false` until configuration, mapping scope, and rollback ownership have been reviewed.
- Keep production publishing disabled throughout QA. Recommendation validation may create a draft only when the approved acceptance case reaches that stage; it must not approve or publish.

Required owner-supplied values for `jeminise`:

| Value | Required confirmation |
| --- | --- |
| Store ID | `jeminise` |
| Public storefront origin | Exact HTTPS origin, including the intended host |
| GSC property | Exact raw identifier from Search Console, including `sc-domain:` or URL-prefix syntax |
| GA4 Property ID | Numeric Property ID, not Measurement ID |
| GA4 scope | Verified hostname and, when used, stream ID |
| GA4 settings | Property timezone and currency |
| Reconciliation range | Approved finalized dates and representative product URLs |

Stop and request owner direction if a hostname/path maps ambiguously to multiple stores, the exact property is unknown, or one GA4 property cannot isolate `jeminise` reliably.

## 2. Google Cloud setup

1. In the intended Google Cloud project, enable:
   - Google Search Console API.
   - Google Analytics Data API.
2. Configure the OAuth consent screen.
   - Choose **Internal** only when the deployment and every operator are eligible members of the same Google Workspace organization. Otherwise choose **External**.
   - Add only the two read-only scopes listed above.
   - Add the pilot operator as a test user when the app is in Testing.
   - An External app in Testing commonly issues refresh tokens that expire after seven days for these non-basic scopes. Treat a reconnect at that boundary as an OAuth publishing-state issue, not as lost analytics data. Before stable production operation, have the owner confirm the audience, publishing status, and any required Google verification.
3. Create an OAuth client of type **Web application**.
4. Register exactly this redirect URI, substituting the deployed FFP origin:

   ```text
   https://<ffp-host>/api/seo-performance/oauth/callback
   ```

   It must match `GOOGLE_OAUTH_REDIRECT_URI` byte-for-byte. Use HTTPS; do not include credentials, a fragment, or a trailing variation not registered with Google.
5. Store the client ID and secret through the deployment secret manager. Do not put them in a browser-exposed `VITE_` variable.

## 3. Server environment

Use the combined Google variable names for new deployments:

| Variable | Purpose |
| --- | --- |
| `SEO_PERFORMANCE_ENABLED` | Runtime feature switch; use `false` until activation is approved |
| `AUTO_SEO_DATABASE_URL` | Preferred PostgreSQL connection used by the gateway |
| `DATABASE_URL` | Database fallback when `AUTO_SEO_DATABASE_URL` is absent |
| `GOOGLE_OAUTH_CLIENT_ID` | Server-side Web OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Server-side Web OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Exact HTTPS callback URI registered in Google Cloud |
| `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters (32 bytes) for refresh-token encryption |
| `SEO_PERFORMANCE_GATEWAY_URL` | Development UI proxy target; not an OAuth credential |

`GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REDIRECT_URI`, and `GSC_TOKEN_ENCRYPTION_KEY` are legacy fallbacks. Do not mix legacy and combined credentials in a new deployment. Rotate into the combined variables deliberately, then verify reconnect behavior.

Before activation:

1. Confirm the callback host is reachable over HTTPS.
2. Confirm PostgreSQL backup/restore ownership and that migrations completed.
3. Confirm the encryption key is present in the secret store and is not printed by diagnostics.
4. Start with `SEO_PERFORMANCE_ENABLED=false`, deploy, and inspect startup configuration errors.
5. Change the flag only in the approved environment and restart the gateway. Feature activation and Google authorization are separate decisions.

## 4. Connect and map `jeminise`

All management requests require an authenticated administrator. Mutating requests also require the `X-FFP-Performance: 1` opt-in header. Prefer the UI so the OAuth state cookie and administrator session remain bound correctly.

1. Open SEO Performance for `jeminise`.
2. Start a connection requesting both `gsc` and `ga4`. A store may reuse one Google connection for both sources or use separate connections.
3. Complete Google consent and return through the configured callback.
4. Verify both granted scopes. A legacy GSC-only grant must be explicitly re-consented for GA4; do not infer GA4 permission from a successful GSC call.
5. List GSC properties and choose the exact owner-confirmed identifier. Preserve that raw identifier in mapping. Encoding occurs exactly once only when building the Google request URL.
6. Confirm the selected property can read an in-scope `jeminise` product URL and a finalized seven-day Search Analytics range.
7. Map the numeric GA4 Property ID with the verified hostname scope, property timezone, currency, and optional stream ID. A Measurement ID such as `G-...` is not a Property ID.
8. Reopen the integration status and record each source independently: connection, mapping revision, permission, origin/hostname scope, and freshness.

Important current-contract check: if the deployed UI/API can confirm only the GSC mapping and does not expose the full GA4 mapping fields, stop. Do not use an undocumented database edit or pretend GA4 is mapped. Record `GA4 mapping operation unavailable in deployed contract` and return it to the integration owner.

Every mapping correction creates a new mapping revision. Do not overwrite historical facts or combine facts from different revisions during reconciliation.

## 5. Sync operation

### Backfill and incremental policy

- Initial approved backfill: 90 days.
- Incremental overlap: reprocess the most recent seven days for both GSC and GA4.
- GSC Search Analytics: `type=web`, `dataState=final`; use `America/Los_Angeles` calendar dates, including daylight-saving changes.
- GA4: use the mapped property timezone and exact `sessionSource=google` plus `sessionMedium=organic` filter.
- Keep landing-page engagement, event activity, landing revenue, and item performance as separate compatible GA4 reports. Do not add ratios or other non-additive metrics across rows.
- A GSC query filter has no equivalent GA4 keyword filter. The GA4 panel must be `unsupported/N/A`, never unfiltered data labelled as query-filtered data.

Only enqueue a backfill after both the store scope and mapping revision are confirmed. Refresh or reopen the page during a run to prove durable progress. A failed middle page/partition must not be marked complete or exposed as complete output. Retry provider throttling according to the durable job policy; never bypass quota controls with parallel manual jobs.

### Freshness and quality vocabulary

Report freshness independently for GSC, URL Inspection, and GA4:

| Field | Meaning |
| --- | --- |
| `data_through` | Latest provider date included in the completed dataset |
| `fetched_at` | Time the provider response was retrieved |
| `last_successful_sync` | Time the last complete source-specific sync committed |
| `stale` / stale reason | Policy result with an explicit reason, not an inference from row existence |

Coverage and fetch completion are different. `fetchComplete=true` means all requested pages/partitions were fetched and committed; it does not mean Google exposed every query or event. Surface these states when applicable:

- GSC: finalized versus preliminary, provider coverage/hidden queries, partial partitions, unavailable data, normalized alpha-3 country, and normalized device.
- GA4: thresholding, sampling, `(other)` row, data loss from `(other)`, truncation, provider/fetched row counts, timezone, currency, quota metadata, partial and unavailable panels.
- Item performance: an absent or ambiguous temporal product mapping is `N/A` and cannot affect a recommendation.

Never replace a quality warning with zero. Never advance `last_successful_sync` for a partial or failed partition.

## 6. Read-only `jeminise` reconciliation

Perform this only after the owner supplies the approved properties, dates, and URLs. Capture redacted evidence in `todo/SEO_PERFORMANCE_REAL_DATA_EVIDENCE_TEMPLATE.md`.

Freeze these parameters before comparing:

| Parameter | Required exact value |
| --- | --- |
| Store | `jeminise` |
| Mapping revision | Current revision for the compared source |
| GSC property | Exact raw property identifier |
| GSC search settings | Web, finalized data, identical dates and aggregation |
| GSC filters | Exact page, query, country and device slice for each comparison |
| GSC timezone | `America/Los_Angeles` calendar dates |
| GA4 property | Exact numeric Property ID |
| GA4 scope | Verified hostname/stream scope |
| GA4 dates/timezone | Identical range in the mapped property timezone |
| GA4 acquisition | `sessionSource=google` AND `sessionMedium=organic` |
| GA4 dimensions | Identical landing-page/event/item dimension for the selected panel |

Reconcile GSC separately; never sum overlapping domain and URL-prefix properties:

1. Property totals for the fixed finalized range.
2. One exact normalized page.
3. Returned queries for that page using identical page/query/country/device filters and aggregation.

Then reconcile GA4 in Reports or Explore with the identical property, date range, timezone, hostname/landing scope, dimensions, metric definition, and session-acquisition filters. Record thresholding, sampling, `(other)`, truncation, and instrumentation availability before comparing values.

Clicks and impressions should reconcile when both sides use the same GSC dataset. CTR and position may differ only by display rounding. Every larger difference needs a concrete explanation and rerun evidence; there is no generic 10% tolerance. GSC clicks and GA4 sessions are different metrics and are never expected to equal each other.

The reconciliation must remain read-only: no Shopify mutation, SEO approval, publish, Search Console request-indexing call, GA4 configuration edit, or production credential revocation.

## 7. Negative cases

Run in a non-destructive staging environment and record safe error codes/messages with secrets redacted:

1. **Expired access token:** allow the client to refresh successfully and confirm the source remains connected without losing its mapping revision.
2. **Wrong or out-of-scope property:** attempt mapping with a property the identity cannot access or a URL outside the confirmed store scope. Confirm rejection and no current mapping/facts are replaced.
3. **Revoked refresh grant:** revoke a dedicated test grant, confirm `RECONNECT_REQUIRED`, and reconnect explicitly. If the owner does not authorize revoking the pilot credential, do not revoke it; record the limitation and use a separate test grant.
4. **Partial pagination:** inject or simulate a middle-page failure. Confirm no completed partition output, no false success freshness, and a retryable/terminal job state according to policy.
5. **GA4 quality/compatibility:** verify query-filtered GSC context returns GA4 unsupported, missing metadata returns unavailable, and ambiguous item mapping remains N/A.
6. **Isolation:** an authenticated operator without `jeminise` access cannot list, map, sync, or read its integration data.

## 8. Chrome acceptance checklist

Use `@Chrome` against the approved local/staging deployment. Redact the address bar/query values, account identity, cookies, authorization codes, and all secrets before saving evidence.

- [ ] Open SEO Performance for `jeminise`; confirm store isolation and no cross-store property leakage.
- [ ] Connect Google; confirm GSC and GA4 permissions/statuses are independent.
- [ ] Map the exact GSC property and numeric GA4 Property ID/hostname scope; record the mapping revisions.
- [ ] Start the approved 90-day sync and observe source/partition progress.
- [ ] Refresh, navigate away/back, and restart the gateway; confirm progress and freshness persist.
- [ ] Confirm retryable, terminal, stale, partial, disconnected, and reconnect-required states use safe messages.
- [ ] Confirm finalized/preliminary, thresholding, sampling, `(other)`, truncation, partial, unavailable, and source-specific freshness indicators appear when applicable.
- [ ] Apply a GSC query filter; confirm GA4 is explicitly unsupported/N/A, not silently unfiltered.
- [ ] Confirm a v0/no-baseline version is N/A and not scored.
- [ ] Confirm insufficient, collecting, stale/low-volume, and eligible benchmark states are distinguishable.
- [ ] Confirm ambiguous item mapping and missing instrumentation cannot request a rewrite.
- [ ] For the one owner-approved safe recommendation, confirm exactly one deduplicated draft is created; it remains unapproved and unpublished.
- [ ] Reopen SEO Review/Auto-SEO and confirm no duplicate draft or implicit publish occurred.

## 9. Disconnect and rollback

### Safe disconnect

1. Stop or allow in-flight source jobs to reach a durable boundary; record their IDs.
2. Disconnect the intended Google connection through the authenticated integration control.
3. Confirm the connection and its current store integrations become `DISCONNECTED` and cached access is unusable.
4. Preserve historical facts, mapping revisions, sync runs, benchmarks, and evidence for audit. Do not manually delete tables to represent a disconnect.
5. Reconnect explicitly and create/confirm a new current mapping revision before resuming ingestion.

Revoking a shared connection affects every source/store reference using that grant. Enumerate those references before disconnecting.

### Operational rollback

1. Set `SEO_PERFORMANCE_ENABLED=false` in the affected environment and restart the gateway to stop new performance work.
2. Disable new evaluator/recommendation jobs and operator send controls. Do not delete or rewrite provider facts.
3. Return the UI to the existing compatible GSC report behavior where available.
4. Preserve database backups and additive migrations; prefer a forward fix over manual schema reversal.
5. Rotate a compromised OAuth secret/encryption key through the secret manager under an incident plan. Do not rotate the token-encryption key without a refresh-token migration/re-consent plan.
6. Record the incident window, affected mapping revisions/jobs, data-through dates, and the exact recovery decision.

## 10. Completion and evidence

Use `todo/SEO_PERFORMANCE_REAL_DATA_EVIDENCE_TEMPLATE.md` for every pilot run. Attach fresh deterministic tests, PostgreSQL tests, fault/security checks, reconciliation values, and Chrome screenshots. A fixture proves calculations only; it is not live-impact evidence.

Until a complete, quality-eligible Before/After observation window exists, the evidence must state exactly:

```text
28-day live impact observation: pending data maturity
```

Even after maturity, describe Before/After as observational. This integration does not prove that Auto-SEO caused an uplift, that all Google queries are visible, or that GSC clicks should equal GA4 sessions.
