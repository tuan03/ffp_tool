# Development guide

## 1. Start here

This repository is one React application, not a collection of npm packages. The folders under `src/modules` are isolated code ownership areas inside the same build.

Read [AGENTS.md](../AGENTS.md) before starting a task. It is the source of truth for architecture, imports, environment behavior, ownership, and verification commands.

Run once after cloning:

```bash
npm install
python -m pip install -r src/modules/amazon-crawler/engine/requirements.txt
python -m playwright install chromium
cp .env.example .env.local
```

PowerShell alternative:

```powershell
Copy-Item .env.example .env.local
```

Run the UI and local Amazon crawler engine together. The crawler is available at `/amazon-crawler`:

```bash
npm run dev
```

Run either process independently while debugging:

```bash
npm run dev:web
npm run dev:engine
```

The engine listens on `http://127.0.0.1:8765` by default. Set
`VITE_AMAZON_CRAWLER_ENGINE_URL` for the browser client and
`AMAZON_CRAWLER_CORS_ORIGINS` for the explicit localhost allowlist. Proxy
credentials belong only in `.env.local` through `AMAZON_CRAWLER_PROXIES` and
must never be committed.

The crawler always canonicalizes Amazon requests to `amazon.com`, adds
`language=en_US` and `currency=USD`, and establishes delivery ZIP `10001` (or
the ZIP selected in Advanced Settings) before accepting product data. For
multiple persistent browser/proxy profiles, copy
`config/amazon-crawler-profiles.example.json` to the ignored local file
`config/amazon-crawler-profiles.json`, enable the required profiles, and keep
all proxy credentials only in that local file. `rotateProfiles` controls
whether configured profiles repeat when the requested browser profile count is
larger than the config list.

Run the UI against mock data:

```bash
npm run dev:mock
```

### Shared crawler profiles

Versioned image presets and their PNG logos live in `config/image-processing-profiles/`.
Coordinator startup installs missing presets into its runtime store (PostgreSQL in Docker)
and copies logo bytes into the durable runtime volume. Existing operator profiles are
not overwritten. The former local `default` preset is named `jeminise-logo` in the shared
catalog so it does not replace an existing default. Select it explicitly when appropriate.
Missing presets are restored on startup; edit the versioned catalog to retire a shared preset.
Changes made through the UI remain runtime data, not automatic Git edits.

`config/amazon-crawler-profiles.shared.json` contains four shared proxy definitions.
Both the Python crawler and Shopify Gateway resolve `serverEnv`, `usernameEnv`, and
`passwordEnv` using server/agent environment variables. Supply `FFP_PROXY_1_SERVER`,
`FFP_PROXY_1_USERNAME`, `FFP_PROXY_1_PASSWORD` (and indices 2–4) privately on each machine
that actually uses those proxies. Incomplete profiles are skipped; direct-first crawler
behavior remains unchanged. The ignored `config/amazon-crawler-profiles.json` takes
priority when present; explicit config paths still take priority and are not silently replaced.
Proxy credentials are never bundled into Git, Docker images or browser JavaScript.
Packaged agents need these environment variables or their own private proxy config;
this change does not rebuild or redistribute the Windows installer.

## 2. Folder ownership

```text
src/
├── app/                 # Main owner: app composition, providers, routes, runtime wiring
├── config/              # Main owner: typed environment configuration
├── layouts/             # Main owner: application-wide layout
├── pages/               # Main owner: page-level UI
├── styles/              # Main owner: global Tailwind stylesheet
├── modules/
│   ├── orchestrator/    # Workflow owner
│   ├── module-a/        # Module A owner
│   ├── module-b/        # Module B owner
│   └── module-c/        # Module C owner
└── shared/              # Shared contracts/errors only when genuinely cross-cutting
```

Avoid editing another owner's directory unless the task explicitly requires coordinated work. This is the primary way the team avoids Git conflicts.

## 3. How a module owner implements a feature

Use this sequence for Module A, B, or C.

