---
trigger: always_on
description: Core FFP Tool repository operating contract. Apply before planning, inspecting, editing, testing, or reviewing code.
---

# FFP Tool — Project Operating Contract

## Source of truth

Before making code changes, read and follow:

- @../../AGENTS.md — canonical engineering and agent contract.
- @../../docs/development-guide.md — onboarding, ownership workflow, contract-change workflow, Antigravity task pattern, Git workflow, and verification.
- @../../package.json — actual available scripts and dependency baseline.
- @../../tsconfig.json — actual TypeScript compiler contract.

If this rule summary and `AGENTS.md` differ, `AGENTS.md` wins unless the user explicitly instructs otherwise. If a user instruction intentionally conflicts with the repository contract, follow the explicit user instruction and report the exception in the handoff.

Do not modify `AGENTS.md` unless the task specifically asks to change team rules.

## Technical baseline

FFP Tool is one React application using TypeScript, Vite, Tailwind CSS, and React Router.

It is not a monorepo.

Therefore:

- Keep one root `package.json`, one `tsconfig.json`, and one build.
- Do not create module-level `package.json` files, npm workspaces, internal npm packages, or private publishing flows.
- `src/modules` defines ownership and architecture boundaries inside the same application.
- TypeScript strict mode is mandatory and must not be weakened.

## Mandatory task startup

Before editing:

1. Read the relevant public contract, implementation, and tests.
2. Inspect existing local changes and preserve work outside the task.
3. Confirm the current Git branch.
4. Confirm the exact ownership scope and dependency direction.
5. Identify whether the task changes a public contract, mock behavior, real service, UI, route, environment configuration, dependency, or shared code.
6. Keep the planned diff focused on one requested outcome.

Never start implementation by performing broad cleanup, reformatting, renaming, dependency upgrades, or unrelated file moves.

## Safety when requirements are unclear

Stop and request direction rather than guessing when the task requires:

- an unknown external API contract;
- credentials or secrets;
- a product/business decision;
- a new shared abstraction;
- a breaking public-contract change;
- permission to edit another owner's area;
- a Git branch scope not defined by the repository rules.

Never delete, reset, revert, overwrite, or discard another person's changes without explicit instruction.
