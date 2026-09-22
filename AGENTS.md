# FFP Tool — Engineering Handbook for Humans and Coding Agents

> Read this file before inspecting, editing, testing, or reviewing code. This is the repository's operating contract. If a task conflicts with this file, follow the user's explicit instruction and record the exception in the handoff.

## 1. Product and technical baseline

FFP Tool is one React application built with TypeScript, Vite, Tailwind CSS, and React Router. It is **not** a monorepo:

- One root `package.json`, one `tsconfig.json`, and one build.
- Do not create module-level `package.json`, internal npm packages, workspaces, or private publishing flows.
- `src/modules` provides code boundaries and parallel ownership, not separately deployable packages.
- TypeScript strict mode is mandatory.

Read [docs/development-guide.md](docs/development-guide.md) for onboarding, commands, and task-prompt templates.

## 2. Architecture and ownership

```text
src/
├── app/                 # Application composition, providers, routing, runtime wiring
├── config/              # Environment parsing and application configuration
├── layouts/             # Application-wide route layouts
├── pages/               # Application-level pages
├── styles/              # Global styles only
├── modules/
│   ├── orchestrator/    # Workflow coordination and cross-module errors
│   ├── module-api/      # Module API contract, Shopify client service, mock runner, tests
│   ├── module-a/        # Module A contract, real logic, mock logic, tests
│   ├── module-b/        # Module B contract, real logic, mock logic, tests
│   └── module-c/        # Module C contract, real logic, mock logic, tests
└── shared/              # Small, genuinely cross-cutting types, errors, utilities, constants
gateway/                 # Standalone Shopify GraphQL proxy gateway (Node.js/Vite server)
```

| Owner | Primary folders | Owns |
| --- | --- | --- |
| Main owner | `src/app`, `src/config`, `src/layouts`, `src/pages`, `src/styles` | App composition, providers, routing, environment wiring, application UI |
| Orchestrator owner | `src/modules/orchestrator` | Workflow ordering, aggregation, dependency injection, cross-module errors |
| Module API owner | `src/modules/module-api` | Module API contract, Shopify client service, mock runner, tests |
| Gateway owner | `gateway/` | Standalone Shopify GraphQL proxy gateway, store registry, auth, throttling, idempotency |
| Module A owner | `src/modules/module-a` | Module A contract, real service, mocks, UI, tests |
| Module B owner | `src/modules/module-b` | Module B contract, real service, mocks, UI, tests |
| Module C owner | `src/modules/module-c` | Module C contract, real service, mocks, UI, tests |

### Ownership rules

- Modify only the folders in your assigned scope unless the task explicitly requires a coordinated change.
- Do not perform unrelated formatting, renaming, dependency upgrades, file moves, or cleanup in another owner's area.
- `src/shared` and root configuration are shared-conflict zones. Edit them only when necessary; explain why in the handoff.
- Do not modify `AGENTS.md` unless the task specifically asks to change team rules.
- Do not add `src/modules/index.ts`; it becomes a conflict hotspot.

## 3. Dependency direction and public APIs

```text
app / pages / layouts
        ↓
   orchestrator
   ↙    ↓    ↘
module-api module-a module-b module-c
        ↓
     gateway
        ↓
      shared
```

- A module exposes its supported API only through its own `index.ts`.
- Consumers import a module only through its folder entry point:

  ```ts
  import { getModuleARunner } from "../../modules/module-a";
  import type { ModuleAOutput } from "../../modules/module-a";
  ```

- Never import another module's `service.ts`, `runtime.ts`, `mocks/`, `ui/`, tests, or other internal files.
- Modules must never import `orchestrator`, `app`, `pages`, `layouts`, or another business module.
- `shared` must never import a module, app, page, or layout.
- Move code into `shared` only when at least two independent owners need the same stable abstraction. Module-specific business rules always stay inside the module.
- Circular dependencies are forbidden. If a new requirement appears to create one, introduce a small shared contract or have the orchestrator coordinate it.

## 4. Standard module layout

```text
module-x/
├── index.ts              # Public exports only; no business logic
├── types.ts              # Public input/output contracts
├── service.ts            # Real development/production implementation
├── runtime.ts            # Selects the module's real or mock runner
├── mocks/
│   ├── data.ts           # Representative mock fixtures
│   └── runner.ts         # Mock implementation matching types.ts
├── ui/                   # Optional: UI owned by this module
│   ├── ModuleXPage.tsx
│   └── components/
├── routes.tsx            # Optional: public route definitions owned by this module
└── __tests__/
    └── service.test.ts
```

