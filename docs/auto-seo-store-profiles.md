# Auto SEO runtime store profiles

Shopify access and SEO policy are separate configuration requirements. A store
can load products successfully while its Auto SEO policy is not yet configured.

## Configuration

Open the existing **Sửa store** dialog, choose an appropriate **SEO profile**, and
save. For a handbag store, choose the Preaureum handbag policy
(`preaureum-handbags`). Do not select a policy solely from a store-name prefix.

The policy's execution `storeId` remains the actual selected runtime store; it is
not replaced by the policy's canonical store ID. New stores therefore need no
hardcoded ID/domain alias in source code. Older recognized store/domain policies
remain compatible when there is no explicit mapping. An invalid explicit mapping
never falls back silently to another policy.

## Handoff and recovery

- Auto SEO resolves the runtime profile before creating backup/outbox records.
  Missing profiles return HTTP 409 `STORE_PROFILE_REQUIRED` with configuration
  instructions. A stale store/domain pairing returns `STORE_DOMAIN_MISMATCH`.
- A server-owned resolved profile is passed to generation/queue handoff. Browser
  request bodies cannot select or override the policy.
- Pending backup recovery uses the same runtime resolver and acknowledges only
  after queue acceptance. Saving a profile is visible on the next request/tick;
  no Gateway restart is necessary for a mapping change alone.
- Existing failed backups are preserved. After correcting configuration, reload
  products and rerun eligible failed products through Auto SEO. This uses existing
  eligibility/idempotency checks; it does not mass-reset historical backups or
  automatically enqueue failed records.

No environment variables, credentials, database migration or Windows Agent
update is required. Deploy the code change separately from selecting a profile.
