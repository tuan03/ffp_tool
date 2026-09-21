---
trigger: always_on
description: Enforces FFP Tool React, Tailwind, routing, runtime, environment, mock/real parity, security, dependency, and performance rules.
---

# React, Runtime, Environment, and Security

## React

- Use function components only.
- Application-wide providers belong in `src/app/providers`.
- Page UI belongs in `src/pages`.
- Module-specific UI belongs in `src/modules/<module>/ui`.
- Do not call APIs, mutate state, or create routers during render outside supported React patterns.
- Keep state local where possible; lift it only when multiple consumers need the same source of truth.
- Derive values during render instead of storing derivable state.
- Use stable domain keys for mutable/reorderable lists; do not use array indexes.
- Async UI must handle loading, empty, error, and success states.
- Prefer semantic HTML.
- Buttons need an explicit `type`.
- Inputs need labels.
- Icon-only buttons need accessible names.
- Do not use `dangerouslySetInnerHTML` unless sanitized HTML is explicitly required and the sanitizer is documented.

## Tailwind and CSS

- Use Tailwind utilities for component styling.
- Keep global CSS limited to Tailwind import, resets, tokens, and genuinely global rules.
- Do not introduce another CSS framework, UI kit, or global styling system without task approval.
- Extract reusable UI only when behavior/style is genuinely repeated; avoid premature abstraction.

## React Router

- Main application routing is owned by `src/app/routes/AppRoutes.tsx`.
- Layout routes use `Outlet`.
- Module-owned routes stay in that module's `routes.tsx` and expose only intended route collections through `index.ts`.
- Main registers public module routes and must not import a module's internal page directly.
- Route paths use lowercase kebab-case.
- URL params use meaningful names such as `:orderId`.

## Environment and runtime

Environment parsing belongs in `src/config/environment.ts`.

Runner composition belongs in `src/app/runtime/workflow.ts`.

Behavior:

- Mock mode uses each module's `mocks/runner.ts`.
- Development and production use each module's `service.ts`.
- Main asks modules only for their public runner factory.
- Business modules must not scatter `import.meta.env` checks.
- Real services receive typed configuration or injected clients.
- Production paths must never silently fall back to mock data.
- Missing required real configuration must fail with a specific error.

Only `VITE_` variables are exposed to browser code. Never store secrets in `VITE_` variables.

Commit safe examples/shared mock mode files only. Never commit local secret environment files.

## Security and dependencies

- Never log tokens, credentials, full request headers, personal data, or production records.
- Validate untrusted external input at boundaries.
- Check existing dependencies before adding a new package.
- Prefer platform APIs and existing libraries for small requirements.
- Add a dependency only when it has a clear owner and solves a real need without duplicating the stack.
- Production libraries go in `dependencies`; build/test-only libraries go in `devDependencies`.
- Run `npm install` only when `package.json` changes.
- Include generated `package-lock.json` changes when dependencies change.
- Never hand-edit lockfiles.

## Performance

Avoid unnecessary global state, broad context updates, repeated unchanged requests, and expensive render work.

Do not add caching, memoization, or abstractions without an identified need.
