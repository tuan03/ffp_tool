# FFP Tool UI redesign handoff

## Summary

- Applied the existing-project audit and redesign workflow from [Taste Skill](https://github.com/Leonxlnx/taste-skill/blob/main/skills/redesign-skill/SKILL.md).
- Replaced the dark application palette with white surfaces, slate text, blue actions, restrained borders and consistent typography.
- Added a grouped desktop sidebar with a persistent 232px/64px toggle, keyboard focus, rail tooltips, active destinations and a skip link.
- Standardized page headers, shared icons and buttons; migrated module pages, embedded views, dialogs, notifications, table styling and chart colors.
- SEO Review defaults to the existing split view while honoring saved view preferences. Crawler pricing starts collapsed with its summary and controls retained.
- Preserved store-aware navigation, independent image/review destinations in Review Studio, mounted crawler panels, and existing job controls.
- SEO-profile loading failures in the store dialog now display a safe Vietnamese connection message instead of a raw response parsing error.

## Changed files

- `src/layouts/`: application shell, grouped navigation, sidebar preferences and notification presentation.
- `src/styles/global.css`: Tailwind v4 theme tokens, base typography, visible keyboard focus and reduced-motion support.
- `src/shared/components/`: shared `AppIcon`, `Button` and `PageHeader`; white store dialogs. Shared placement is necessary because multiple independent modules consume the same presentation primitives.
- `src/modules/*/ui/` and `src/pages/`: coordinated presentation updates across all existing feature areas, including legacy and embedded views. Domain services and module contracts are untouched.
- Focused UI tests: navigation/storage behavior, crawler disclosure behavior and assertions updated for the new headers/icons.
- `index.html`, `public/favicon.svg`: Vietnamese document language, description and branded favicon. Root metadata changes are limited to presentation; package/configuration files are unchanged.
- `scripts/ui-redesign-smoke.mjs`: repeatable browser verification using existing Playwright. Run against mock mode only; the script blocks API writes.

## Verification

- `npm run typecheck`: passed for root, gateway and pipeline configurations.
- `npm run build`: passed, including the existing packaging hooks.
- `npm run build:mock`: passed.
- `npm run test:web`: 1,076 passed, 12 skipped, no failures.
- Focused UI command covering all `.test.tsx` files, navigation, Auto SEO table and crawler page: 59 passed.
- Tooling tests, reached through `npm test`: 76 passed, 1 skipped.
- `npm run test:review-image`: 34 Python tests passed; both browser-extension checks passed.
- `npm run test:pinterest`: 24 passed.
- Browser smoke: 12 routes at 1280, 1440 and 1920px; white background, no document-level horizontal overflow and no page runtime errors. Also verifies sidebar persistence, keyboard tooltip, draft preservation, store-aware navigation, safe error copy for an invalid SEO-profile response, dialog dismissal and product selection after loading the Auto SEO table.
- Browser screenshots and machine-readable report are local artifacts in `.cache/ui-redesign/`; command logs are in `.cache/ui-*.log`.
- `git diff --check`: passed.

### Full-suite limitations

`npm test` was attempted but did not complete: gateway test workers retained open resources after printing their results. The remaining suites were run separately. The complete test suite must not be reported as passing.

- `node --import tsx --test --test-force-exit gateway/__tests__/*.test.ts`: 792 passed, 67 skipped, 1 failed. `McpUserManager manages users, verifies tokens, and records audit logs` expects `Test Media Buyer` but receives `Super Admin`. The failure also reproduces when that test runs alone.
- `npm run test:engine`: 683 tests ran; 22 skipped and 1 failed. `PackagedClientTests.test_double_clicked_packaged_agent_uses_config_beside_executable` resolves the machine's saved connection configuration instead of the test's temporary portable configuration.
- No gateway or Python engine source was changed. These failures need separate investigation in their owning subsystems.
- A concurrent web run also hit the existing B5 stage-timeout assertion; its isolated rerun passed. This is a wall-clock timing test outside the UI implementation.

## Contract / environment / route changes

- No changes to business APIs, public data contracts, environment variables, route paths, redirects or dependencies.
- New shared component props are presentation-only. Sidebar preference uses the local key `ffp_sidebar_collapsed`; unavailable storage falls back to the expanded menu.
- Desktop-first acceptance starts at 1280px. This task does not introduce a mobile workflow or dark-mode setting.

## Remaining TODOs or risks

- Resolve the two full-suite failures and gateway worker shutdown before treating the repository-wide test gate as green.
- Remote sample images may be unavailable in mock screenshots; production media URLs and product preview colors are preserved.
- Existing build warnings about browser-externalized Node modules, chunk sizes and local `NODE_ENV` configuration remain outside this UI change.
- Work is on `feature/main-redesign-tool-interface`; merge and deployment remain separate actions.
