---
trigger: always_on
description: Enforces FFP Tool ownership, dependency direction, module layout, and public API boundaries.
---

# Architecture and Module Boundaries

## Ownership boundaries

Default ownership:

- Main/application: `src/app`, `src/config`, `src/layouts`, `src/pages`, `src/styles`
- Workflow coordination: `src/modules/orchestrator`
- Business modules: their own folder under `src/modules/<module>`
- Shared cross-cutting code: `src/shared`

Modify only the assigned scope unless the task explicitly requires a coordinated change.

Treat `src/shared` and root configuration as shared-conflict zones. Edit them only when necessary and explain the reason in the handoff.

Do not perform unrelated cleanup in another owner's folder.

## Dependency direction

Preserve this direction:

```text
app / pages / layouts
        ↓
   orchestrator
   ↙    ↓    ↘
 business modules
        ↓
      shared
```

Rules:

- A business module exposes supported API only through its own `index.ts`.
- Consumers import a module only from its folder entry point.
- Never import another module's `service.ts`, `runtime.ts`, `mocks/`, `ui/`, tests, or private helpers.
- Business modules must not import `orchestrator`, `app`, `pages`, `layouts`, or another business module.
- `shared` must not import business modules, app, pages, or layouts.
- Circular dependencies are forbidden.
- If modules need coordination, let the orchestrator coordinate them.
- Move code to `shared` only when at least two independent owners need the same stable abstraction.
- Keep module-specific business logic inside its owning module.
- Do not create `src/modules/index.ts`.

## Standard module shape

Business modules should follow the repository module pattern:

```text
module-x/
├── index.ts
├── types.ts
├── service.ts
├── runtime.ts
├── mocks/
│   ├── data.ts
│   └── runner.ts
├── ui/                  # optional
├── routes.tsx           # optional
└── __tests__/
    └── service.test.ts
```

Responsibilities:

- `index.ts`: intentional public exports only; no business logic.
- `types.ts`: public input/output contracts.
- `service.ts`: real business logic and real API/SDK/database integration point.
- `runtime.ts`: selects mock runner only in mock mode; development/production use real service.
- `mocks/data.ts`: deterministic, safe, realistic fixtures; never production records or secrets.
- `mocks/runner.ts`: same public contract as real service; return fresh copies of mutable values.
- `ui/`: UI owned by that module only.
- `__tests__/`: focused unit tests owned by the module.

## Public contract changes

A public contract change is a coordination event.

When changing `types.ts` or exported behavior:

1. update the real service;
2. update mock fixtures/runner;
3. update module tests;
4. notify/update orchestrator mapping in a coordinated task;
5. update visible UI only when required;
6. avoid mixing the contract change with unrelated formatting or cleanup.

Do not casually re-export private helpers for convenience.
