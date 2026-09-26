# POD reference fidelity implementation plan

> **For agentic workers:** Use superpowers:executing-plans, with test-first changes.

**Goal:** Never publish a rejected mockup or silently redraw a supplied reference.

**Architecture:** Reference images use deterministic artwork projection into explicit printable-surface masks. Unsupported geometry fails closed. Generative scenes without a reference retain strict QA. Production status reflects missing/rejected outputs.

**Tech Stack:** Python, Pillow, NumPy; existing TypeScript client.

**Spec:** User requirements in this conversation: preserve reference layout, change only target print, preserve master artwork, work on current branch.

## Constraints

- Work on `fix/pinterest-pod-universal-pipeline` as explicitly requested; no new branch/worktree.
- Changes limited to Pinterest POD and this plan; no new dependencies.
- AI geometry is an estimate, not a guarantee of segmentation accuracy. Reject missing/uncertain/unsupported surfaces; never invent a bounding-box fallback.
- Do not run paid production jobs or modify the supplied historical job.

## Review focus

- QA rejects on last attempt or API fails after a candidate: no deliverable.
- Reference cannot be read or analyzed: no generated replacement scene.
- Multiple surfaces and protected occlusions: unchanged pixels outside masks.
- Missing/degenerate/low-confidence geometry: explicit failure.
- Partial production: not reported as complete.

## Tasks

1. Add failing regression tests in `server/trend_tool/tests/test_mockup_fidelity.py`; remove success fallbacks from `template_mockup.py`; run focused unittest discovery.
2. Add deterministic projection tests; implement `reference_composite.py` with explicit polygon/quad/protection validation and master hash; wire reference analysis and strict QA into `template_mockup.py`.
3. Test and propagate failed production state in `pipeline.py` and `pinterest_pod_bridge.py` without changing the public status union.
4. Run Pinterest Python suite, `npm test`, `npm run typecheck`, `npm run build`; review diff and commit only task files.

## Execution record

- Baseline clean on requested branch. Existing QA failure bypass and unvalidated fallback confirmed by code and job investigation.
- User already approved the implementation scope; continue inline without repeating design approval.
- Implemented strict QA, reference polygon projection with protected regions, four-image QA (master/output/reference/mask), SHA-256 master provenance, failed production propagation, and SEO gating.
- Review findings addressed: stable retry identity; preserve missing reference slots; validate reference imports; account for capped output coverage; preserve failures in both workers and job history. Added approved-file allowlists so stale retry artifacts are not advertised.
- Supported mapping is planar homography only. Curved/folded surfaces require a reviewed UV/mesh or segmentation workflow not implemented here; no universal quality guarantee is claimed. AI-estimated boundaries still require visual QA.
- Existing product-cutout rendering and no-reference generative scene rendering remain in place. This change does not certify every output type or regenerate historical jobs.
- Verification: Pinterest Python and TypeScript tests pass; typecheck/build pass. Full npm test reaches engine tests but two Amazon Crawler modules cannot import missing sqlalchemy. No unrelated dependency changes made.
