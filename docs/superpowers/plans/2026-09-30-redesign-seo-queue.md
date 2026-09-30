# SEO Queue Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/gpt-seo` a clean, understandable workspace for sending products to an AI provider, tracking SEO progress, and opening completed results for human review.

**Architecture:** Keep every API and route unchanged. Add a pure presentation helper for friendly labels, grouped status counts, filtering, and progress; consume it from a reorganized page whose settings are secondary and whose job details open in a drawer.

**Tech Stack:** React 19, strict TypeScript, React Router, Tailwind CSS, Node test runner via `tsx`.

**Spec:** Approved conversation design: rename the tab to “SEO Queue”, prioritize queue/statuses/actions, collapse settings, and never publish to Shopify from this page.

## Global Constraints

- Work directly on the user-selected `rua` branch and push only to `origin/rua`.
- Do not change API contracts, route paths, dependencies, or Shopify publishing behavior.
- Use friendly Vietnamese labels while preserving provider and status values internally.
- Keep loading, error, empty, filtered-empty, and active-batch states explicit.

## Review Focus

- Unknown future status/provider values must degrade to readable labels instead of crashing.
- Filtering must be case-insensitive and include title, handle, ID, source, and provider.
- Grouped counters must not double-count jobs.
- A missing queue must render a loading shell, not an incorrect empty state.
- The detail drawer must be keyboard-dismissible and expose image links and checkpoint data.

---

### Task 1: SEO queue presentation model

**Files:**
- Create: `src/modules/custom-gpt-seo/ui/seo-queue-view-model.ts`
- Test: `src/modules/custom-gpt-seo/__tests__/seo-queue-view-model.test.ts`

**Interfaces:**
- Consumes: `GptSeoJob`, `GptJobStatus`, and `SeoProvider` from the module contract.
- Produces: label helpers, grouped summary cards, checkpoint progress, retry eligibility, and queue filtering.

- [x] Write tests for friendly labels, grouped counts, progress, retry rules, and case-insensitive filtering.
- [x] Run the focused test and observe failure before implementation.
- [x] Implement the pure helper functions without changing public module exports.
- [x] Run the focused test and confirm it passes.

### Task 2: Queue-first page and navigation

**Files:**
- Modify: `src/modules/custom-gpt-seo/ui/CustomGptSeoPage.tsx`
- Modify: `src/layouts/AppLayout.tsx`

**Interfaces:**
- Consumes: Task 1 presentation helpers and the existing `CustomGptClient` methods.
- Produces: queue-first UI, collapsible settings, status/provider badges, active batch notice, detail drawer, retry/transfer/review actions, and active navigation styling.

- [x] Reorganize the page around summary cards and a filterable queue table.
- [x] Move job details, images, transfer actions, and raw checkpoints into a dismissible drawer.
- [x] Move settings into a collapsed disclosure and use operator-friendly labels/help text.
- [x] Rename the navigation item to “SEO Queue” and use the established active-link style.
- [x] Run the focused test, typecheck, production build, and full test suite.
- [x] Self-review the diff, commit the scoped files, and push `rua` to `origin/rua`.
