# Light and dark appearance

## Summary

- Added an accessible Sáng/Tối button at the far right of the application header, with a 44px keyboard/pointer target and Vietnamese action labels. The icon-only mobile presentation keeps the header within the viewport.
- Exactly two explicit modes: the existing white/light interface is the default, independently of OS settings. The chosen mode is saved under the local browser key `ffp_theme`, restored before React renders, and synchronized across tabs. Storage failures do not prevent switching for the current tab.
- One app-level provider changes appearance without remounting pages, routing, or crawler workspaces. ASIN input, checked batches, collections, pricing and ongoing work remain intact.
- Applied standard Tailwind `dark:` variants to existing UI surfaces, text, borders, hover/focus states, badges, tables, notifications, drawers and dialogs. Image pixels and white artwork/contain-preview canvases are intentionally preserved; no image inversion or product configuration changes.

## Changed files

- `src/app/theme/theme-preference.ts`, `src/app/providers/ThemeProvider.tsx`, `AppProviders.tsx`: preference validation, storage fallback and one shared provider.
- `src/layouts/components/ThemeToggle.tsx`, `src/layouts/AppLayout.tsx`: upper-right switch and responsive header spacing.
- `src/shared/components/AppIcon.tsx`: sun/moon paths in the existing icon set, with no dependency added.
- `src/styles/global.css`: theme tokens, explicit dark selector and native form color scheme.
- `index.html`, `public/theme-init.js`: restore the preference before the main application to avoid a white flash. Root metadata change is necessary for initial rendering; no build/configuration setting changed.
- Existing feature UI and two UI presentation helpers: palette-only changes. Self-review strips the added dark utilities and reproduces the original content exactly for 118 tracked files; other tracked changes are the theme foundation above.
- `src/pages/home/__tests__/theme-preference.test.ts`, `theme-toggle.test.tsx`, `scripts/theme-smoke.mjs`: preferences, bootstrap, accessible control and browser acceptance checks.

## Verification

- Preference, SSR control, existing `.test.tsx` and focused crawler/Auto SEO checks: 63 passed.
- `npm run typecheck`: passed for root, gateway and pipeline.
- `npm run build:mock`: passed, including existing packaging hooks.
- `npm run build`: passed in production mode, including worker and crawler-agent packaging.
- Browser: 72 route/theme/desktop-viewport combinations across 12 routes at 1280/1440/1920px. Checks include heading/input/dialog/table contrast, loaded Auto SEO table/drawer, white default despite OS dark mode, reload persistence, cross-tab changes, blocked storage, mobile placement and keyboard switching. No document overflow or page runtime errors.
- Crawler/overlay browser regression: four passed; one real-service fixture skipped. Includes 50/100-ASIN repeated selections, collection/pricing preservation and dialog focus.
- `npm test` was attempted with a 120-second bound. Tooling passed (76, one skip), web passed (1,084, 14 skips). Gateway reproduced the existing MCP identity failure and retained workers; only that test process tree was stopped. Full suite is not green. Gateway/engine sources and test policy are unchanged.
- Frontend Docker image built and only `ffp-client` recreated in the existing `ffp-crawler-staging` project. Authenticated browser verification at `http://localhost:3011/amazon-crawler` passed: both themes, white default, pre-render bootstrap, reload persistence, unchanged drafts, expanded collection/pricing, inline ASIN checker, mobile navigation, zero runtime errors and zero business writes. Backend/database container IDs and start times remained unchanged.
- Previous frontend image retained locally as `ffp-tool-client:before-theme-80bae86` for recovery; no image was pushed.
- Logs: `.cache/theme-*.log`; mock screenshots/report: `.cache/theme-smoke/`. These artifacts and local credentials are not committed.

## Contract / environment / route changes

- No business API, route, environment variable, dependency, gateway, engine, or Shopify write changes.
- Browser appearance preference only: `ffp_theme` = `light` or `dark`; unknown/missing values fall back to `light`.
- Existing `feature/main-redesign-tool-interface` branch retained by explicit user instruction, overriding the default new-branch workflow. No push or merge into `main`.

## Remaining TODOs or risks

- The existing Gateway MCP identity/worker shutdown and packaged-agent test limitations remain separate backend work.
- Authored product content/media retains its original visual colors; appearance changes do not alter exported assets or stored product data.