1. Read `index.ts` and `types.ts` to understand the public contract.
2. Add a failing unit test in the module's `__tests__/` folder.
3. Implement real behavior in `service.ts`.
4. Update representative fixture data in `mocks/data.ts` if the contract changed.
5. Update `mocks/runner.ts` so mock behavior still conforms to the public contract.
6. Keep `runtime.ts` as the mode selector. Do not duplicate environment checks through business logic.
7. Export only intentionally supported APIs from `index.ts`.
8. Run the module tests, typecheck, and build.

Example public import from orchestrator or the main application:

```ts
import { getModuleARunner } from "../../modules/module-a";
```

Do not use:

```ts
import { runModuleA } from "../../modules/module-a/service";
```

## 4. Mock and real data behavior

The app selects its environment once in `src/config/environment.ts`. The main runtime then asks each module for the appropriate public runner:

```text
VITE_APP_ENV=mock
  app runtime -> module runtime -> mocks/runner.ts -> mocks/data.ts

VITE_APP_ENV=development or production
  app runtime -> module runtime -> service.ts -> real integration/business logic
```

The module owner owns both branches. Main only calls `getModuleXRunner(environment)` and never imports `mocks/data.ts` directly.

When real integrations are ready, replace the temporary implementation in `service.ts`. Do not remove the mock runner: it keeps local UI development and deterministic tests fast.

## 5. How the main owner adds application work

- Put application initialization and dependency composition in `src/app`.
- Put routes in `src/app/routes` and providers in `src/app/providers`. Use React Router route objects; application layout routes render nested pages through `Outlet`.
- Put page UI in `src/pages`; global shell UI belongs in `src/layouts`.
- Keep `src/app/runtime/workflow.ts` small: it composes public module runner factories and creates the orchestrator runner.
- Do not place module-specific logic or fixtures in the app layer.

When adding a UI for a module, the module owner should add `src/modules/module-x/ui/`. The main owner can render its public component from the module's `index.ts`.

## 6. How the orchestrator owner adds workflow work

The orchestrator converts `WorkflowInput` into public input contracts for A/B/C and aggregates their outputs. It may coordinate dependencies and errors, but it must not reproduce business rules from individual modules.

Use `Promise.all` for independent work. Preserve specific error codes so the UI and logs identify the failing module.

For tests, use dependency injection:

```ts
const runWorkflow = createWorkflowRunner({
  runModuleA: fakeModuleA,
  runModuleB: fakeModuleB,
  runModuleC: fakeModuleC,
});
```

## 7. Contract-change checklist

Public contract edits are the main source of coordination. Before merging one:

- Update `types.ts`, real service, mock runner, and module tests.
- Inform the orchestrator owner of changed fields or semantics.
- Update orchestrator mapping/tests in a coordinated change.
- Update pages only if their visible output changes.
- Keep the diff focused; do not mix formatting sweeps with contract work.

## 8. Antigravity task template

Use one focused task per owner. Paste and adapt this template:

```text
Repository: FFP Tool

Read AGENTS.md first. You own only: src/modules/module-a
Task: <describe the requested Module A behavior>

Constraints:
- Preserve the public API boundary: other folders may import only from module-a/index.ts.
- Keep Module A independent from module-b, module-c, and orchestrator.
- Update service.ts for real behavior; update mocks/data.ts and mocks/runner.ts if the contract changes.
- Add or update focused tests in module-a/__tests__.
- Do not edit app runtime, other modules, package.json, or shared files unless the task explicitly says to.

Before reporting: run npm test, npm run typecheck, and npm run build.
Report: changed files, behavior, test/build output, and remaining TODOs.
```

For main-owner work, replace the ownership line with `src/app`, `src/config`, `src/layouts`, `src/pages`, and `src/styles`; require use of public module exports only.

For orchestrator work, replace ownership with `src/modules/orchestrator`; require public module imports and module-specific `AppError` codes.

## 9. Git branch workflow

Every task gets its own branch. Do not code directly on `main`.

