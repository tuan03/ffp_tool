# UI refinement — crawler-first workflow

## Summary

- Applied the Taste redesign audit to the existing React/Tailwind UI, retaining the white background and blue action accent.
- Collection, product type and pricing are **always expanded**, per the operator's explicit correction. Only technical crawler settings remain collapsible.
- Crawler input and everyday store/vendor/profile controls remain in the main form. Following operator feedback, the Shopify ASIN checker is always visible beside the form on desktop, with its own scrollable results, rather than inside a dialog. Collection, product type and pricing remain expanded.
- Local input analysis counts unique valid ASINs, duplicate entries and invalid lines. Explicit deduplication preserves original URLs and invalid lines. Invalid input blocks Start; authoritative server preflight is unchanged.
- One sticky Start bar identifies the target store, input/collection counts and all unmet prerequisites. Replacing a multi-line input batch with one filter result requires confirmation; switching from one ASIN to the next takes one click. Choosing an ASIN does not start a crawl or dismiss the checker.
- A separate, mounted “Phiên & kết quả” panel separates session history/progress from configuration. Crawl completion, SEO handoff and Shopify synchronization remain distinct states.
- Auto SEO adds an actionable empty state, keyboard-operable product titles and a selection-only action bar. SEO Review removes redundant status badges without changing immutable publish destinations. Queue shows refresh time; Ads groups source failures into expandable details. Review Studio tabs preserve both mounted workflows and their independent stores. Customizer gives more space to preview and keeps save/navigation actions accessible while scrolling.
- Typography below 12px was raised to 12px across existing UI components. Desktop sidebar preference remains unchanged; small screens use a dismissible navigation drawer.
- Shared dialog focus management supports Escape, focus containment, focus return and nested overlays. Busy-operation dismissal guards are retained. Native crawler dialogs retain browser-managed focus; their white-on-white text defect is corrected.

## Changed files / ownership

- `src/modules/amazon-crawler/ui/` and focused tests: crawler layout, input analysis, optional checker and results navigation.
- `src/layouts/`: responsive navigation without changing destination routes.
- `src/modules/*/ui/`, `src/pages/`: coordinated presentation-only changes; other feature-area changes are typography normalization unless listed above.
- `src/shared/hooks/useDialogFocus.ts`: shared accessibility behavior needed independently by store dialogs, SEO overlays, Ads overlays and mobile navigation.
- `src/shared/components/`: store dialog focus, names and translucent backdrops.
- `scripts/ui-redesign-smoke.mjs`: point-of-need load action selector updated.
- No service, gateway, engine, public business contract, dependency, environment file or root configuration changes.

## Verification

- Logs: `.cache/ui-round-two-*.log`; screenshots/report: `.cache/ui-redesign/` (ignored, mock data only).
- Focused input, crawler, navigation, Auto SEO and Review Studio tests cover the always-open controls, single start action, draft preservation and destination invariants.
- Browser checks exercise collection selection, per-store ASIN drafts, cancel/confirm replacement, native dialogs, custom focus containment/return, store-aware navigation, selection actions and responsive navigation.
- `npm run test:web`: 1,081 passed, 13 skipped, zero failures (1,094 total).
- Focused UI suite, including all `.test.tsx` files: 67 passed.
- `npm run typecheck`: passed for root, gateway and pipeline.
- `npm run build:mock`: passed.
- `VITE_APP_ENV=production VITE_AGENT_INSTALL_URL=http://localhost:3011 npm run build`: passed, including worker-pack and crawler-agent packaging hooks.
- `npm run test:tooling`: 76 passed, one skipped.
- `npm run test:review-image`: 34 Python tests plus both extension checks passed.
- `npm run test:pinterest`: 24 passed.
- Browser interaction tests: three passed; real-service fixture test skipped because no real-mode fixture URL was supplied. Covered 1440px and 390px layouts without business writes.
- Browser route smoke: 12 routes at 1280, 1440 and 1920px (36 combinations), no page runtime errors, white canvas and no document overflow. Crawler results also checked at 390px without overflow.
- `npm test` was attempted; the Gateway phase retained worker resources and was stopped. Separate `--test-force-exit` Gateway run: 792 passed, 67 skipped, one failed (`McpUserManager`, expected `Test Media Buyer`, got `Super Admin`). Engine: 683 total, 22 skipped, one failed (`PackagedClientTests.test_double_clicked_packaged_agent_uses_config_beside_executable`, machine connection config overrides portable fixture). These reproduce the previous handoff; backend sources are untouched.
- `git diff --check`: passed. Self-review confirmed 59 files contain only the mechanical sub-12px typography normalization; non-typography changes are confined to the UI/tests listed above.