- `index.ts` is an export list only. Never put workflow, state, API calls, or large logic there.
- `types.ts` contains public contracts. Keep transport/API-only private types beside the implementation that uses them.
- `service.ts` is the only integration point for a module's real API, SDK, database, or business logic.
- `mocks/data.ts` contains safe, realistic samples. Never use production records, secrets, tokens, or personal data.
- `mocks/runner.ts` satisfies the same public contract as the real service and returns fresh copies of mutable values.
- `runtime.ts` selects the mock runner only for `mock`; it selects `service.ts` for `development` and `production`.
- Optional module UI stays under `ui/`; it may use the module's own public service/contracts but cannot reach into another module's internals.

## 5. Naming and file conventions

Use English in source code, route paths, error codes, commit messages, and technical documentation. Write user-facing copy in the product's intended language.

| Item | Rule | Examples |
| --- | --- | --- |
| Folders | `kebab-case`; plural only for collections | `module-a`, `components`, `__tests__` |
| React component files | `PascalCase.tsx` | `HomePage.tsx`, `UserCard.tsx` |
| Hooks | `useX.ts` or `useX.tsx` | `useWorkflow.ts` |
| Non-component source files | descriptive `kebab-case.ts`, except standard names | `api-client.ts`, `format-date.ts`, `service.ts` |
| Test files | `<subject>.test.ts` / `<subject>.test.tsx` | `service.test.ts` |
| Variables/functions | `camelCase` | `workflowResult`, `loadInvoices` |
| React components/types/interfaces | `PascalCase` | `HomePage`, `WorkflowInput` |
| Boolean values | start with `is`, `has`, `can`, `should`, or `did` | `isLoading`, `hasError` |
| Event handlers | start with `handle` | `handleSubmit`, `handleRunWorkflow` |
| Async actions | start with a verb | `fetchOrders`, `saveProfile`, `runWorkflow` |
| Arrays/collections | plural noun | `items`, `moduleRoutes` |
| Identifiers | `<noun>Id`; preserve established acronym casing | `workflowId`, `apiUrl`, `userIds` |
| Constants | `UPPER_SNAKE_CASE` only for true module constants | `MAX_RETRY_COUNT` |
| Error codes | `UPPER_SNAKE_CASE`, specific and stable | `MODULE_A_FAILED` |

- Do not prefix interfaces with `I` (`WorkflowInput`, not `IWorkflowInput`).
- Do not use vague names such as `data`, `item`, `result`, `handler`, `utils`, or `common` when a domain name is available. Short-lived loop variables are the exception.
- Avoid unexplained abbreviations. Common technical terms such as `api`, `url`, `id`, and `ui` are allowed.
- One file has one primary responsibility. Split a file when distinct responsibilities make it difficult to name clearly.

## 6. TypeScript rules

- Keep `strict` TypeScript; do not weaken `tsconfig.json` to silence an error.
- Do not use `any`, `as any`, `@ts-ignore`, or `@ts-nocheck`.
- Use `unknown` for untrusted values and narrow it with type guards.
- Use `import type` for type-only imports.
- Prefer `interface` for object-shaped public contracts and `type` for unions, mapped types, and compositions.
- Prefer discriminated unions for state/error variants over optional fields with unclear combinations.
- Mark input arrays/objects `readonly` when the function does not mutate them.
- Return explicit public output types from exported functions.
- Avoid non-null assertion (`!`). Validate or branch instead.
- Prefer `const`; use `let` only where reassignment is required; never use `var`.
- Prefer named object inputs when a function would otherwise need more than two positional values.
- Do not introduce an enum unless interoperability requires it; prefer a `const` object plus a union type.

## 7. Imports, exports, and code structure

### Import order

Keep one blank line between groups, in this order:

1. React and third-party packages.
2. Internal runtime imports.
3. Internal type-only imports.
4. Relative imports inside the same ownership boundary.

```ts
import { useState } from "react";
import { Link } from "react-router-dom";

import { runWorkflow } from "../../app/runtime/workflow";
import type { WorkflowOutput } from "../../modules/orchestrator";

import { WorkflowSummary } from "./components/WorkflowSummary";
```

### Export and function rules

- Prefer named exports. A default export is reserved for the root `App` component unless an existing convention requires otherwise.
- Public module exports are intentionally listed in `index.ts`.
- Do not re-export internal helpers "for convenience".
- Avoid barrel files inside `components/` or `utils/` until there is a demonstrated import-maintenance problem.
- Keep pure helper functions private unless another ownership boundary needs them.
- Keep functions small and focused; prefer early returns to deep nesting.
- Use `async`/`await`; do not mix promise chains and `async`/`await` in the same flow.
- Comments explain **why**, constraints, or non-obvious tradeoffs; code explains **what**.
- Every TODO names the missing behavior or integration and, where known, the blocker. Never leave `// TODO: fix`.