```bash
git switch main
git pull --ff-only
git switch -c feature/module-a-add-normalizer
```

If the repository has no remote yet, skip `git pull --ff-only`.

Use this branch format:

```text
<type>/<scope>-<short-description>
```

| Part | Allowed values / rule |
| --- | --- |
| `type` | `feature`, `fix`, `refactor`, `test`, `docs`, `chore` |
| `scope` | `main`, `orchestrator`, `module-a`, `module-b`, `module-c`, `shared`, `tooling` |
| `short-description` | Lowercase kebab-case, one outcome, starts with a verb |

Examples:

```text
feature/main-add-workflow-page
feature/module-c-add-report-mock
fix/module-b-handle-empty-result
test/orchestrator-cover-module-a-error
```

Before handoff, commit only the focused task files:

```bash
git status
git add src/modules/module-a
git commit -m "feature(module-a): add item normalizer"
```

The leader reviews and decides when a branch merges into `main`.

## 10. Required verification before handoff

```bash
npm test
npm run typecheck
npm run build
```

For a mock-only change, also run:

```bash
npm run build:mock
```

A handoff should include the exact commands run and whether they passed, plus any unfinished real integration TODOs.

## Competitor research dashboard

The Spy Competitors tab reads product-qualified research separately from the ad-provider report. A failed or empty ad source does not hide the researched brands. The panel polls every 15 seconds while mounted and supports manual refresh.

Publish a completed run through `ads_publish_competitor_research({ research })`; verify persistence with `ads_get_competitor_research({ storeId })`. The equivalent HTTP routes are `POST` and `GET /api/ads-intelligence/competitor-research?storeId=<id>` under the existing Gateway authentication. Both require an explicit store ID. Publish requires the exact registered `shopDomain`, the public `storeDomain`, observation timestamp, scope, qualified candidates, limitations and website-derived hypotheses. See `gateway/ads-intelligence/competitor-research.ts` for the validated schema.

Research is atomically persisted per connection in `.runtime/ads-intelligence/competitor-research/` (ignored by Git). Preserve/mount this directory across deployment replacements. Empty results return `research: null`; invalid saved data returns an error rather than sample data. Older observation timestamps cannot replace a newer report. The local repository serializes writes within one Gateway process; shared multi-process deployment requires a database-backed repository before concurrent publishing.

Research publishing does not change the advertising watchlist, run campaigns, or invent ad evidence. A brand's website qualification and advertisement availability are distinct states. The personal `spy-competitors` skill publishes after analysis; unregistered stores and failed publications remain local reports and must be reported as such.


Research ad collection uses three additional MCP tools: `ads_discover_advertisers` (provider Page lookup), `ads_fetch_competitor_page` (explicit Page/country with cursor), and `ads_search_live_library` (live keyword search outside the static watchlist). Provider responses are leads; the skill verifies destination products and media before publishing `verifiedAds`, `adCollection`, and `adInsights`. The publisher validates selected-brand membership, source URLs, numeric ad/Page IDs, coverage counts and insight references. When collection coverage exists, `/competitors` serves the persisted qualified snapshot instead of fetching unrelated legacy watchlists. Re-reading this snapshot is free of provider requests; fresh collection is explicit. Empty or unresolved coverage is retained per brand. Receiving media URLs never implies video/audio review.

Competitor collection tools also accept `activeStatus` (`ACTIVE`, `ALL`, `INACTIVE`; default `ACTIVE`) and `country=ALL` for explicit expanded coverage. Research entries can specify `selectedCardIndices` for verified product cards inside a mixed carousel; the saved original remains intact while the library displays only those cards with their original positions. An ALL-country result must not be reported as verified US delivery.

### Run competitor research from the dashboard