## Local Docker delivery

- Rebuilt and recreated **only** the `client` service in the existing `ffp-crawler-staging` compose project using its current local override. Frontend is healthy at `http://localhost:3011/amazon-crawler`.
- Authenticated, read-only browser verification returned HTTP 200, white canvas, always-expanded collection/pricing, one Start action, visible inline checker and mobile navigation, zero runtime errors and zero business writes.
- Server/database container IDs and start times were checked before and after deployment and are unchanged. No jobs were submitted, stopped or modified during verification.
- Previous frontend image is retained locally as `ffp-tool-client:before-refinement-d0491e5`. No Docker volume was removed.
- Production verification log: `.cache/ui-round-two-deployment.log`. Credentials are read in memory from the existing client container, not printed or committed.

## Contract / environment / route changes

- None. UI-only component props and a local `results` panel were added; no route path changed.
- Crawler selection publishes the existing browser active-store event for navigation context only. Existing jobs and product publish destinations are not rewritten.
- The existing branch `feature/main-redesign-tool-interface` is retained by explicit user instruction, overriding the handbook's new-branch-per-task default.

## Remaining risks

- Repository-wide tests are not green: Gateway MCP user identity and packaged-agent configuration failures reproduced from the prior round. Gateway test workers also retain resources without `--test-force-exit`; no backend test policy was changed to hide this.
- Ads/SEO performance integration configuration errors remain real errors. The UI does not substitute mock data or change credentials.
- Native confirmations for existing destructive business actions remain intact. This pass does not replace all legacy overlays or change their execution policies.
- No push or merge into `main` is authorized or performed.

## Follow-up — persistent ASIN checker

### Summary

- Restored the checker as an always-visible desktop side column for checking 50–100 ASINs once and selecting successive individual crawls. The result list remains scrollable and mounted; selecting an ASIN does not dismiss it or discard per-store drafts, results and action history.
- Switching between individual ASINs is one click. Confirmation remains only when replacing a multi-line crawl input. Collection/type/pricing stay expanded, and the sticky Start bar stays within the form column rather than covering the checker.

### Changed files

- `src/modules/amazon-crawler/ui/AmazonCrawlerPage.tsx`: inline checker, responsive column sizing and single-ASIN selection flow.
- Crawler page/browser tests: assert inline rendering, multi-line replacement safety, store persistence and repeated selection from both 50- and 100-ASIN results.
- `src/shared/__tests__/dialog-focus-browser.test.ts`, `scripts/ui-redesign-smoke.mjs`: target the named navigation aside because the page now has a second aside.

### Verification

- Focused crawler input/page tests: nine passed.
- `npm test`: tooling phase passed (76 passed, one skipped); web phase passed (1,081 passed, 14 skipped). The same MCP user identity failure appeared in Gateway; its workers remained open, so only this test process tree was stopped at 120 seconds. Full-suite status is not passing; engine tests were not rerun for this UI-only follow-up.
- `npm run typecheck` and `npm run build:mock`: passed.
- Browser suite with `--test-concurrency=1`: four passed, one real-service fixture skipped. An earlier concurrent run timed out the focus test under test-suite load; its isolated and sequential reruns passed without changing behavior or timeout thresholds.
- Route smoke: 36 desktop route/viewport combinations passed; 390px crawler workflow checks also passed.
- Production `npm run build` passed with the existing `VITE_APP_ENV=production` and local installer URL. Only Docker `client` was rebuilt/recreated; authenticated verification on port 3011 returned HTTP 200 and confirmed the checker beside the form, white background, expanded pricing, zero runtime errors and no business writes. Backend/database IDs and start times are unchanged; frontend is healthy.
- Previous frontend image retained as `ffp-tool-client:before-inline-checker-02dc995`. Follow-up logs use `.cache/asin-inline-*.log`; no cache artifacts or credentials are committed.

### Contract / environment / route changes

- None. Existing UI branch retained by user instruction; no backend/service/configuration/dependency changes.

### Remaining TODOs or risks

- Existing repository-wide Gateway/engine test limitations above remain outside this UI follow-up. No real crawl or Shopify write is performed during browser verification.