## 8. React, Tailwind, and routing rules

### React

- Function components only.
- Put application-wide providers in `src/app/providers`; do not create duplicate providers inside feature components.
- Put page UI in `src/pages`; put module-specific UI in `src/modules/<module>/ui`.
- Do not call APIs, mutate state, or create routers during render outside React's supported patterns.
- Keep state as local as possible. Lift state only when two siblings need the same source of truth.
- Derive values during render instead of storing derivable data in state.
- Use stable domain-based keys for lists. Never use an array index as a key for mutable/reorderable data.
- Handle loading, empty, error, and success states for asynchronous UI.
- Use semantic HTML first. Buttons need `type`; inputs need labels; icon-only buttons need accessible names.
- Do not use `dangerouslySetInnerHTML` unless a task explicitly requires sanitized HTML and the implementation documents the sanitizer.

### Tailwind

- Use Tailwind utility classes for component styling; global CSS is limited to Tailwind import, resets, tokens, and truly global rules.
- Keep long class lists readable by grouping layout, spacing, typography, color, border, and interactive classes consistently.
- Reuse a component when the same UI behavior and class set appears in three or more places; do not extract a component for one-off markup.
- Do not add a CSS framework, UI kit, or custom global style system without task approval.

### React Router

- `src/app/routes/AppRoutes.tsx` is owned by the main owner and creates the browser router.
- Layout routes use `Outlet` for nested page rendering.
- A module that owns UI routes keeps route objects in its own `routes.tsx` and exports only the intended route collection through `index.ts`.
- Main registers public module route collections. Main never imports a module's page directly.
- Use lowercase kebab-case route paths such as `/module-a` and meaningful URL parameters such as `/orders/:orderId`.
- Add a not-found route when the application introduces more than the current home route.

## 9. Environment, mock data, and real integrations

Environment is parsed once in `src/config/environment.ts`; runner composition happens in `src/app/runtime/workflow.ts`.

| Mode | Command | Behavior |
| --- | --- | --- |
| Mock | `npm run dev:mock` | Each module's `mocks/runner.ts` |
| Development | `npm run dev` | Each module's `service.ts` |
| Production | `npm run build` | Each module's `service.ts` |

- Main calls only `getModuleXRunner(environment)` from a module's public API. Main never imports module mock data or internal runners.
- Mock fixtures are deterministic, representative, and safe to commit.
- Real services use typed configuration or injected clients, never scattered `import.meta.env` checks.
- Read `import.meta.env` only in configuration code. Business modules receive configuration or clients through explicit parameters/dependencies.
- Only `VITE_` variables are exposed to browser code. Never put secrets in any `VITE_` variable.
- Commit `.env.example` and safe shared mode files such as `.env.mock`; never commit `.env.local` or `.env.<mode>.local`.
- Do not make a production code path silently fall back to mock data. Fail with a specific error when required real configuration is missing.

## 10. Orchestrator and error handling

- Orchestrator imports module APIs only through each module's `index.ts`.
- It maps workflow input to module contracts, decides ordering, runs independent steps concurrently with `Promise.all`, aggregates outputs, and wraps cross-boundary failures.
- It does not reproduce module business rules or access module internals.
- Module A currently prepares input for B and C. B and C run in parallel after A succeeds unless an explicit new dependency is documented.
- Use `AppError` for cross-module errors and specific codes such as `MODULE_A_FAILED`, `MODULE_B_FAILED`, and `MODULE_C_FAILED`.
- Do not swallow errors. Preserve the original error as `cause` when wrapping it.
- Do not display raw internal errors to end users. Convert errors into safe UI messages at the UI boundary.
- Tests use `createWorkflowRunner(dependencies)` to mock module boundaries rather than mocking internal imports.

## 11. Testing and verification

### Test design

- For behavior changes, add or update a focused test before changing implementation.
- Keep module unit tests inside that module's `__tests__/` folder.
- Module tests must not depend on another business module.
- Test public APIs where practical; do not couple tests to private helper structure.
- Test both real service behavior and mock runner contract behavior when either changes.
- Orchestrator tests may inject fake A/B/C runners and cover ordering, aggregation, concurrency where relevant, and module-specific failures.
- Use clear test names that state behavior, for example `"Module A rejects an expired token"`.
- Do not add snapshot tests for simple transformations. Assert meaningful values directly.
- Tests are deterministic: no network, wall-clock, random data, or shared mutable state unless controlled in the test.