The **Spy Đối thủ** tab provides a store-scoped **Spy đối thủ** action with a CLI/model selector, progress and cancellation. It uses the CLI installed on the **gateway machine** (macOS/Linux PATH or Windows executable locations), not the user's browser computer. Codex models come from its local `models_cache.json`; AGY models come from `agy models`. Login remains managed by the CLI. `ADS_SPY_CODEX_MODELS` can supply a comma-separated operator-maintained catalog when the Codex cache is unavailable. `ADS_SPY_SKILL_DIR` can override the default `$CODEX_HOME/skills/spy-competitors` path. No API keys are sent to the browser.

Endpoints (under the existing gateway authentication boundary):

- `GET /api/ads-intelligence/spy/capabilities`
- `GET /api/ads-intelligence/spy/jobs?storeId=...`
- `POST /api/ads-intelligence/spy/jobs?storeId=...` with `{storeId, runner, model}`
- `POST /api/ads-intelligence/spy/jobs/:jobId/cancel?storeId=...`

The selected store and model are snapshotted when starting. The gateway permits one running job per store, runs the agent in a scratch workspace, loads the skill and its qualification/collection/publication references, and exposes a store-scoped MCP helper. That helper blocks campaign/experiment writes and stages research rather than publishing directly. After a successful agent exit, the gateway validates store identity, freshness and coverage for every selected competitor before publishing. A report with gaps is `partial`, never a false ten-brand completion; an empty refresh cannot replace an existing non-empty ad library. Browser refresh/navigation does not stop the job. Gateway restart marks unfinished work `interrupted`; a watchdog terminates orphan CLI processes. Jobs have a 90-minute upper limit and cancellation terminates the process tree. No automatic retries or paid research occur during frontend polling.

State is stored in ignored `.runtime/ads-intelligence/spy-jobs/`. Progress stages are agent-reported, not verified percentages; only validated published result counts are final. CLI/tool output is drained without saving raw secrets or content to browser logs. No automatic Git operations are performed.

AGY headless runs require command permission for the MCP helper. `--mode accept-edits` alone does not grant it. AGY can return exit code zero and `status: SUCCESS` alongside `denied_actions`; the runner maps this to `SPY_PERMISSION_REQUIRED`, preserving the existing library. Configure narrowly scoped permissions through AGY's supported settings before retrying; the application does not modify global permissions or disable CLI safeguards. A normal CLI exit without staged research is reported separately as `SPY_RESEARCH_MISSING`.

For the current helper invocation, the operator can authorize `command(node ffp-tools.mjs)` in `~/.gemini/antigravity-cli/settings.json` under `permissions.allow`. AGY uses its normal permission engine rather than the forced `--sandbox` flag: that flag prevents the helper from reading the host TypeScript loader and MCP configuration. Do not add `--dangerously-skip-permissions`. Other tool permissions remain subject to the operator's settings. Back up settings before changing them.

AGY runs directly inside the per-job directory with `ffp-tools.mjs` already present; do not give it a competing `--add-dir` workspace. The helper CLI automatically saves schemas to `mcp-tools.json` and call responses to `mcp-result.json`, returning a file pointer for the agent to read in sections. No shell redirection is needed. This avoids truncated terminal output, helper copying and repository inspection by the research agent.

Spy job snapshots now include optional `events` (latest 200 operational events). AGY uses `stream-json`; Codex uses its JSON event stream. The server records allowlisted tool labels, MCP completion/failure, phase changes and publication/cancellation outcomes in per-job `events.jsonl`. Raw commands, credentials, tool bodies and agent reasoning are not relayed to the UI. Logs survive reload; older `calls.jsonl` completion records are shown explicitly as legacy events. Missing `events` means the gateway still runs an older version; restart only after active jobs have finished. The UI polls every 2.5 seconds and provides elapsed time, last activity, timestamps and an error filter. No new route or environment variable is required.

Spy captures normalized ad records returned by MCP into per-job `source-ad-<archiveId>.json` files. During staging it restores provider fields (including signed media URLs, card order and source dates) from those records; agent annotations and inspection labels remain separate. This prevents URL corruption when a model retypes an existing ad. Publication still validates store identity, evidence, collection counts and media inspection. A successful CLI exit alone is not successful publication.
