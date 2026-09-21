---
trigger: always_on
description: Enforces FFP Tool test-first behavior, orchestrator responsibilities, error handling, and fresh verification requirements.
---

# Testing, Orchestrator, and Error Handling

## Test workflow

For behavior changes:

1. Add or update a focused failing test before implementation when practical.
2. Implement the smallest behavior required.
3. Run a narrow relevant test during development.
4. Before handoff, run the full required verification commands.

Module tests:

- stay in that module's `__tests__/` folder;
- must not depend on another business module;
- should test public behavior where practical;
- must cover real service and mock runner contract parity when either changes;
- are deterministic: no uncontrolled network, wall clock, randomness, or shared mutable state;
- should assert meaningful values directly rather than using snapshots for simple transformations.

Use clear behavioral test names.

## Orchestrator rules

The orchestrator:

- imports module APIs only through each module's `index.ts`;
- maps workflow input to module public input contracts;
- decides ordering and dependencies;
- uses `Promise.all` for independent work;
- aggregates public outputs;
- wraps cross-boundary failures;
- must not reproduce module business rules or reach into module internals.

Tests for orchestrator should use dependency injection through its public factory rather than mocking module private imports.

## Error handling

- Do not swallow errors.
- Use the repository `AppError` pattern for cross-module failures.
- Use stable, specific error codes.
- Preserve the original error as `cause` when wrapping.
- Do not expose raw internal errors directly to end users; convert them to safe UI messages at the UI boundary.

## Required verification before handoff

Always run fresh:

```bash
npm test
npm run typecheck
npm run build
```

If mock/runtime behavior changed, also run:

```bash
npm run build:mock
```

Never claim a test, typecheck, build, or mock build passed without fresh command output from the current change.

If verification fails, report the failure accurately. Do not hide, bypass, disable, or weaken checks merely to produce a passing report.