### Required commands

Run a relevant narrow test during implementation, then run these before handoff:

```bash
npm test
npm run typecheck
npm run build
```

For mock/runtime changes, also run:

```bash
npm run build:mock
```

Never claim a test, typecheck, or build passes without fresh command output from the current change.

## 12. Dependencies, security, performance, and Git

- Check existing dependencies before adding one. Prefer platform APIs and existing libraries for small needs.
- Add a dependency only when it has a clear owner, solves a real need, and does not duplicate the stack.
- Production dependencies go in `dependencies`; build/test-only dependencies go in `devDependencies`.
- Run `npm install` only when `package.json` changes; include the generated `package-lock.json` update. Never edit lockfiles manually.
- Do not log tokens, credentials, full request headers, personal data, or production records.
- Validate untrusted input at external boundaries.
- Avoid unnecessary global state, broad context updates, expensive render work, and repeated requests for unchanged data.
- Do not optimize prematurely. Identify a real bottleneck before adding memoization, caching, or abstraction.
- Start by inspecting relevant files and existing local changes. Preserve changes outside your task.
- Do not delete, reset, revert, or overwrite another person's changes without explicit instruction.
- Do not commit generated `dist/`, `node_modules/`, secrets, or local environment files.
- Keep diffs small and reviewable. Avoid whole-file reformatting.
- Public contract changes require coordination with all consumers before merge.

### Mandatory branch workflow

- Never implement task work directly on `main`. `main` is the integration branch.
- Create one branch for one focused task. Do not combine unrelated work on the same branch.
- Start from the latest `main`. If a remote exists, fetch and update it with fast-forward only before creating the branch.

  ```bash
  git switch main
  git pull --ff-only
  git switch -c feature/module-a-add-normalizer
  ```

- Branch names use this exact pattern: `<type>/<scope>-<short-description>`.
- `type` is one of: `feature`, `fix`, `refactor`, `test`, `docs`, `chore`.
- `scope` is one of: `main`, `orchestrator`, `module-api`, `gateway`, `module-a`, `module-b`, `module-c`, `shared`, `tooling`.
- `short-description` is lowercase kebab-case, begins with a verb, and describes one outcome.

  ```text
  feature/module-a-add-normalizer
  fix/module-b-handle-empty-result
  feature/main-add-workflow-page
  test/orchestrator-cover-module-c-failure
  docs/tooling-update-agent-handbook
  ```

- Do not use vague branch names such as `test`, `update`, `fix-bug`, `new-branch`, a personal name, or a date.
- If an issue tracker ID is required, put it after the scope: `feature/module-a-FFP-123-add-normalizer`.
- Before handoff, inspect `git status`, stage only task files, and make a focused commit. Commit subjects use `<type>(<scope>): <imperative summary>`.

  ```bash
  git status
  git add src/modules/module-a
  git commit -m "feature(module-a): add item normalizer"
  ```

- Do not force-push, rebase a shared branch, amend a commit already handed to another person, or merge your own branch into `main` without the leader's instruction.

## 13. Agent task protocol and handoff

Every agent task states:

1. Exact ownership scope and files/folders it may change.
2. Branch name that follows the mandatory branch workflow.
3. Expected behavior and acceptance criteria.
4. Whether a public contract, route, environment setting, or dependency may change.
5. Required tests and commands.
6. Explicit files/folders that must not be changed.

Before finishing, an agent self-reviews its diff for module-boundary violations, naming consistency, error handling, mock/real parity, and unintended shared-file edits.

Use this handoff format:

```text
Summary
- <implemented behavior>

Changed files
- <path>: <reason>

Verification
- <command>: <result>

Contract / environment / route changes
- <none, or exact compatibility note>

Remaining TODOs or risks
- <none, or specific item>
```

Stop and request direction instead of guessing when a task needs a product decision, unknown external API contract, credentials, a new shared abstraction, a breaking public-contract change, or permission to modify another owner's area.

## 14. Fast checklist

Before editing:

- [ ] Read this file and target code/tests.
- [ ] Confirm ownership and dependency direction.
- [ ] Identify whether mock, real service, UI, route, contract, or shared code changes.

Before handoff:

- [ ] Public API remains intentional through `index.ts`.
- [ ] No forbidden internal cross-module imports.
- [ ] Naming, types, errors, and tests follow this handbook.
- [ ] Mock and real implementations still conform to the same contract.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` have fresh passing output.
- [ ] `npm run build:mock` passed when mock/runtime code changed.
- [ ] Handoff includes files changed, verification, contract impact, and remaining TODOs.
