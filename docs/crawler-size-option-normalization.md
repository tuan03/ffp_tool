# Crawler size labels at Codex SEO

Default-profile crawler jobs can normalize size labels in the existing Codex SEO pass. No separate model request is made. The pipeline enables this for new enqueues with `crawlerProfileSlug: default` and `crawlerSizeOptionsVersion: 1` in the execution snapshot. Dedicated profiles, Auto SEO and older jobs without the marker retain their current behavior. Store IDs are not involved.

The MCP context supplies a separate `sizeOptions` catalog containing only size group names, choice labels and stable server-generated IDs. It does not expose product titles, prices, ASINs, source URLs, non-size choices or the complete execution snapshot. These untrusted display strings must never become instructions or evidence for SEO copy, keywords, identity or collection selection. The semantic SEO input remains exactly images, niche and store profile.

Codex submits `sizeOptions` together with draft, alts and classification. Every supplied group/choice must be returned, even when unchanged. An omitted proposal returns `SIZE_OPTIONS_REQUIRED` with a repair hint; the draft and other checkpoints are preserved. Malformed mappings, unknown/missing choices, unsafe edits and collisions fall back to original labels with stable warning codes rather than dropping variants or restarting SEO.

The server accepts deletion-only changes, protects actual numeric values, units, dimension/range separators, fractions and recognized size names/codes, and rejects conversions or invented text. Only explicitly recognizable room-fit and child-count notes are exempt from numeric protection. Unknown numeric annotations remain conservative and may be retained. This validator cannot independently establish all semantic distinctions; Codex must keep the original when uncertain. Equal resulting choice labels or conflicting option names retain originals.

The validated checkpoint includes a catalog/identity hash, original and accepted labels, reasons and warnings. The pipeline revalidates it against the current product before applying it. Edits reach final variant options, source option displays, variant matrix dimensions, free/paid Customize labels and paid-option display metadata. Variant/option IDs, defaults, prices, assets, SKUs, source keys, split identity, other choices and raw crawl caches are preserved. The incoming labels are the baseline: older Agents may already have performed conservative cleanup before sending them.

The resulting product, audit mapping and warnings are stored in Review and reused by automatic/manual sync. Sync retries do not ask Codex to choose labels again. A mismatched product snapshot retains its current labels and records a warning.

The Shopify adapter hashes original option names/values from the injective audit mapping for Amazon SKU identity while sending cleaned labels as display options. This preserves the existing short `AMZ-{asin}-{code}` SKU even when a size group name changes. Products without a valid audit retain the existing SKU assignment behavior.

## Deployment and verification

Deploy the Gateway and pipeline worker together, then reconnect MCP sessions to refresh context and submission schemas. No Windows Agent rebuild, worker ZIP reinstall, new environment variable, route or database migration is required. This change does not rewrite historical jobs, Review products or Shopify products.

Focused tests cover the decimal `1.5x1.5 ft (!!!)` example, unfamiliar marketing text, real vs room dimensions, child notes, unit/fraction/code preservation, collisions, free/paid choices, identity/price preservation, snapshot mismatch, checkpoint replay and profile/Auto SEO isolation.

Work is on `cua_pro` at the user's explicit request, an exception to the handbook's normal feature-branch workflow. No push or production deployment is part of this task.

Verification: 43 focused MCP/size/SKU tests passed; the additional classification/source-guard suite passed during implementation. Web tests passed (1,113 passed, 14 skipped), existing Agent size tests passed (9), typecheck and production build passed. Full `npm test` passed tooling (80 passed, 1 skipped) and web, then hit the previously documented Ads MCP user/audit failure and a non-terminating Gateway suite; it was stopped and is not reported as passing. No live model run, Shopify write, service restart or production deployment was performed.
