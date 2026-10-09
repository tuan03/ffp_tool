# Blocked SEO content: validation and recovery

## Validation

- Final `productDescription` is checked as parsed HTML text. Element names such as
  `<strong>` are not artwork text. Entities are decoded and adjacent inline text
  remains contiguous. Draft text, titles, SEO/AEO, alts and selected keywords retain
  strict literal checks; this is not an HTML or claim-validation bypass.
- B5 drops whole derived audience/occasion/use-case phrases containing excluded
  artwork text before keyword framing and content generation. It does not silently
  rewrite an externally submitted draft or selected keywords.
- Personalization defaults to unsupported. A name in a mockup or "Personalized"
  in the niche/identity does not prove configurable options. Only an applicable
  catalog policy with the exact `allowedClaims` entry `personalization:customizable`
  enables a generic claim. Policy niche, identity and minimum-confidence checks
  still apply; `reviewRequired=true` prevents enabling it. No existing store policy
  is automatically changed by this fix. Add this entry only after the operator has
  confirmed that the scoped catalog actually supports customization. This legacy
  boolean does not describe which options exist: the policy author and generated
  content must not infer upload or engraving options from it. Existing shipping,
  warranty and other high-risk claim guards remain unchanged.
- MCP keeps `PRODUCT_IDENTITY_AMBIGUOUS` and adds allowlisted `error.reasons`
  (`LOW_IDENTITY_CONFIDENCE`, `IDENTITY_REVIEW_REQUIRED`, missing analysis fields,
  invalid confidence or unknown identity). Thresholds are unchanged. Rejected raw
  analysis is not returned or persisted. Reasons diagnose a new rejected call;
  they cannot reconstruct historical analysis that was never saved.

## Existing blocked jobs

Deploying the code does not reset blocked jobs or publish products. Pause the
relevant worker and inspect one representative before an operator-authorized retry.
The existing retry action preserves analysis/research checkpoints, resets the
bounded attempt/repair counters, and removes stale keyword/submission checkpoints.
Review a corrected draft before sync. Do not change confidence or `reviewRequired`
merely to pass validation, bulk-unblock ambiguous identities, or rerun crawl just
because a generated draft failed. If an existing analysis requires a policy not
present in its input snapshot, resolve the policy and checkpoint/input version
explicitly rather than modifying a global store default to fit one product.

This task changes code only. No production jobs, store policies, approvals,
Shopify products or worker tokens are changed.
