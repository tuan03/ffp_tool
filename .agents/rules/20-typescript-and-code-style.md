---
trigger: always_on
description: Enforces FFP Tool TypeScript, naming, import/export, function, and code-structure conventions.
---

# TypeScript and Code Style

## TypeScript

- Keep `strict` TypeScript enabled.
- Never weaken `tsconfig.json` to silence errors.
- Do not use `any`, `as any`, `@ts-ignore`, or `@ts-nocheck`.
- Use `unknown` for untrusted values and narrow with type guards.
- Use `import type` for type-only imports.
- Prefer `interface` for object-shaped public contracts.
- Prefer `type` for unions, mapped types, and compositions.
- Prefer discriminated unions for state/error variants over ambiguous optional-field combinations.
- Mark input arrays/objects `readonly` when they are not mutated.
- Exported functions should have explicit public output types.
- Avoid non-null assertion (`!`); validate or branch.
- Prefer `const`; use `let` only for required reassignment; never use `var`.
- Prefer named object parameters when more than two positional arguments would be required.
- Avoid enums unless interoperability requires one; prefer a `const` object plus union type.

## Naming

Use English in source code, technical documentation, route paths, error codes, and commit messages. User-facing copy uses the intended product language.

Conventions:

- Folders: `kebab-case`
- React component files: `PascalCase.tsx`
- Hooks: `useX.ts` / `useX.tsx`
- Other source files: descriptive `kebab-case.ts`, except repository standard names such as `service.ts`
- Tests: `<subject>.test.ts` or `<subject>.test.tsx`
- Variables/functions: `camelCase`
- Components/types/interfaces: `PascalCase`
- Boolean names: `is*`, `has*`, `can*`, `should*`, or `did*`
- Event handlers: `handle*`
- Async actions: verb-first names such as `fetchOrders`, `saveProfile`, `runWorkflow`
- Collections: plural nouns
- Identifiers: `<noun>Id`
- True constants and stable error codes: `UPPER_SNAKE_CASE`

Do not prefix interfaces with `I`.

Avoid vague names such as `data`, `item`, `result`, `handler`, `utils`, or `common` when a domain-specific name is available.

Avoid unexplained abbreviations.

One file should have one primary responsibility.

## Imports

Use this import grouping with one blank line between groups:

1. React and third-party packages.
2. Internal runtime imports.
3. Internal type-only imports.
4. Relative imports inside the same ownership boundary.

## Exports and functions

- Prefer named exports.
- Reserve default export for the root `App` component unless an existing convention requires otherwise.
- Keep module `index.ts` files as explicit public export lists.
- Do not create convenience re-exports of internal helpers.
- Avoid unnecessary barrel files.
- Keep helpers private unless another ownership boundary genuinely needs them.
- Keep functions focused and prefer early returns to deep nesting.
- Use `async`/`await`; do not mix promise chains and `async`/`await` in the same flow.
- Comments explain why, constraints, or non-obvious tradeoffs; code should explain what.
- Every TODO must name the missing behavior/integration and known blocker. Never leave vague TODOs such as `// TODO: fix`.

Keep diffs small and reviewable. Do not reformat whole files without a task reason.
