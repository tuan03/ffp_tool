# Development guide

## 1. Start here

This repository is one React application, not a collection of npm packages. The folders under `src/modules` are isolated code ownership areas inside the same build.

Read [AGENTS.md](../AGENTS.md) before starting a task. It is the source of truth for architecture, imports, environment behavior, ownership, and verification commands.

Run once after cloning:

```bash
npm install
cp .env.example .env.local
```

PowerShell alternative:

```powershell
Copy-Item .env.example .env.local
```

Run the UI in normal development mode. Hello World is available at `/`:

```bash
npm run dev
```

Run the UI against mock data:

```bash
npm run dev:mock
```

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

## 9. Required verification before handoff

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
